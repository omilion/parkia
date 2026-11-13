import type { Express } from "express";
import { notificationSendSchema } from "../../../shared/schemas/notifications";
import { requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { sendMail } from "../../platform/mail";
import { getTenantContextFromRequest } from "../../platform/tenant/service";
import { parseBody } from "../../validation";

export type NotificationChannel = "email" | "whatsapp";
export type NotificationTemplate = "fee_due_soon" | "fee_overdue" | "receipt_boleta" | "visitor_pass_qr";

export interface WhatsAppMessage {
  to: string;
  template: NotificationTemplate;
  bodyText: string;
}

export interface WhatsAppTransport {
  send(message: WhatsAppMessage): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

export const memoryWhatsAppOutbox: Array<WhatsAppMessage & { messageId: string }> = [];

export function resetMemoryWhatsAppOutbox() {
  memoryWhatsAppOutbox.length = 0;
}

class MemoryWhatsAppTransport implements WhatsAppTransport {
  async send(message: WhatsAppMessage) {
    const messageId = `wa-mem-${memoryWhatsAppOutbox.length + 1}`;
    memoryWhatsAppOutbox.push({ ...message, messageId });
    return { ok: true, messageId };
  }
}

class MetaWhatsAppTransport implements WhatsAppTransport {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  async send(message: WhatsAppMessage) {
    const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: message.to.replace(/[^0-9]/g, ""),
        type: "text",
        text: { body: message.bodyText },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `whatsapp_http_${res.status}` };
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    return { ok: true, messageId: json.messages?.[0]?.id || "wa-sent" };
  }
}

function defaultWhatsAppTransport(): WhatsAppTransport {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (process.env.NODE_ENV !== "test" && phoneId && token) {
    return new MetaWhatsAppTransport(phoneId, token);
  }
  return new MemoryWhatsAppTransport();
}

let activeWhatsAppTransport: WhatsAppTransport = defaultWhatsAppTransport();

export function setWhatsAppTransport(transport: WhatsAppTransport) {
  activeWhatsAppTransport = transport;
}

export function renderNotificationContent(
  template: NotificationTemplate,
  payload: Record<string, unknown>,
): { title: string; paragraphs: string[]; cta?: { label: string; url: string }; whatsappText: string } {
  const clientName = String(payload.clientName || payload.visitorName || "Cliente");
  const amountClp = Number(payload.amountClp || 0).toLocaleString("es-CL");
  const dueDate = String(payload.dueDate || "");
  const paymentUrl = typeof payload.paymentUrl === "string" ? payload.paymentUrl : undefined;

  switch (template) {
    case "fee_due_soon": {
      const text = `Hola ${clientName}, tu cuota de estacionamiento por $${amountClp} vence el ${dueDate}.`;
      return {
        title: "Recordatorio: cuota por vencer",
        paragraphs: [text],
        ...(paymentUrl ? { cta: { label: "Pagar cuota en línea", url: paymentUrl } } : {}),
        whatsappText: paymentUrl ? `${text} Paga aquí: ${paymentUrl}` : text,
      };
    }
    case "fee_overdue": {
      const text = `Hola ${clientName}, tu cuota por $${amountClp} venció el ${dueDate}. Regulariza tu pago para evitar suspensión.`;
      return {
        title: "Aviso: cuota vencida",
        paragraphs: [text],
        ...(paymentUrl ? { cta: { label: "Regularizar pago", url: paymentUrl } } : {}),
        whatsappText: paymentUrl ? `${text} Paga aquí: ${paymentUrl}` : text,
      };
    }
    case "receipt_boleta": {
      const folio = String(payload.folio || "-");
      const plate = payload.plate ? ` (patente ${String(payload.plate)})` : "";
      const text = `Emitimos tu boleta folio ${folio} por $${amountClp}${plate}.`;
      return {
        title: `Boleta electrónica N° ${folio}`,
        paragraphs: [text],
        whatsappText: text,
      };
    }
    case "visitor_pass_qr": {
      const plate = String(payload.plate || "-");
      const validUntil = String(payload.validUntil || "");
      const qrCode = String(payload.qrCode || "");
      const text = `Hola ${clientName}, tu pase de visita para la patente ${plate} está activo hasta ${validUntil}. Código QR: ${qrCode}`;
      return {
        title: "Pase de visita Parkia con QR",
        paragraphs: [text],
        whatsappText: text,
      };
    }
  }
}

export async function sendNotification(input: {
  tenantId: number;
  channel: NotificationChannel;
  recipient: string;
  template: NotificationTemplate;
  payload: Record<string, unknown>;
  dedupeKey?: string;
}): Promise<{ id: number; status: string; deduplicated?: boolean; providerMessageId?: string | null }> {
  return await runWithTenant(input.tenantId, async () => {
    if (input.dedupeKey) {
      const existing = await db
        .prepare("SELECT id, status, provider_message_id FROM notification_outbox WHERE dedupe_key = ? LIMIT 1")
        .get<{ id: number; status: string; provider_message_id: string | null }>(input.dedupeKey);
      if (existing) {
        return {
          id: Number(existing.id),
          status: existing.status,
          deduplicated: true,
          providerMessageId: existing.provider_message_id,
        };
      }
    }

    const insert = await db
      .prepare(
        `INSERT INTO notification_outbox (tenant_id, channel, recipient, template, payload_json, dedupe_key, status)
         VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      )
      .run(
        input.tenantId,
        input.channel,
        input.recipient.trim(),
        input.template,
        JSON.stringify(input.payload),
        input.dedupeKey ?? null,
      );
    const outboxId = Number(insert.lastInsertRowid);
    const rendered = renderNotificationContent(input.template, input.payload);

    try {
      let providerMessageId: string | null = null;
      if (input.channel === "email") {
        await sendMail({
          to: input.recipient.trim(),
          template: "notice",
          data: {
            title: rendered.title,
            paragraphs: rendered.paragraphs,
            ...(rendered.cta ? { cta: rendered.cta } : {}),
          },
          dedupeKey: input.dedupeKey ? `notif-mail-${input.dedupeKey}` : undefined,
        });
        providerMessageId = `mail-${outboxId}`;
      } else {
        const waRes = await activeWhatsAppTransport.send({
          to: input.recipient.trim(),
          template: input.template,
          bodyText: rendered.whatsappText,
        });
        if (!waRes.ok) {
          throw new Error(waRes.error || "whatsapp_send_failed");
        }
        providerMessageId = waRes.messageId || `wa-${outboxId}`;
      }

      await db
        .prepare(
          `UPDATE notification_outbox
           SET status = 'sent', attempts = attempts + 1, provider_message_id = ?, sent_at = datetime('now')
           WHERE tenant_id = ? AND id = ?`,
        )
        .run(providerMessageId, input.tenantId, outboxId);

      return { id: outboxId, status: "sent", providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .prepare(
          `UPDATE notification_outbox
           SET status = 'failed', attempts = attempts + 1, last_error = ?
           WHERE tenant_id = ? AND id = ?`,
        )
        .run(msg.slice(0, 400), input.tenantId, outboxId);
      return { id: outboxId, status: "failed", providerMessageId: null };
    }
  });
}

export async function processNotificationOutbox(): Promise<{ retried: number; sent: number }> {
  return await runWithoutTenant(async () => {
    const rows = await db
      .prepare(
        `SELECT id, tenant_id, channel, recipient, template, payload_json
         FROM notification_outbox
         WHERE status IN ('queued', 'failed') AND attempts < 5
         ORDER BY id ASC
         LIMIT 50`,
      )
      .all<{
        id: number;
        tenant_id: number;
        channel: NotificationChannel;
        recipient: string;
        template: NotificationTemplate;
        payload_json: string;
      }>();

    let sent = 0;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const rendered = renderNotificationContent(row.template, payload);
      try {
        let providerId = `retry-${row.id}`;
        if (row.channel === "email") {
          await sendMail({
            to: row.recipient,
            template: "notice",
            data: { title: rendered.title, paragraphs: rendered.paragraphs },
          });
        } else {
          const wa = await activeWhatsAppTransport.send({
            to: row.recipient,
            template: row.template,
            bodyText: rendered.whatsappText,
          });
          if (!wa.ok) throw new Error(wa.error || "wa_retry_failed");
          providerId = wa.messageId || providerId;
        }
        await db
          .prepare(
            `UPDATE notification_outbox
             SET status = 'sent', attempts = attempts + 1, provider_message_id = ?, sent_at = datetime('now')
             WHERE id = ?`,
          )
          .run(providerId, row.id);
        sent += 1;
      } catch (err) {
        await db
          .prepare("UPDATE notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?")
          .run(err instanceof Error ? err.message.slice(0, 400) : "retry_failed", row.id);
      }
    }
    return { retried: rows.length, sent };
  });
}

export function registerNotificationRoutes(app: Express) {
  app.get("/api/notifications/outbox", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const items = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT id, channel, recipient, template, status, attempts, provider_message_id, last_error, created_at, sent_at
           FROM notification_outbox
           WHERE tenant_id = ?
           ORDER BY id DESC
           LIMIT 50`,
        )
        .all<Record<string, unknown>>(ctx.tenant.id),
    );
    res.json({ items });
  });

  app.post("/api/notifications/send", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const body = parseBody(notificationSendSchema, req.body, res);
    if (!body) return;
    const ctx = await getTenantContextFromRequest(req);
    const result = await sendNotification({
      tenantId: ctx.tenant.id,
      channel: body.channel,
      recipient: body.recipient,
      template: body.template,
      payload: body.payload,
      dedupeKey: body.dedupe_key,
    });
    res.status(result.status === "failed" ? 502 : 201).json(result);
  });
}

