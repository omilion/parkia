import { db } from "../../db";
import { runWithoutTenant } from "../../db/engine/context";
import { publicBaseUrl } from "../../platform/http/baseUrl";
import { sendMail } from "../../platform/mail";

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt);
}

function diffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

type SubscriptionRow = {
  id: number;
  tenant_id: number;
  tenant_name: string;
  tenant_status: string;
  plan_name: string;
  status: string;
  current_period_end: string | null;
  grace_until: string | null;
};

type RecipientRow = {
  id: number;
  name: string;
  email: string;
};

async function listTenantAdminRecipients(tenantId: number): Promise<RecipientRow[]> {
  return (await db
    .prepare(
      `SELECT s.id, s.name, s.email
       FROM tenant_memberships tm
       JOIN staff s ON s.id = tm.staff_id
       WHERE tm.tenant_id = ?
         AND tm.status = 'active'
         AND tm.role IN ('owner', 'admin')
         AND s.active = 1
       ORDER BY CASE tm.role WHEN 'owner' THEN 0 ELSE 1 END, s.id ASC`,
    )
    .all(tenantId)) as RecipientRow[];
}

export async function runSubscriptionLifecycleJob(now = new Date()) {
  const today = toIsoDate(now);
  const nowIso = now.toISOString();
  const appUrl = publicBaseUrl();

  return await runWithoutTenant(async () => {
    const subs = (await db
      .prepare(
        `SELECT s.id,
                s.tenant_id,
                t.name AS tenant_name,
                t.status AS tenant_status,
                p.name AS plan_name,
                s.status,
                s.current_period_end,
                s.grace_until
         FROM subscriptions s
         JOIN tenants t ON t.id = s.tenant_id
         JOIN plans p ON p.id = s.plan_id
         WHERE t.status = 'active'
           AND s.status IN ('trialing', 'active', 'past_due')`,
      )
      .all()) as SubscriptionRow[];

    let trialEndingNotified = 0;
    let movedToPastDue = 0;
    let movedToSuspended = 0;

    for (const sub of subs) {
      const periodEnd = sub.current_period_end ? String(sub.current_period_end).slice(0, 10) : null;
      const graceUntil = sub.grace_until ? String(sub.grace_until).slice(0, 10) : null;

      if (sub.status === "trialing" && periodEnd && periodEnd >= today) {
        const daysLeft = diffDays(today, periodEnd);
        if (daysLeft <= 3) {
          const recipients = await listTenantAdminRecipients(sub.tenant_id);
          for (const recipient of recipients) {
            await sendMail({
              to: recipient.email,
              template: "notice",
              dedupeKey: `trial_ending:${sub.tenant_id}:${periodEnd}:${recipient.id}`,
              data: {
                title: `Tu período de prueba en Parkia vence en ${daysLeft} día(s)`,
                paragraphs: [
                  `Hola ${recipient.name}, tu período de prueba del plan ${sub.plan_name} para ${sub.tenant_name} finaliza el ${periodEnd}.`,
                  "Activa tu medio de pago para continuar operando sin interrupciones.",
                ],
                cta: { label: "Ir a Parkia", url: appUrl },
              },
            });
          }
          await db.prepare("UPDATE subscriptions SET last_notice_at = ? WHERE id = ?").run(nowIso, sub.id);
          trialEndingNotified += 1;
        }
        continue;
      }

      if ((sub.status === "trialing" || sub.status === "active") && periodEnd && periodEnd < today) {
        const nextGraceUntil = addDays(today, 7);
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'past_due',
                 grace_until = ?,
                 last_notice_at = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .run(nextGraceUntil, nowIso, sub.id);

        const recipients = await listTenantAdminRecipients(sub.tenant_id);
        for (const recipient of recipients) {
          await sendMail({
            to: recipient.email,
            template: "notice",
            dedupeKey: `past_due:${sub.tenant_id}:${periodEnd}:${recipient.id}`,
            data: {
              title: "Tu suscripción en Parkia está vencida (período de gracia activo)",
              paragraphs: [
                `Hola ${recipient.name}, la suscripción de ${sub.tenant_name} venció el ${periodEnd}.`,
                `Tienes 7 días de gracia (hasta el ${nextGraceUntil}) para regularizar el pago antes de que la cuenta pase a modo de solo lectura.`,
              ],
              cta: { label: "Regularizar suscripción", url: appUrl },
            },
          });
        }
        movedToPastDue += 1;
        continue;
      }

      if (sub.status === "past_due" && graceUntil && graceUntil < today) {
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'suspended',
                 suspended_at = ?,
                 last_notice_at = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .run(nowIso, nowIso, sub.id);

        const recipients = await listTenantAdminRecipients(sub.tenant_id);
        for (const recipient of recipients) {
          await sendMail({
            to: recipient.email,
            template: "notice",
            dedupeKey: `suspended:${sub.tenant_id}:${graceUntil}:${recipient.id}`,
            data: {
              title: "Suscripción suspendida en Parkia (datos conservados)",
              paragraphs: [
                `Hola ${recipient.name}, venció el período de gracia de ${sub.tenant_name} el ${graceUntil}.`,
                "La cuenta quedó suspendida para nuevas operaciones. Tus datos históricos están intactos y puedes exportar tu información o reactivar el plan en cualquier momento.",
              ],
              cta: { label: "Abrir Parkia", url: appUrl },
            },
          });
        }
        movedToSuspended += 1;
      }
    }

    return {
      checked: subs.length,
      trialEndingNotified,
      movedToPastDue,
      movedToSuspended,
    };
  });
}
