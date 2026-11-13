import { db } from "../../db";
import { runWithoutTenant } from "../../db/engine/context";
import { logStructured } from "../http/logger";
import { renderTemplate, SENSITIVE_TEMPLATES, type TemplateData, type TemplateName } from "./templates";
import { getMailConfig, resolveMailTransport } from "./transports";
import { MailDeliveryError, type MailMessage, type MailTransport, type SendMailResult } from "./types";

/**
 * Envio de correos con bandeja de salida (`mail_outbox`).
 *
 * - `sendMail` renderiza la plantilla, registra el correo y lo intenta enviar de inmediato.
 * - Si el proveedor falla de forma recuperable, el correo queda en cola y el trabajo `mail.send-pending`
 *   lo reintenta con espera creciente (1, 5, 15, 60 y 360 minutos; maximo 6 intentos).
 * - Los correos con enlace secreto (ver `SENSITIVE_TEMPLATES`) no guardan su contenido ni se reintentan.
 * - `dedupeKey` evita enviar dos veces el mismo aviso (p. ej. `past_due:12:2026-11`).
 */

export const MAX_MAIL_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];
const RETENTION_DAYS = 90;
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"']+@[^\s@<>()[\],;:"']+\.[^\s@<>()[\],;:"']{2,}$/;

type OutboxRow = {
  id: number; to_email: string; subject: string; template: string; text_body: string | null; html_body: string | null;
  attempts: number; status: string;
};

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

export function isValidEmail(value: string) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

async function markSent(id: number, transport: MailTransport, providerId: string | null, attempts: number) {
  await db.prepare("UPDATE mail_outbox SET status = 'sent', attempts = ?, provider_id = ?, transport = ?, sent_at = datetime('now'), last_error = NULL WHERE id = ?")
    .run(attempts, providerId, transport.id, id);
}

/** Registra un intento fallido: reintentable -> vuelve a la cola con espera; si no, queda en `failed`. */
async function markFailed(id: number, transport: MailTransport, attempts: number, error: MailDeliveryError, canRetry: boolean) {
  const giveUp = !canRetry || !error.retryable || attempts >= MAX_MAIL_ATTEMPTS;
  const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  await db.prepare("UPDATE mail_outbox SET status = ?, attempts = ?, transport = ?, last_error = ?, next_attempt_at = ? WHERE id = ?")
    .run(giveUp ? "failed" : "queued", attempts, transport.id, error.message.slice(0, 500), sqlTime(new Date(Date.now() + wait * 60_000)), id);
  return giveUp ? ("failed" as const) : ("queued" as const);
}

async function deliver(row: Pick<OutboxRow, "id" | "attempts">, message: MailMessage, transport: MailTransport, from: string, canRetry: boolean): Promise<SendMailResult["status"]> {
  const attempts = row.attempts + 1;
  try {
    const result = await transport.send(message, from);
    await markSent(row.id, transport, result.providerId, attempts);
    return "sent";
  } catch (error) {
    const failure = error instanceof MailDeliveryError ? error : new MailDeliveryError((error as Error)?.message ?? "Error desconocido", true);
    logStructured("warn", "mail.delivery_failed", { mail_id: row.id, transport: transport.id, retryable: failure.retryable, attempts });
    return await markFailed(row.id, transport, attempts, failure, canRetry);
  }
}

export async function sendMail<K extends TemplateName>(input: {
  to: string;
  template: K;
  data: TemplateData[K];
  tenantRef?: number | null;
  dedupeKey?: string | null;
}): Promise<SendMailResult> {
  const to = input.to.trim().toLowerCase();
  if (!isValidEmail(to)) {
    logStructured("warn", "mail.invalid_recipient", { template: input.template });
    return { status: "failed", id: null };
  }
  const rendered = renderTemplate(input.template, input.data);
  const sensitive = SENSITIVE_TEMPLATES.has(input.template);
  const transport = resolveMailTransport();
  const config = getMailConfig();

  return await runWithoutTenant(async () => {
    if (input.dedupeKey) {
      const existing = await db.prepare("SELECT id FROM mail_outbox WHERE dedupe_key = ?").get(input.dedupeKey) as { id: number } | undefined;
      if (existing) return { status: "duplicate" as const, id: existing.id };
    }

    let id: number;
    try {
      const inserted = await db.prepare(`
        INSERT INTO mail_outbox (to_email, subject, template, text_body, html_body, tenant_ref, dedupe_key, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')
      `).run(to, rendered.subject, input.template, sensitive ? null : rendered.text, sensitive ? null : rendered.html, input.tenantRef ?? null, input.dedupeKey ?? null);
      id = Number(inserted.lastInsertRowid);
    } catch (error) {
      // Otro proceso registro el mismo aviso entre la consulta y el insert.
      if (input.dedupeKey) {
        const existing = await db.prepare("SELECT id FROM mail_outbox WHERE dedupe_key = ?").get(input.dedupeKey) as { id: number } | undefined;
        if (existing) return { status: "duplicate" as const, id: existing.id };
      }
      throw error;
    }

    if (transport.id === "disabled") {
      await db.prepare("UPDATE mail_outbox SET status = 'skipped', transport = 'disabled', last_error = ? WHERE id = ?").run(config.problem ?? "Envio de correos deshabilitado", id);
      return { status: "skipped" as const, id };
    }

    const status = await deliver({ id, attempts: 0 }, { to, subject: rendered.subject, text: rendered.text, html: rendered.html }, transport, config.from, !sensitive);
    return { status, id };
  });
}

/** Reintenta los correos en cola cuya espera ya vencio. Lo ejecuta el trabajo `mail.send-pending`. */
export async function processMailOutbox(limit = 50) {
  const transport = resolveMailTransport();
  const config = getMailConfig();
  const summary = { due: 0, sent: 0, requeued: 0, failed: 0, purged: 0 };
  await runWithoutTenant(async () => {
    if (transport.id !== "disabled") {
      const rows = await db.prepare(`
        SELECT id, to_email, subject, template, text_body, html_body, attempts, status
        FROM mail_outbox WHERE status = 'queued' AND text_body IS NOT NULL AND next_attempt_at <= datetime('now') ORDER BY id LIMIT ?
      `).all(limit) as OutboxRow[];
      summary.due = rows.length;
      for (const row of rows) {
        const status = await deliver(row, { to: row.to_email, subject: row.subject, text: row.text_body!, html: row.html_body ?? row.text_body! }, transport, config.from, true);
        if (status === "sent") summary.sent += 1; else if (status === "queued") summary.requeued += 1; else summary.failed += 1;
      }
    }
    // Retencion: los correos ya resueltos no se conservan indefinidamente (datos personales).
    const purged = await db.prepare(`DELETE FROM mail_outbox WHERE status IN ('sent', 'failed', 'skipped') AND created_at < datetime('now', '-${RETENTION_DAYS} days')`).run();
    summary.purged = purged.changes;
  });
  return summary;
}

/** Cuantos correos de una plantilla recibio una direccion en la ultima ventana. Sirve para limitar abuso (p. ej. recuperar clave). */
export async function recentMailCount(to: string, template: TemplateName, windowMinutes: number) {
  const minutes = Math.max(1, Math.floor(windowMinutes));
  const row = await runWithoutTenant(() =>
    db.prepare(`SELECT COUNT(*) AS n FROM mail_outbox WHERE to_email = ? AND template = ? AND created_at > datetime('now', '-${minutes} minutes')`).get(to.trim().toLowerCase(), template),
  ) as { n: number | string };
  return Number(row.n);
}
