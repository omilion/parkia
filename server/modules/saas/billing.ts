/**
 * Cobro de la suscripción: lo hace PARKIA a sus clientes, nunca el cliente a sí mismo.
 *
 * - El cliente (administrador de su empresa) solo inscribe su tarjeta y ve su plan, su próximo cobro y su historial.
 * - Parkia cobra de dos formas: el job `subscriptions.charge` (automático, a quien se le venció el período) y el
 *   administrador de plataforma desde /plataforma (cobrar ahora, o registrar un pago recibido por transferencia).
 * - El monto se calcula con la UF real del día. Sin una UF real y reciente no se cobra.
 * - Un período se cobra una sola vez: la fila del intento se inserta antes de llamar a la pasarela (orden única).
 */
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { todayLocal } from "../../../shared/dates";
import { isPeriodDue, isUfUsable, MANUAL_CHARGE_ADVANCE_DAYS, nextBillingPeriod } from "./billingPeriod";
import { oneclickAvailability, resolveOneclickGateway, simulatedOneclickAllowed, tryEmitPlatformDte } from "./oneclick";
import { getUfRate, ufCentisToClp, type UfRateRecord } from "./uf";

export type ChargeTrigger = "job" | "platform";

export type ChargeFailureCode =
  | "NO_SUBSCRIPTION"
  | "NO_CARD"
  | "NOT_DUE"
  | "NOTHING_TO_CHARGE"
  | "UF_UNAVAILABLE"
  | "ONECLICK_NOT_AVAILABLE"
  | "ALREADY_ATTEMPTED_TODAY"
  | "IN_PROGRESS"
  | "REJECTED";

export type ChargeResult =
  | {
      approved: true;
      already_paid?: boolean;
      invoice_id: number;
      buy_order: string;
      authorization_code?: string | null;
      amount_uf_centis: number;
      amount_clp: number;
      uf_rate?: UfRateRecord;
      dte?: { dteDocumentId: number | null; dteFolio: number | null; dteStatus: string };
      period_start: string;
      period_end: string;
    }
  | { approved: false; code: ChargeFailureCode; error: string; invoice_id?: number; buy_order?: string; amount_clp?: number };

type SubscriptionRow = {
  subscription_id: number;
  plan_id: number;
  status: string;
  current_period_end: string | null;
  price_clp: number;
  price_uf_centis: number;
};

async function latestSubscription(tenantId: number): Promise<SubscriptionRow | undefined> {
  return await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT s.id AS subscription_id, s.plan_id, s.status, s.current_period_end, p.price_clp, p.price_uf_centis
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = ?
         ORDER BY s.id DESC
         LIMIT 1`,
      )
      .get<SubscriptionRow>(tenantId),
  );
}

async function activateSubscription(subscriptionId: number, periodStart: string, periodEnd: string) {
  await runWithoutTenant(async () => {
    await db
      .prepare(
        `UPDATE subscriptions
         SET status = 'active', current_period_start = ?, current_period_end = ?,
             grace_until = NULL, suspended_at = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(periodStart, periodEnd, subscriptionId);
  });
}

const fail = (code: ChargeFailureCode, error: string, extra: Partial<Extract<ChargeResult, { approved: false }>> = {}): ChargeResult => ({ approved: false, code, error, ...extra });
const isUniqueViolation = (error: unknown) => /unique|duplicate/i.test(error instanceof Error ? error.message : String(error));

/** Monto del período en pesos: planes en UF usan la UF del día; los demás, su precio en pesos. */
function amountFor(sub: SubscriptionRow, uf: UfRateRecord): { amountUfCentis: number; amountClp: number } {
  const amountUfCentis = Number(sub.price_uf_centis || 0);
  return { amountUfCentis, amountClp: amountUfCentis > 0 ? ufCentisToClp(amountUfCentis, uf.value_clp) : Math.round(Number(sub.price_clp || 0)) };
}

/**
 * Cobra a la tarjeta inscrita el período que corresponde. Solo lo invocan el job y el administrador de plataforma.
 * `simulateRejected` existe para pruebas y solo tiene efecto con la pasarela simulada.
 */
export async function chargeTenantSubscription(
  tenantId: number,
  options: { trigger: ChargeTrigger; simulateRejected?: boolean; now?: Date },
): Promise<ChargeResult> {
  const sub = await latestSubscription(tenantId);
  if (!sub) return fail("NO_SUBSCRIPTION", "La empresa no tiene suscripción");

  const today = todayLocal(options.now);
  const advance = options.trigger === "platform" ? MANUAL_CHARGE_ADVANCE_DAYS : 0;
  if (!isPeriodDue(sub.current_period_end, today, advance)) {
    return fail("NOT_DUE", `El período vigente termina el ${String(sub.current_period_end).slice(0, 10)}; aún no corresponde cobrar`);
  }
  const period = nextBillingPeriod(sub.current_period_end, today);

  const previous = await runWithTenant(tenantId, async () =>
    db
      .prepare(
        `SELECT id, status, buy_order, amount_clp, amount_uf_centis, authorization_code, parkia_local_date(created_at) AS created_day
         FROM subscription_invoices
         WHERE tenant_id = ? AND subscription_id = ? AND period_start = ?
         ORDER BY id ASC`,
      )
      .all<{ id: number; status: string; buy_order: string; amount_clp: number; amount_uf_centis: number; authorization_code: string | null; created_day: string }>(
        tenantId, sub.subscription_id, period.start,
      ),
  );
  const paid = previous.find(row => row.status === "paid");
  if (paid) {
    return {
      approved: true, already_paid: true, invoice_id: Number(paid.id), buy_order: paid.buy_order, authorization_code: paid.authorization_code,
      amount_uf_centis: Number(paid.amount_uf_centis), amount_clp: Number(paid.amount_clp), period_start: period.start, period_end: period.end,
    };
  }
  // Un intento que quedó a medias (el servidor cayó entre la pasarela y la base) puede haber cobrado: no se reintenta solo.
  const unresolved = previous.find(row => row.status === "processing");
  if (unresolved) {
    return fail("IN_PROGRESS", "Hay un cobro de este período sin confirmar. Revísalo con la pasarela antes de reintentar", { invoice_id: Number(unresolved.id), buy_order: unresolved.buy_order });
  }
  if (options.trigger === "job" && previous.some(row => row.status === "failed" && String(row.created_day).slice(0, 10) === today)) {
    return fail("ALREADY_ATTEMPTED_TODAY", "Ya se intentó cobrar hoy; el cobro automático reintenta mañana");
  }

  const availability = oneclickAvailability();
  if (!availability.available) return fail("ONECLICK_NOT_AVAILABLE", "El cobro con tarjeta no está habilitado en este servidor");

  const inscription = await runWithTenant(tenantId, async () =>
    db
      .prepare(
        `SELECT username, tbk_user FROM oneclick_inscriptions
         WHERE tenant_id = ? AND status = 'active' AND tbk_user IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get<{ username: string; tbk_user: string }>(tenantId),
  );
  if (!inscription) return fail("NO_CARD", "La empresa no tiene una tarjeta inscrita");

  const uf = await getUfRate(today);
  const { amountUfCentis, amountClp } = amountFor(sub, uf);
  if (amountUfCentis > 0 && !isUfUsable(uf, today)) {
    return fail("UF_UNAVAILABLE", "No hay un valor de UF real y reciente para calcular el cobro. Sincroniza o carga la UF del día");
  }
  if (amountClp <= 0) return fail("NOTHING_TO_CHARGE", "El plan no tiene monto por cobrar");

  // La fila se crea ANTES de llamar a la pasarela, con una orden única por período e intento:
  // dos ejecuciones simultáneas no pueden cobrar dos veces, y un intento a medias queda a la vista.
  const buyOrder = `SUB-${tenantId}-${period.start.replace(/-/g, "")}-${previous.length + 1}`;
  let invoiceId: number;
  try {
    invoiceId = await runWithTenant(tenantId, async () => {
      const inserted = await db
        .prepare(
          `INSERT INTO subscription_invoices (
             tenant_id, subscription_id, plan_id, period_start, period_end,
             uf_date, uf_value_clp, amount_uf_centis, amount_clp, status, buy_order
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
        )
        .run(tenantId, sub.subscription_id, sub.plan_id, period.start, period.end, uf.rate_date, uf.value_clp, amountUfCentis, amountClp, buyOrder);
      return Number(inserted.lastInsertRowid);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("IN_PROGRESS", "Ya hay un cobro de este período en curso", { buy_order: buyOrder });
    throw error;
  }

  const markFailed = async (message: string) => {
    await runWithTenant(tenantId, async () => {
      await db.prepare("UPDATE subscription_invoices SET status = 'failed', error_message = ? WHERE tenant_id = ? AND id = ?").run(message.slice(0, 300), tenantId, invoiceId);
    });
    return fail("REJECTED", message, { invoice_id: invoiceId, buy_order: buyOrder, amount_clp: amountClp });
  };

  // Si esta llamada lanza un error (red caída a mitad de camino) no se sabe si la pasarela alcanzó a cobrar:
  // el intento queda "processing" para revisarlo a mano; no se marca como fallido ni se reintenta solo.
  const charge = await resolveOneclickGateway().authorizeCharge({
    username: inscription.username,
    tbkUser: inscription.tbk_user,
    buyOrder,
    amountClp,
    simulateRejected: Boolean(options.simulateRejected) && availability.simulated && simulatedOneclickAllowed(),
  });
  if (!charge.approved) return await markFailed(charge.errorMessage || "Cargo rechazado");

  const dte = await tryEmitPlatformDte({ subscriberTenantId: tenantId, amountClp, buyOrder });
  await runWithTenant(tenantId, async () => {
    await db
      .prepare(
        `UPDATE subscription_invoices
         SET status = 'paid', authorization_code = ?, dte_document_id = ?, dte_folio = ?, dte_status = ?, paid_at = datetime('now')
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(charge.authorizationCode || null, dte.dteDocumentId, dte.dteFolio, dte.dteStatus, tenantId, invoiceId);
  });
  await activateSubscription(sub.subscription_id, period.start, period.end);

  return {
    approved: true, invoice_id: invoiceId, buy_order: buyOrder, authorization_code: charge.authorizationCode || null,
    amount_uf_centis: amountUfCentis, amount_clp: amountClp, uf_rate: uf, dte, period_start: period.start, period_end: period.end,
  };
}

export type ManualPaymentResult =
  | { ok: true; invoice_id: number; buy_order: string; amount_clp: number; period_start: string; period_end: string; dte: { dteDocumentId: number | null; dteFolio: number | null; dteStatus: string } }
  | { ok: false; code: "NO_SUBSCRIPTION" | "UF_UNAVAILABLE" | "DUPLICATE_REFERENCE" | "NOTHING_TO_CHARGE"; error: string };

/**
 * Registra un pago que Parkia recibió por fuera de la pasarela (transferencia, depósito) y renueva el período.
 * Solo el administrador de plataforma. La referencia del pago es única: registrarla dos veces no renueva dos veces.
 */
export async function recordManualSubscriptionPayment(
  tenantId: number,
  input: { reference: string; amountClp?: number; now?: Date },
): Promise<ManualPaymentResult> {
  const sub = await latestSubscription(tenantId);
  if (!sub) return { ok: false, code: "NO_SUBSCRIPTION", error: "La empresa no tiene suscripción" };

  const today = todayLocal(input.now);
  const period = nextBillingPeriod(sub.current_period_end, today);
  const uf = await getUfRate(today);
  const computed = amountFor(sub, uf);
  if (input.amountClp === undefined && computed.amountUfCentis > 0 && !isUfUsable(uf, today)) {
    return { ok: false, code: "UF_UNAVAILABLE", error: "No hay una UF real para calcular el monto: indica el monto recibido" };
  }
  const amountClp = Math.round(input.amountClp ?? computed.amountClp);
  if (amountClp <= 0) return { ok: false, code: "NOTHING_TO_CHARGE", error: "El monto debe ser mayor que cero" };

  const reference = input.reference.trim();
  const buyOrder = `MAN-${tenantId}-${reference.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "pago"}`;
  let invoiceId: number;
  try {
    invoiceId = await runWithTenant(tenantId, async () => {
      const inserted = await db
        .prepare(
          `INSERT INTO subscription_invoices (
             tenant_id, subscription_id, plan_id, period_start, period_end,
             uf_date, uf_value_clp, amount_uf_centis, amount_clp, status, buy_order, authorization_code, paid_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, datetime('now'))`,
        )
        .run(tenantId, sub.subscription_id, sub.plan_id, period.start, period.end, uf.rate_date, uf.value_clp, computed.amountUfCentis, amountClp, buyOrder, `MANUAL:${reference.slice(0, 60)}`);
      return Number(inserted.lastInsertRowid);
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, code: "DUPLICATE_REFERENCE", error: "Ese pago ya fue registrado (misma referencia)" };
    throw error;
  }

  const dte = await tryEmitPlatformDte({ subscriberTenantId: tenantId, amountClp, buyOrder });
  await runWithTenant(tenantId, async () => {
    await db.prepare("UPDATE subscription_invoices SET dte_document_id = ?, dte_folio = ?, dte_status = ? WHERE tenant_id = ? AND id = ?")
      .run(dte.dteDocumentId, dte.dteFolio, dte.dteStatus, tenantId, invoiceId);
  });
  await activateSubscription(sub.subscription_id, period.start, period.end);
  return { ok: true, invoice_id: invoiceId, buy_order: buyOrder, amount_clp: amountClp, period_start: period.start, period_end: period.end, dte };
}

/**
 * Cobro automático diario: a cada empresa activa cuyo período terminó (o termina hoy) y tiene tarjeta inscrita.
 * Un rechazo no la suspende aquí: el ciclo de vida (`subscriptions.lifecycle`) da 7 días de gracia y este job reintenta a diario.
 */
export async function runSubscriptionChargeJob(now = new Date()) {
  const today = todayLocal(now);
  const candidates = await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT s.tenant_id, s.current_period_end
         FROM subscriptions s
         JOIN tenants t ON t.id = s.tenant_id
         WHERE t.status = 'active' AND s.status IN ('trialing', 'active', 'past_due')
           AND s.id = (SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.tenant_id = s.tenant_id)`,
      )
      .all<{ tenant_id: number; current_period_end: string | null }>(),
  );
  const due = candidates.filter(row => row.current_period_end && isPeriodDue(row.current_period_end, today));

  const summary = { due: due.length, charged: 0, rejected: 0, skipped: 0, reasons: {} as Record<string, number> };
  if (!oneclickAvailability().available) {
    summary.skipped = due.length;
    if (due.length) summary.reasons.ONECLICK_NOT_AVAILABLE = due.length;
    return summary;
  }
  for (const row of due) {
    let result: ChargeResult;
    try {
      result = await chargeTenantSubscription(Number(row.tenant_id), { trigger: "job", now });
    } catch (error) {
      summary.skipped += 1;
      summary.reasons.ERROR = (summary.reasons.ERROR ?? 0) + 1;
      console.error(`[billing] cobro automatico de la empresa ${row.tenant_id} fallo`, error);
      continue;
    }
    if (result.approved === true) {
      summary.charged += result.already_paid ? 0 : 1;
      continue;
    }
    const failure = result as Extract<ChargeResult, { approved: false }>;
    if (failure.code === "REJECTED") summary.rejected += 1;
    else summary.skipped += 1;
    summary.reasons[failure.code] = (summary.reasons[failure.code] ?? 0) + 1;
  }
  return summary;
}
