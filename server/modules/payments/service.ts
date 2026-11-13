import { randomBytes } from "node:crypto";
import { db } from "../../db";
import { runWithoutTenant, runWithTenant } from "../../db/engine/context";
import { decryptSecretString, encryptSecret } from "../../platform/secrets";
import { dteService } from "../dte/instance";
import { markPaymentAsPaid } from "../finance/shared";
import { calculateVisitorTicketQuote, createVisitorTicketQuote } from "../tickets/pricing";
import type { PaymentSettingsValues } from "../../../shared/schemas/gateways";
import {
  createMockGateway, PaymentGatewayError, type ChargeStatus, type PaymentGateway, type Redirect, type WebhookEvent,
} from "./gateway";
import { createWebpayGateway, WEBPAY_INTEGRATION } from "./webpay";

/**
 * Intentos de pago (`payment_intents`) y su ciclo de vida.
 *
 * Regla central: un ticket o una cuota solo pasan a "pagado" cuando la pasarela lo confirma
 * (retorno + commit, webhook firmado o conciliacion). Nunca por lo que diga el navegador del cliente.
 */

export class PaymentError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "PAYMENT_ERROR") {
    super(message);
    this.name = "PaymentError";
  }
}

export type ProviderId = "webpay" | "mock";
export const providerLabels: Record<ProviderId, string> = {
  webpay: "Tarjeta de crédito o débito (Webpay)",
  mock: "Pago simulado (solo pruebas)",
};

export type IntentRow = {
  id: number;
  tenant_id: number;
  public_id: string;
  kind: "visitor_ticket" | "receivable";
  ticket_id: number | null;
  payment_id: number | null;
  provider: ProviderId;
  status: "created" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded";
  amount: number;
  idempotency_key: string;
  buy_order: string;
  provider_token: string | null;
  authorization_code: string | null;
  card_last4: string | null;
  quote_id: number | null;
  failure_reason: string | null;
  expires_at: string | null;
};

const INTENT_TTL_MINUTES = 15;
const RECEIVABLE_LINK_DAYS = 14;
const DEFAULT_EXIT_WINDOW_MINS = 15;

// ------------------------------------------------------------------ utilidades
const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");
const randomId = (prefix: string, bytes = 18) => `${prefix}${randomBytes(bytes).toString("base64url")}`;

let fetchOverride: typeof fetch | undefined;
/** Solo para pruebas: reemplaza el `fetch` que usa el adaptador de Webpay. */
export function setPaymentFetchForTesting(impl: typeof fetch | undefined) {
  fetchOverride = impl;
}

/** La pasarela simulada nunca corre en produccion. */
export function mockGatewayAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.PARKIA_ALLOW_MOCK_PAYMENTS === "true";
}

const mockGateway = createMockGateway();

type SettingsRow = {
  id: number; tenant_id: number; provider: ProviderId; environment: "integration" | "production";
  commerce_code: string | null; api_secret_encrypted: string | null; enabled: number; exit_window_mins: number;
};

// ------------------------------------------------------------------ configuracion por empresa
export async function getPaymentSettings(tenantId: number) {
  const rows = await db.prepare("SELECT * FROM payment_settings WHERE tenant_id = ? ORDER BY id").all(tenantId) as SettingsRow[];
  const find = (provider: ProviderId) => rows.find(row => row.provider === provider);
  const view = (provider: ProviderId) => {
    const row = find(provider);
    return {
      provider,
      label: providerLabels[provider],
      enabled: Boolean(row?.enabled),
      environment: row?.environment ?? "integration",
      commerce_code: row?.commerce_code ?? "",
      has_secret: Boolean(row?.api_secret_encrypted),
      uses_integration_credentials: provider === "webpay" && (row?.environment ?? "integration") === "integration" && !row?.api_secret_encrypted,
      exit_window_mins: row?.exit_window_mins ?? DEFAULT_EXIT_WINDOW_MINS,
    };
  };
  return {
    providers: [view("webpay"), ...(mockGatewayAllowed() ? [view("mock")] : [])],
    mock_allowed: mockGatewayAllowed(),
    exit_window_mins: await getExitWindow(tenantId),
  };
}

export async function savePaymentSettings(tenantId: number, values: PaymentSettingsValues) {
  if (values.provider === "mock" && !mockGatewayAllowed()) throw new PaymentError("La pasarela simulada no está disponible en producción", 400, "MOCK_DISABLED");
  const current = await db.prepare("SELECT * FROM payment_settings WHERE tenant_id = ? AND provider = ?").get(tenantId, values.provider) as SettingsRow | undefined;

  let secret = current?.api_secret_encrypted ?? null;
  if (values.api_secret) secret = encryptSecret(values.api_secret, { tenantId, purpose: `payments.${values.provider}.secret` });
  const commerceCode = values.commerce_code?.trim() || current?.commerce_code || null;

  if (values.provider === "webpay" && values.environment === "production" && values.enabled && (!commerceCode || !secret)) {
    throw new PaymentError("Para cobrar en producción ingresa el código de comercio y la llave secreta que entrega Transbank", 400, "MISSING_CREDENTIALS");
  }
  if (current) {
    await db.prepare(`
      UPDATE payment_settings SET environment = ?, commerce_code = ?, api_secret_encrypted = ?, enabled = ?, exit_window_mins = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).run(values.environment, commerceCode, secret, values.enabled ? 1 : 0, values.exit_window_mins, current.id, tenantId);
  } else {
    await db.prepare(`
      INSERT INTO payment_settings (tenant_id, provider, environment, commerce_code, api_secret_encrypted, enabled, exit_window_mins)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, values.provider, values.environment, commerceCode, secret, values.enabled ? 1 : 0, values.exit_window_mins);
  }
  return await getPaymentSettings(tenantId);
}

async function getExitWindow(tenantId: number) {
  const row = await db.prepare("SELECT exit_window_mins FROM payment_settings WHERE tenant_id = ? ORDER BY enabled DESC, id ASC LIMIT 1").get(tenantId) as { exit_window_mins: number } | undefined;
  return row?.exit_window_mins ?? DEFAULT_EXIT_WINDOW_MINS;
}

export async function availableProviders(tenantId: number) {
  const rows = await db.prepare("SELECT provider FROM payment_settings WHERE tenant_id = ? AND enabled = 1 ORDER BY id").all(tenantId) as Array<{ provider: ProviderId }>;
  return rows
    .filter(row => row.provider !== "mock" || mockGatewayAllowed())
    .map(row => ({ id: row.provider, label: providerLabels[row.provider] }));
}

export async function resolveGateway(tenantId: number, provider: ProviderId): Promise<PaymentGateway> {
  const row = await db.prepare("SELECT * FROM payment_settings WHERE tenant_id = ? AND provider = ?").get(tenantId, provider) as SettingsRow | undefined;
  if (!row?.enabled) throw new PaymentError("Esta forma de pago no está disponible", 409, "PROVIDER_DISABLED");
  if (provider === "mock") {
    if (!mockGatewayAllowed()) throw new PaymentError("Esta forma de pago no está disponible", 409, "PROVIDER_DISABLED");
    return mockGateway;
  }
  if (row.environment === "integration") {
    const hasOwn = row.commerce_code && row.api_secret_encrypted;
    return createWebpayGateway({
      environment: "integration",
      commerceCode: hasOwn ? row.commerce_code! : WEBPAY_INTEGRATION.commerceCode,
      apiKey: hasOwn ? decryptSecretString(row.api_secret_encrypted!, { tenantId, purpose: "payments.webpay.secret" }) : WEBPAY_INTEGRATION.apiKey,
      fetchImpl: fetchOverride,
    });
  }
  if (!row.commerce_code || !row.api_secret_encrypted) throw new PaymentError("Webpay no tiene credenciales de producción configuradas", 409, "MISSING_CREDENTIALS");
  return createWebpayGateway({
    environment: "production",
    commerceCode: row.commerce_code,
    apiKey: decryptSecretString(row.api_secret_encrypted, { tenantId, purpose: "payments.webpay.secret" }),
    fetchImpl: fetchOverride,
  });
}

// ------------------------------------------------------------------ tokens y enlaces
export async function ensureTicketPayToken(tenantId: number, ticketId: number) {
  const ticket = await db.prepare("SELECT id, public_token FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(ticketId, tenantId) as { id: number; public_token: string | null } | undefined;
  if (!ticket) throw new PaymentError("Ticket no encontrado", 404, "TICKET_NOT_FOUND");
  if (ticket.public_token) return ticket.public_token;
  const token = randomId("t_");
  await db.prepare("UPDATE visitor_tickets SET public_token = ? WHERE id = ? AND tenant_id = ? AND public_token IS NULL").run(token, ticketId, tenantId);
  const stored = await db.prepare("SELECT public_token FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(ticketId, tenantId) as { public_token: string };
  return stored.public_token;
}

/** Enlace de pago de una cuota de abonado. Reutiliza el enlace vigente para no multiplicar intentos. */
export async function createReceivableLink(tenantId: number, paymentId: number) {
  const payment = await db.prepare("SELECT id, amount, status FROM payments WHERE id = ? AND tenant_id = ?").get(paymentId, tenantId) as { id: number; amount: number; status: string } | undefined;
  if (!payment) throw new PaymentError("Cuota no encontrada", 404, "PAYMENT_NOT_FOUND");
  if (payment.status === "paid" || payment.status === "cancelled") throw new PaymentError("Esta cuota ya no admite pago", 409, "NOT_PAYABLE");
  const amount = Math.round(Number(payment.amount));
  if (amount <= 0) throw new PaymentError("La cuota no tiene monto por pagar", 409, "NOTHING_TO_PAY");
  const providers = await availableProviders(tenantId);
  if (!providers.length) throw new PaymentError("Activa una forma de pago en Configuración antes de generar enlaces", 409, "NO_PROVIDER");

  const existing = await db.prepare(`
    SELECT * FROM payment_intents
    WHERE tenant_id = ? AND payment_id = ? AND kind = 'receivable' AND status IN ('created', 'pending', 'failed', 'cancelled') AND amount = ? AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1
  `).get(tenantId, paymentId, amount) as IntentRow | undefined;
  if (existing) return { token: `r_${existing.public_id}`, amount, expires_at: existing.expires_at };

  const publicId = randomId("pi_");
  const expiresAt = sqlTime(new Date(Date.now() + RECEIVABLE_LINK_DAYS * 86_400_000));
  await db.prepare(`
    INSERT INTO payment_intents (tenant_id, public_id, kind, payment_id, provider, status, amount, idempotency_key, buy_order, expires_at)
    VALUES (?, ?, 'receivable', ?, ?, 'created', ?, ?, ?, ?)
  `).run(tenantId, publicId, paymentId, providers[0].id, amount, `receivable:${paymentId}:${publicId}`, buyOrder(), expiresAt);
  return { token: `r_${publicId}`, amount, expires_at: expiresAt };
}

const buyOrder = () => `PK${randomBytes(9).toString("hex")}`; // 20 caracteres (maximo Transbank: 26)

// ------------------------------------------------------------------ eventos
async function addEvent(intent: Pick<IntentRow, "id" | "tenant_id">, kind: string, payload?: unknown, externalId?: string | null) {
  await db.prepare("INSERT INTO payment_events (tenant_id, intent_id, kind, external_id, payload_json) VALUES (?, ?, ?, ?, ?)")
    .run(intent.tenant_id, intent.id, kind, externalId ?? null, payload === undefined ? null : JSON.stringify(payload));
}

// ------------------------------------------------------------------ pagina publica
async function findIntentByPublicId(publicId: string) {
  return await runWithoutTenant(() => db.prepare("SELECT * FROM payment_intents WHERE public_id = ? AND kind = 'receivable'").get(publicId)) as IntentRow | undefined;
}

async function findIntentByToken(provider: string, token: string) {
  return await runWithoutTenant(() => db.prepare("SELECT * FROM payment_intents WHERE provider = ? AND provider_token = ?").get(provider, token)) as IntentRow | undefined;
}

async function companyName(tenantId: number) {
  const row = await db.prepare("SELECT company_name FROM tenant_settings WHERE tenant_id = ?").get(tenantId) as { company_name: string | null } | undefined;
  return row?.company_name || "Estacionamiento";
}

export async function getPublicPayment(token: string) {
  if (token.startsWith("t_")) {
    const ticket = await runWithoutTenant(() => db.prepare("SELECT * FROM visitor_tickets WHERE public_token = ?").get(token)) as Record<string, any> | undefined;
    if (!ticket) throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
    return await runWithTenant(Number(ticket.tenant_id), async () => {
      const tenantId = Number(ticket.tenant_id);
      const base = { kind: "ticket" as const, company: await companyName(tenantId), plate: ticket.plate as string };
      if (ticket.status !== "active") {
        return { ...base, status: ticket.status as "paid" | "completed", amount: Math.round(Number(ticket.amount || 0)), paid_at: ticket.paid_at ?? null, exit_deadline: ticket.exit_deadline ?? null, providers: [] };
      }
      const { quote } = await calculateVisitorTicketQuote(ticket.id, { tenantId });
      return {
        ...base, status: "active" as const, amount: Math.round(quote.total), subtotal: Math.round(quote.subtotal), discount_amount: Math.round(quote.discount_amount),
        duration_minutes: quote.duration_mins, entry_time: ticket.entry_time as string, rate_label: quote.rate_label,
        exit_window_mins: await getExitWindow(tenantId), providers: await availableProviders(tenantId),
      };
    });
  }
  if (token.startsWith("r_")) {
    const intent = await findIntentByPublicId(token.slice(2));
    if (!intent) throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
    return await runWithTenant(intent.tenant_id, async () => {
      const payment = await db.prepare("SELECT amount, due_date, status FROM payments WHERE id = ? AND tenant_id = ?").get(intent.payment_id, intent.tenant_id) as { amount: number; due_date: string; status: string } | undefined;
      const expired = intent.expires_at ? new Date(String(intent.expires_at).replace(" ", "T") + "Z").getTime() < Date.now() : false;
      const paid = payment?.status === "paid" || intent.status === "paid";
      return {
        kind: "receivable" as const, company: await companyName(intent.tenant_id), due_date: payment?.due_date ?? null,
        status: paid ? ("paid" as const) : expired ? ("expired" as const) : ("active" as const),
        amount: Math.round(Number(payment?.amount ?? intent.amount)),
        providers: paid || expired ? [] : await availableProviders(intent.tenant_id),
      };
    });
  }
  throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
}

// ------------------------------------------------------------------ iniciar un pago
async function chargeIntent(intent: IntentRow, gateway: PaymentGateway, baseUrl: string): Promise<Redirect> {
  try {
    const charge = await gateway.createCharge({
      buyOrder: intent.buy_order, amount: intent.amount, sessionId: intent.public_id,
      returnUrl: `${baseUrl}/api/public/payments/return/${gateway.id}`,
    });
    await db.prepare("UPDATE payment_intents SET provider = ?, provider_token = ?, status = 'pending', updated_at = datetime('now') WHERE id = ? AND tenant_id = ?")
      .run(gateway.id, charge.providerToken, intent.id, intent.tenant_id);
    await addEvent(intent, "charge_created", { provider: gateway.id });
    return charge.redirect;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error de la pasarela";
    await db.prepare("UPDATE payment_intents SET status = 'failed', failure_reason = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(reason, intent.id, intent.tenant_id);
    await addEvent(intent, "charge_failed", { reason });
    throw error;
  }
}

export async function startPublicPayment(token: string, input: { provider: ProviderId; baseUrl: string; idempotencyKey?: string | null }) {
  if (token.startsWith("t_")) {
    const ticket = await runWithoutTenant(() => db.prepare("SELECT id, tenant_id, status FROM visitor_tickets WHERE public_token = ?").get(token)) as { id: number; tenant_id: number; status: string } | undefined;
    if (!ticket) throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
    return await runWithTenant(ticket.tenant_id, async () => {
      const tenantId = ticket.tenant_id;
      if (ticket.status !== "active") throw new PaymentError(ticket.status === "paid" ? "Este ticket ya está pagado" : "Este ticket ya fue cerrado", 409, "NOT_PAYABLE");
      const gateway = await resolveGateway(tenantId, input.provider);

      const idempotencyKey = input.idempotencyKey ? `client:${ticket.id}:${input.idempotencyKey}` : null;
      if (idempotencyKey) {
        const repeated = await db.prepare("SELECT * FROM payment_intents WHERE tenant_id = ? AND idempotency_key = ?").get(tenantId, idempotencyKey) as IntentRow | undefined;
        if (repeated?.provider_token && (repeated.status === "pending" || repeated.status === "created")) return { redirect: gateway.redirectFor(repeated.provider_token), intent: repeated.public_id };
        if (repeated) throw new PaymentError("Ese intento de pago ya fue procesado", 409, "IDEMPOTENT_REPLAY");
      }

      const quote = await createVisitorTicketQuote(ticket.id, { tenantId });
      const amount = Math.round(Number(quote.total));
      if (amount <= 0) throw new PaymentError("Este ticket no tiene monto por pagar", 409, "NOTHING_TO_PAY");

      // Un doble clic no abre dos cobros: si ya hay uno vigente por el mismo monto, se reanuda.
      const open = await db.prepare(`
        SELECT * FROM payment_intents
        WHERE tenant_id = ? AND ticket_id = ? AND provider = ? AND status = 'pending' AND amount = ? AND expires_at > datetime('now') AND provider_token IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `).get(tenantId, ticket.id, input.provider, amount) as IntentRow | undefined;
      if (open?.provider_token) return { redirect: gateway.redirectFor(open.provider_token), intent: open.public_id };

      const publicId = randomId("pi_");
      await db.prepare(`
        INSERT INTO payment_intents (tenant_id, public_id, kind, ticket_id, provider, status, amount, idempotency_key, buy_order, quote_id, expires_at)
        VALUES (?, ?, 'visitor_ticket', ?, ?, 'created', ?, ?, ?, ?, ?)
      `).run(tenantId, publicId, ticket.id, input.provider, amount, idempotencyKey ?? `ticket:${ticket.id}:q${quote.id}`, buyOrder(), quote.id, sqlTime(new Date(Date.now() + INTENT_TTL_MINUTES * 60_000)));
      const intent = await db.prepare("SELECT * FROM payment_intents WHERE tenant_id = ? AND public_id = ?").get(tenantId, publicId) as IntentRow;
      return { redirect: await chargeIntent(intent, gateway, input.baseUrl), intent: publicId };
    });
  }

  if (token.startsWith("r_")) {
    const found = await findIntentByPublicId(token.slice(2));
    if (!found) throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
    return await runWithTenant(found.tenant_id, async () => {
      const intent = await db.prepare("SELECT * FROM payment_intents WHERE id = ? AND tenant_id = ?").get(found.id, found.tenant_id) as IntentRow;
      const payment = await db.prepare("SELECT amount, status FROM payments WHERE id = ? AND tenant_id = ?").get(intent.payment_id, intent.tenant_id) as { amount: number; status: string } | undefined;
      if (!payment || payment.status === "paid" || payment.status === "cancelled" || intent.status === "paid" || intent.status === "refunded") throw new PaymentError("Esta cuota ya no admite pago", 409, "NOT_PAYABLE");
      if (Math.round(Number(payment.amount)) !== intent.amount) throw new PaymentError("El monto de la cuota cambió; pide un enlace nuevo", 409, "AMOUNT_CHANGED");
      const expired = intent.expires_at ? new Date(String(intent.expires_at).replace(" ", "T") + "Z").getTime() < Date.now() : false;
      if (expired) throw new PaymentError("El enlace de pago venció; pide uno nuevo", 410, "LINK_EXPIRED");
      const gateway = await resolveGateway(intent.tenant_id, input.provider);
      if (intent.status === "pending" && intent.provider === input.provider && intent.provider_token) return { redirect: gateway.redirectFor(intent.provider_token), intent: intent.public_id };
      return { redirect: await chargeIntent(intent, gateway, input.baseUrl), intent: intent.public_id };
    });
  }
  throw new PaymentError("El enlace de pago no es válido", 404, "NOT_FOUND");
}

// ------------------------------------------------------------------ confirmar y aplicar
export type SettleResult = "paid" | "failed" | "cancelled" | "pending" | "duplicate" | "refunded";

async function applyToTicket(intent: IntentRow): Promise<"applied" | "duplicate"> {
  const ticket = await db.prepare("SELECT id, status FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(intent.ticket_id, intent.tenant_id) as { id: number; status: string } | undefined;
  if (!ticket || ticket.status !== "active") return "duplicate";
  const deadline = sqlTime(new Date(Date.now() + (await getExitWindow(intent.tenant_id)) * 60_000));
  const updated = await db.prepare(`
    UPDATE visitor_tickets
    SET status = 'paid', payment_method = 'card', amount = ?, paid_at = datetime('now'), quote_id = ?, quoted_amount = ?, exit_deadline = ?
    WHERE id = ? AND tenant_id = ? AND status = 'active'
  `).run(intent.amount, intent.quote_id, intent.amount, deadline, ticket.id, intent.tenant_id);
  if (updated.changes !== 1) return "duplicate";
  if (intent.quote_id) await db.prepare("UPDATE visitor_ticket_quotes SET status = 'used' WHERE id = ? AND tenant_id = ?").run(intent.quote_id, intent.tenant_id);
  return "applied";
}

async function applyToReceivable(intent: IntentRow, status: ChargeStatus): Promise<"applied" | "duplicate"> {
  const payment = await db.prepare("SELECT status FROM payments WHERE id = ? AND tenant_id = ?").get(intent.payment_id, intent.tenant_id) as { status: string } | undefined;
  if (!payment || payment.status === "paid" || payment.status === "cancelled") return "duplicate";
  await markPaymentAsPaid({
    paymentId: intent.payment_id!, method: "card", paymentDate: new Date().toISOString(),
    reference: `${intent.provider}:${status.authorizationCode || intent.buy_order}`,
  });
  return "applied";
}

async function afterTicketPaid(intent: IntentRow) {
  try {
    const ticket = await db.prepare("SELECT plate, branch_id FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(intent.ticket_id, intent.tenant_id) as { plate: string; branch_id: number | null };
    const quote = intent.quote_id ? await db.prepare("SELECT duration_mins FROM visitor_ticket_quotes WHERE id = ? AND tenant_id = ?").get(intent.quote_id, intent.tenant_id) as { duration_mins: number } | undefined : undefined;
    // La boleta nunca puede hacer fallar un pago ya confirmado: si no se emite, la conciliacion la reintenta.
    await dteService.issueBoletaForTicket(intent.tenant_id, { ticketId: intent.ticket_id!, plate: ticket.plate, amount: intent.amount, durationMins: quote?.duration_mins ?? null, branchId: ticket.branch_id });
  } catch {
    /* El detalle queda en dte_events. */
  }
}

/**
 * Aplica el resultado informado por la pasarela. Es idempotente: procesar dos veces la misma
 * confirmacion (retorno + conciliacion + webhook) deja un solo pago.
 */
export async function settleIntent(intent: IntentRow, status: ChargeStatus, gateway: PaymentGateway): Promise<SettleResult> {
  if (status.state === "pending") return "pending";
  if (intent.status === "paid" || intent.status === "refunded") return intent.status === "paid" ? "paid" : "refunded";

  if (status.state !== "paid") {
    const next = status.state === "cancelled" ? "cancelled" : "failed";
    const changed = await db.prepare(`
      UPDATE payment_intents SET status = ?, failure_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND status IN ('created', 'pending')
    `).run(next, status.reason ?? null, intent.id, intent.tenant_id);
    if (changed.changes === 1) await addEvent(intent, next, { reason: status.reason ?? null });
    return next;
  }

  const mismatch = status.amount != null && Math.round(status.amount) !== intent.amount;
  let outcome: "applied" | "duplicate" | "mismatch" | "already" | "apply_failed" = "already";
  let applyError = "";
  await db.transaction(async () => {
    const claimed = await db.prepare(`
      UPDATE payment_intents
      SET status = 'paid', authorization_code = ?, card_last4 = ?, paid_at = datetime('now'), failure_reason = NULL, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND status NOT IN ('paid', 'refunded')
    `).run(status.authorizationCode ?? null, status.cardLast4 ?? null, intent.id, intent.tenant_id);
    if (claimed.changes !== 1) return;
    await addEvent(intent, "paid", { authorization_code: status.authorizationCode ?? null, amount: status.amount ?? null });
    if (mismatch) { outcome = "mismatch"; return; }
    try {
      // Punto de guardado propio: si aplicar el pago falla, el cobro de la pasarela igual queda registrado.
      outcome = await db.transaction(async () => intent.kind === "visitor_ticket" ? await applyToTicket(intent) : await applyToReceivable(intent, status))();
    } catch (error) {
      outcome = "apply_failed";
      applyError = error instanceof Error ? error.message : String(error);
    }
  })();

  if (outcome === "already") return "paid";
  if (outcome === "applied") {
    if (intent.kind === "visitor_ticket") await afterTicketPaid(intent);
    return "paid";
  }
  if (outcome === "apply_failed") {
    await db.prepare("UPDATE payment_intents SET failure_reason = ? WHERE id = ? AND tenant_id = ?").run(`No se pudo aplicar el pago: ${applyError}`, intent.id, intent.tenant_id);
    await addEvent(intent, "apply_failed", { error: applyError });
    return "paid";
  }

  // Cobro duplicado (el ticket ya se pagó en caja) o por un monto distinto al esperado: se devuelve el dinero.
  const reason = outcome === "mismatch" ? "amount_mismatch" : "duplicate_payment";
  const refund = await gateway.refund(intent.provider_token!, Math.round(status.amount ?? intent.amount)).catch(error => ({ ok: false, reason: String(error?.message || error), raw: undefined }));
  if (refund.ok) {
    await db.prepare("UPDATE payment_intents SET status = 'refunded', failure_reason = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(reason, intent.id, intent.tenant_id);
    await addEvent(intent, "refunded", { reason });
    return outcome === "mismatch" ? "refunded" : "duplicate";
  }
  await db.prepare("UPDATE payment_intents SET failure_reason = ? WHERE id = ? AND tenant_id = ?").run(`${reason}_refund_failed`, intent.id, intent.tenant_id);
  await addEvent(intent, "refund_failed", { reason, detail: refund.reason ?? null });
  return outcome === "mismatch" ? "failed" : "duplicate";
}

export type ReturnParams = { token_ws?: string; TBK_TOKEN?: string };

/** Retorno del cliente desde la pasarela: confirma en la pasarela y calcula a donde volver. */
export async function handleGatewayReturn(provider: ProviderId, params: ReturnParams): Promise<{ location: string }> {
  const token = params.token_ws || params.TBK_TOKEN;
  const fallback = "/pagar/resultado?result=error";
  if (!token) return { location: fallback };
  const intent = await findIntentByToken(provider, String(token));
  if (!intent) return { location: fallback };

  return await runWithTenant(intent.tenant_id, async () => {
    const gateway = await resolveGateway(intent.tenant_id, provider);
    let result: SettleResult;
    try {
      if (params.token_ws && !params.TBK_TOKEN) {
        result = await settleIntent(intent, await gateway.confirm(params.token_ws), gateway);
      } else {
        // TBK_TOKEN sin token_ws: el cliente anulo el pago o se agoto el tiempo en Webpay.
        result = await settleIntent(intent, { state: "cancelled", reason: "El cliente anuló el pago o se agotó el tiempo" }, gateway);
      }
    } catch (error) {
      if (!(error instanceof PaymentGatewayError)) throw error;
      result = "pending"; // La conciliacion lo resuelve cuando la pasarela vuelva a responder.
    }
    const link = await linkTokenFor(intent);
    const label = result === "paid" ? "paid" : result === "duplicate" ? "duplicate" : result === "pending" ? "pending" : result === "cancelled" ? "cancelled" : "failed";
    return { location: link ? `/pagar/${link}?result=${label}` : fallback };
  });
}

async function linkTokenFor(intent: IntentRow) {
  if (intent.kind === "receivable") return `r_${intent.public_id}`;
  const ticket = await db.prepare("SELECT public_token FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(intent.ticket_id, intent.tenant_id) as { public_token: string | null } | undefined;
  return ticket?.public_token ?? null;
}

// ------------------------------------------------------------------ webhooks
export async function processWebhook(provider: ProviderId, headers: Record<string, string | string[] | undefined>, rawBody: Buffer) {
  if (provider !== "mock" || !mockGatewayAllowed()) throw new PaymentError("Proveedor sin webhooks", 404, "NO_WEBHOOKS");
  const event: WebhookEvent | null = mockGateway.parseWebhook({ headers, rawBody }); // lanza WebhookSignatureError
  if (!event) throw new PaymentError("Proveedor sin webhooks", 404, "NO_WEBHOOKS");

  const intent = await findIntentByToken(provider, event.providerToken);
  if (!intent) return { ok: true as const, ignored: "unknown_token" as const };
  return await runWithTenant(intent.tenant_id, async () => {
    const externalId = `${provider}:${event.eventId}`;
    const seen = await db.prepare("SELECT id FROM payment_events WHERE external_id = ?").get(externalId);
    if (seen) return { ok: true as const, ignored: "duplicate_event" as const };
    try {
      await addEvent(intent, "webhook", { state: event.status.state }, externalId);
    } catch {
      return { ok: true as const, ignored: "duplicate_event" as const }; // otro proceso lo registro primero
    }
    const result = await settleIntent(intent, event.status, mockGateway);
    return { ok: true as const, result };
  });
}

// ------------------------------------------------------------------ conciliacion
/** Revisa intentos sin resolver: confirma los que la pasarela ya cobro y vence los abandonados. */
export async function reconcilePendingIntents(limit = 100) {
  const rows = await runWithoutTenant(() => db.prepare(`
    SELECT * FROM payment_intents WHERE status IN ('created', 'pending') AND created_at < datetime('now', '-2 minutes') ORDER BY id LIMIT ?
  `).all(limit)) as IntentRow[];
  const summary = { checked: rows.length, paid: 0, expired: 0, errors: 0 };
  for (const intent of rows) {
    try {
      await runWithTenant(intent.tenant_id, async () => {
        const expired = intent.expires_at ? new Date(String(intent.expires_at).replace(" ", "T") + "Z").getTime() < Date.now() : false;
        if (intent.provider_token) {
          const gateway = await resolveGateway(intent.tenant_id, intent.provider);
          const status = await gateway.getStatus(intent.provider_token);
          if (status.state === "paid") {
            await settleIntent(intent, status, gateway);
            summary.paid += 1;
            return;
          }
        }
        if (expired) {
          const changed = await db.prepare("UPDATE payment_intents SET status = 'expired', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status IN ('created', 'pending')").run(intent.id, intent.tenant_id);
          if (changed.changes === 1) { await addEvent(intent, "expired"); summary.expired += 1; }
        }
      });
    } catch {
      summary.errors += 1;
    }
  }
  return summary;
}

export async function listIntentsForTicket(tenantId: number, ticketId: number) {
  return await db.prepare(`
    SELECT public_id, provider, status, amount, authorization_code, card_last4, failure_reason, paid_at, created_at
    FROM payment_intents WHERE tenant_id = ? AND ticket_id = ? ORDER BY id DESC
  `).all(tenantId, ticketId);
}

// ------------------------------------------------------------------ pasarela simulada (pruebas)
export async function decideMockPayment(token: string, outcome: "approve" | "reject" | "cancel") {
  if (!mockGatewayAllowed()) throw new PaymentError("No disponible", 404, "MOCK_DISABLED");
  const intent = await findIntentByToken("mock", token);
  if (!intent) throw new PaymentError("Pago no encontrado", 404, "NOT_FOUND");
  const { signWebhook } = await import("./gateway");
  const body = Buffer.from(JSON.stringify({
    event_id: `evt_${randomBytes(8).toString("hex")}`, token, amount: intent.amount,
    status: outcome === "approve" ? "paid" : outcome === "cancel" ? "cancelled" : "failed",
    authorization_code: "123456", card_last4: "4242", reason: outcome === "reject" ? "Tarjeta rechazada (simulación)" : outcome === "cancel" ? "Pago anulado (simulación)" : null,
  }));
  const signed = signWebhook(body);
  const result = await processWebhook("mock", { "x-parkia-timestamp": signed.timestamp, "x-parkia-signature": signed.signature }, body);
  const link = await runWithTenant(intent.tenant_id, () => linkTokenFor(intent));
  return { result, location: link ? `/pagar/${link}?result=${outcome === "approve" ? "paid" : outcome === "cancel" ? "cancelled" : "failed"}` : "/pagar/resultado?result=error" };
}

export async function getMockPaymentInfo(token: string) {
  if (!mockGatewayAllowed()) throw new PaymentError("No disponible", 404, "MOCK_DISABLED");
  const intent = await findIntentByToken("mock", token);
  if (!intent) throw new PaymentError("Pago no encontrado", 404, "NOT_FOUND");
  return await runWithTenant(intent.tenant_id, async () => ({
    company: await companyName(intent.tenant_id), amount: intent.amount, status: intent.status,
  }));
}
