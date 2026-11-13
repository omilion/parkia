import { db } from "../../db";
import { getBranchTimezone } from "../../platform/timezone";
import { quote as runQuote, type QuoteResult } from "./pricing-engine";
import { applyAgreementDiscounts, extraFreeMinutes } from "../../../shared/offline-pricing";
import { ensureDefaultRatePlan, loadRatePlan, resolveRatePlan, toPricingPlan, type RatePlanRecord } from "./rate-plans";

const DEFAULT_QUOTE_TTL_MINS = 10;

export type AppliedValidation = {
  validation_id: number;
  agreement_id: number;
  name: string;
  code: string;
  kind: "free_minutes" | "percent" | "fixed";
  value: number;
  cap_amount: number | null;
  /** Descuento en pesos que aporto este convenio (los minutos gratis se reflejan en el desglose). */
  discount_amount: number;
};

async function listTicketValidations(ticketId: number | string, tenantId?: number | null) {
  return await db.prepare(`
    SELECT v.id AS validation_id, a.id AS agreement_id, a.name, a.code, a.kind, a.value, a.cap_amount
    FROM ticket_validations v
    JOIN agreements a ON a.id = v.agreement_id
    WHERE v.ticket_id = ? ${tenantId ? "AND v.tenant_id = ?" : ""}
    ORDER BY v.id ASC
  `).all(...(tenantId ? [ticketId, tenantId] : [ticketId])) as Array<Omit<AppliedValidation, "discount_amount">>;
}

/** Tarifa de un ticket: la version con que entro; si es anterior al versionado, la vigente. */
async function planForTicket(ticket: Record<string, any>, tenantId: number): Promise<RatePlanRecord> {
  if (ticket.rate_plan_id) {
    const frozen = await loadRatePlan(Number(ticket.rate_plan_id), tenantId);
    if (frozen) return frozen;
  }
  await ensureDefaultRatePlan(tenantId);
  const resolved = await resolveRatePlan(tenantId, {
    branchId: ticket.branch_id ? Number(ticket.branch_id) : null,
    vehicleType: ticket.vehicle_type || "car",
  });
  if (!resolved) throw new Error("No existe una tarifa vigente para este ticket");
  return resolved;
}

function parseSqlTime(value: string) {
  return new Date(String(value).replace(" ", "T") + "Z");
}

export type VisitorQuoteBreakdown = Pick<QuoteResult, "mode" | "timeZone" | "lines" | "days" | "uncappedSubtotal" | "blocksCharged" | "minutesIntoCurrentBlock"> & {
  extra_free_mins: number;
  validations: AppliedValidation[];
  plan: { id: number; group_id: number; version: number; name: string };
};

export async function calculateVisitorTicketQuote(
  ticketId: string | number,
  options: { quoteAt?: Date; tenantId?: number | null } = {},
) {
  const ticket = options.tenantId
    ? (await db.prepare("SELECT * FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(ticketId, options.tenantId) as
        | Record<string, any>
        | undefined)
    : (await db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(ticketId) as Record<string, any> | undefined);
  if (!ticket) throw new Error("Ticket de visita no encontrado");
  if (ticket.status === "completed") throw new Error("El ticket ya fue completado");

  const tenantId = Number(ticket.tenant_id || options.tenantId);
  const plan = await planForTicket(ticket, tenantId);
  const timeZone = await getBranchTimezone(ticket.branch_id ? Number(ticket.branch_id) : null, tenantId);
  const pricingPlan = toPricingPlan(plan, timeZone);

  const quoteAt = options.quoteAt || new Date();
  const entryTime = parseSqlTime(ticket.entry_time);

  // Convenios: los minutos gratis se suman a la gracia; porcentaje y monto fijo descuentan despues.
  const validations = await listTicketValidations(ticket.id, tenantId);
  const extraFreeMins = extraFreeMinutes(validations);
  const priced = runQuote(pricingPlan, entryTime, quoteAt, { extraFreeMins });

  // La misma funcion que usa el dispositivo sin conexion: la cifra offline y la del servidor no pueden divergir.
  const discounts = applyAgreementDiscounts(priced.subtotal, validations);
  const applied: AppliedValidation[] = validations.map((validation, index) => ({ ...validation, discount_amount: discounts.amounts[index] }));
  const discountAmount = discounts.discount;
  const subtotal = priced.subtotal;
  const total = discounts.total;

  // Precio por minuto de referencia para el comprobante: el de la ultima linea cobrada
  // (o el de la regla inicial si todavia no se cobra nada).
  const ratePerMinute = priced.lines.length
    ? priced.lines[priced.lines.length - 1].unitPrice
    : Number(pricingPlan.rules[0]?.pricePerMinute || 0);
  const quoteTime = quoteAt.toISOString().slice(0, 19).replace("T", " ");
  const expiresAt = new Date(quoteAt.getTime() + DEFAULT_QUOTE_TTL_MINS * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  const breakdown: VisitorQuoteBreakdown = {
    mode: priced.mode, timeZone: priced.timeZone, lines: priced.lines, days: priced.days, uncappedSubtotal: priced.uncappedSubtotal,
    blocksCharged: priced.blocksCharged, minutesIntoCurrentBlock: priced.minutesIntoCurrentBlock,
    extra_free_mins: extraFreeMins, validations: applied,
    plan: { id: plan.id, group_id: plan.group_id, version: plan.version, name: plan.name },
  };

  return {
    ticket,
    plan,
    quote: {
      ticket_id: Number(ticket.id),
      rate_id: null as number | null,
      rate_plan_id: plan.id,
      rate_label: plan.version > 1 ? `${plan.name} (v${plan.version})` : plan.name,
      rate_per_hour: ratePerMinute * 60,
      rate_per_minute: ratePerMinute,
      billing_mode: plan.mode,
      grace_period_mins: plan.grace_mins,
      entry_time: ticket.entry_time,
      quote_time: quoteTime,
      duration_mins: priced.durationMins,
      billable_mins: priced.billableMins,
      subtotal,
      discount_amount: discountAmount,
      total,
      rounding_increment: 0,
      expires_at: expiresAt,
      inside_grace: total === 0,
      vehicle_type: ticket.vehicle_type || "car",
      breakdown,
    },
  };
}

export async function createVisitorTicketQuote(
  ticketId: string | number,
  options: { tenantId?: number | null; quoteAt?: Date } = {},
) {
  const calculated = await calculateVisitorTicketQuote(ticketId, { tenantId: options.tenantId, quoteAt: options.quoteAt });
  const quote = calculated.quote;

  const result = await db.prepare(`
    INSERT INTO visitor_ticket_quotes (
      ticket_id, rate_id, rate_plan_id, rate_label, rate_per_hour, rate_per_minute, billing_mode, grace_period_mins, entry_time, quote_time,
      duration_mins, billable_mins, subtotal, discount_amount, total, rounding_increment, expires_at, breakdown_json, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    quote.ticket_id,
    quote.rate_id,
    quote.rate_plan_id,
    quote.rate_label,
    quote.rate_per_hour,
    quote.rate_per_minute,
    quote.billing_mode,
    quote.grace_period_mins,
    quote.entry_time,
    quote.quote_time,
    quote.duration_mins,
    quote.billable_mins,
    quote.subtotal,
    quote.discount_amount,
    quote.total,
    quote.rounding_increment,
    quote.expires_at,
    JSON.stringify(quote.breakdown),
    options.tenantId || calculated.ticket.tenant_id || null,
  );

  return { ...quote, id: Number(result.lastInsertRowid), amount: quote.total };
}

export async function getUsableVisitorQuote(
  ticketId: string | number,
  quoteId?: number | null,
  options: { tenantId?: number | null } = {},
) {
  const tenantFilter = options.tenantId ? " AND tenant_id = ?" : "";
  const quote = quoteId
    ? (await db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE id = ? AND ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
      `).get(...(options.tenantId ? [quoteId, ticketId, options.tenantId] : [quoteId, ticketId])) as
        | Record<string, any>
        | undefined)
    : (await db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
        ORDER BY id DESC
        LIMIT 1
      `).get(...(options.tenantId ? [ticketId, options.tenantId] : [ticketId])) as Record<string, any> | undefined);

  if (quote) return quote;
  return await createVisitorTicketQuote(ticketId, options);
}

