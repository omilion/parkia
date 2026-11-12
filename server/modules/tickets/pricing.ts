import { db } from "../../db";

const DEFAULT_QUOTE_TTL_MINS = 10;

function getGeneralVisitorRate(tenantId?: number | null) {
  const params: number[] = [];
  let tenantFilter = "";
  if (tenantId) {
    tenantFilter = "AND tenant_id = ?";
    params.push(tenantId);
  }

  return db.prepare(`
    SELECT *
    FROM access_rates
    WHERE (
      lower(replace(replace(type, 'ú', 'u'), 'Ú', 'U')) IN ('publico general', 'público general')
      OR lower(type) LIKE '%general%'
    )
      ${tenantFilter}
    ORDER BY
      CASE WHEN lower(type) LIKE '%general%' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
  `).get(...params) as Record<string, any> | undefined;
}

export function calculateVisitorTicketQuote(
  ticketId: string | number,
  options: { quoteAt?: Date; tenantId?: number | null } = {},
) {
  const ticket = options.tenantId
    ? (db.prepare("SELECT * FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(ticketId, options.tenantId) as
        | Record<string, any>
        | undefined)
    : (db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(ticketId) as Record<string, any> | undefined);
  if (!ticket) throw new Error("Ticket de visita no encontrado");
  if (ticket.status === "completed") throw new Error("El ticket ya fue completado");

  const rate = getGeneralVisitorRate(options.tenantId);
  if (!rate) throw new Error("No existe tarifa para Público General");

  const quoteAt = options.quoteAt || new Date();
  const entryTime = new Date(String(ticket.entry_time).replace(" ", "T") + "Z");
  const durationMins = Math.max(0, Math.ceil((quoteAt.getTime() - entryTime.getTime()) / 60000));
  const graceMins = Number(rate.grace_period_mins || 0);
  const billableMins = Math.max(0, durationMins - graceMins);
  const ratePerMinute =
    Number(rate.rate_per_minute || 0) > 0
      ? Number(rate.rate_per_minute || 0)
      : Math.floor(Number(rate.rate_per_hour || 0) / 60);
  const subtotal = Math.max(0, billableMins * ratePerMinute);
  const discountAmount = 0;
  const total = Math.max(subtotal - discountAmount, 0);
  const quoteTime = quoteAt.toISOString().slice(0, 19).replace("T", " ");
  const expiresAt = new Date(quoteAt.getTime() + DEFAULT_QUOTE_TTL_MINS * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  return {
    ticket,
    rate,
    quote: {
      ticket_id: Number(ticket.id),
      rate_id: Number(rate.id),
      rate_label: String(rate.type),
      rate_per_hour: Number(rate.rate_per_hour || ratePerMinute * 60 || 0),
      rate_per_minute: ratePerMinute,
      billing_mode: "per_minute",
      grace_period_mins: graceMins,
      entry_time: ticket.entry_time,
      quote_time: quoteTime,
      duration_mins: durationMins,
      billable_mins: billableMins,
      subtotal,
      discount_amount: discountAmount,
      total,
      rounding_increment: 0,
      expires_at: expiresAt,
      inside_grace: total === 0,
    },
  };
}

export function createVisitorTicketQuote(
  ticketId: string | number,
  options: { tenantId?: number | null } = {},
) {
  const calculated = calculateVisitorTicketQuote(ticketId, { tenantId: options.tenantId });
  const quote = calculated.quote;

  const result = db.prepare(`
    INSERT INTO visitor_ticket_quotes (
      ticket_id, rate_id, rate_label, rate_per_hour, rate_per_minute, billing_mode, grace_period_mins, entry_time, quote_time,
      duration_mins, billable_mins, subtotal, discount_amount, total, rounding_increment, expires_at, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    quote.ticket_id,
    quote.rate_id,
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
    options.tenantId || null,
  );

  return { ...quote, id: Number(result.lastInsertRowid), amount: quote.total };
}

export function getUsableVisitorQuote(
  ticketId: string | number,
  quoteId?: number | null,
  options: { tenantId?: number | null } = {},
) {
  const tenantFilter = options.tenantId ? " AND tenant_id = ?" : "";
  const quote = quoteId
    ? (db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE id = ? AND ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
      `).get(...(options.tenantId ? [quoteId, ticketId, options.tenantId] : [quoteId, ticketId])) as
        | Record<string, any>
        | undefined)
    : (db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
        ORDER BY id DESC
        LIMIT 1
      `).get(...(options.tenantId ? [ticketId, options.tenantId] : [ticketId])) as Record<string, any> | undefined);

  if (quote) return quote;
  return createVisitorTicketQuote(ticketId, options);
}

