import type { Request } from "express";
import { recordAuditEvent } from "./audit";
import type { AuthUser } from "./auth/sessions";
import { getDefaultBranchId } from "./branches";
import { db } from "./db";

const DEFAULT_QUOTE_TTL_MINS = 10;
export type PaymentMethod = "cash" | "transfer" | "card" | "automatic" | "other";

export function normalizePaymentMethod(method: string): PaymentMethod {
  const value = String(method || "").trim().toLowerCase();
  if (value === "efectivo") return "cash";
  if (value === "transferencia") return "transfer";
  if (value === "tarjeta") return "card";
  if (["cash", "transfer", "card", "automatic", "other"].includes(value)) return value as PaymentMethod;
  return "other";
}

function getGeneralVisitorRate() {
  return db.prepare(`
    SELECT *
    FROM access_rates
    WHERE lower(replace(replace(type, 'ú', 'u'), 'Ú', 'U')) IN ('publico general', 'público general')
       OR lower(type) LIKE '%general%'
    ORDER BY
      CASE WHEN lower(type) LIKE '%general%' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 1
  `).get() as any | undefined;
}

export function calculateVisitorTicketQuote(ticketId: string | number, options: { quoteAt?: Date } = {}) {
  const ticket = db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(ticketId) as any | undefined;
  if (!ticket) throw new Error("Ticket de visita no encontrado");
  if (ticket.status === "completed") throw new Error("El ticket ya fue completado");

  const rate = getGeneralVisitorRate();
  if (!rate) throw new Error("No existe tarifa para Público General");

  const quoteAt = options.quoteAt || new Date();
  const entryTime = new Date(String(ticket.entry_time).replace(" ", "T") + "Z");
  const durationMins = Math.max(0, Math.ceil((quoteAt.getTime() - entryTime.getTime()) / 60000));
  const graceMins = Number(rate.grace_period_mins || 0);
  const billableMins = Math.max(0, durationMins - graceMins);
  const ratePerMinute = Number(rate.rate_per_minute || 0) > 0
    ? Number(rate.rate_per_minute || 0)
    : Math.floor(Number(rate.rate_per_hour || 0) / 60);
  const subtotal = Math.max(0, billableMins * ratePerMinute);
  const discountAmount = 0;
  const total = Math.max(subtotal - discountAmount, 0);
  const quoteTime = quoteAt.toISOString().slice(0, 19).replace("T", " ");
  const expiresAt = new Date(quoteAt.getTime() + DEFAULT_QUOTE_TTL_MINS * 60000).toISOString().slice(0, 19).replace("T", " ");

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

export function createVisitorTicketQuote(ticketId: string | number) {
  const calculated = calculateVisitorTicketQuote(ticketId);
  const quote = calculated.quote;

  const result = db.prepare(`
    INSERT INTO visitor_ticket_quotes (
      ticket_id, rate_id, rate_label, rate_per_hour, rate_per_minute, billing_mode, grace_period_mins, entry_time, quote_time,
      duration_mins, billable_mins, subtotal, discount_amount, total, rounding_increment, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );

  return { ...quote, id: Number(result.lastInsertRowid), amount: quote.total };
}

export function getUsableVisitorQuote(ticketId: string | number, quoteId?: number | null) {
  const quote = quoteId
    ? db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE id = ? AND ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')
      `).get(quoteId, ticketId) as any | undefined
    : db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')
        ORDER BY id DESC
        LIMIT 1
      `).get(ticketId) as any | undefined;

  if (quote) return quote;
  return createVisitorTicketQuote(ticketId);
}

export function getOpenCashSessionForUser(user: AuthUser | null | undefined) {
  if (!user) return null;
  return db.prepare(`
    SELECT *
    FROM cash_sessions
    WHERE staff_id = ? AND status = 'open'
    ORDER BY opened_at DESC, id DESC
    LIMIT 1
  `).get(user.id) as any | undefined;
}

export function ensureOpenCashSession(user: AuthUser | null | undefined, shiftLogId?: number | null) {
  if (!user) throw new Error("Usuario autenticado requerido");
  if (shiftLogId) {
    const linked = db.prepare(`
      SELECT *
      FROM cash_sessions
      WHERE staff_id = ?
        AND shift_log_id = ?
        AND status = 'open'
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
    `).get(user.id, shiftLogId) as any | undefined;
    if (linked) return linked;

    const floating = db.prepare(`
      SELECT *
      FROM cash_sessions
      WHERE staff_id = ?
        AND shift_log_id IS NULL
        AND status = 'open'
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
    `).get(user.id) as any | undefined;
    if (floating) {
      const movements = db.prepare("SELECT COUNT(*) as count FROM cash_movements WHERE cash_session_id = ?").get(floating.id) as { count: number };
      if (Number(movements?.count || 0) === 0) {
        db.prepare("UPDATE cash_sessions SET shift_log_id = ?, updated_at = datetime('now') WHERE id = ?").run(shiftLogId, floating.id);
        return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(floating.id) as any;
      }
    }

    const result = db.prepare(`
      INSERT INTO cash_sessions (staff_id, shift_log_id, branch_id, status, opening_cash)
      VALUES (?, ?, ?, 'open', 0)
    `).run(user.id, shiftLogId, getDefaultBranchId());

    return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid) as any;
  }

  const existing = getOpenCashSessionForUser(user);
  if (existing) return existing;

  const result = db.prepare(`
    INSERT INTO cash_sessions (staff_id, shift_log_id, branch_id, status, opening_cash)
    VALUES (?, ?, ?, 'open', 0)
  `).run(user.id, shiftLogId || null, getDefaultBranchId());

  return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid) as any;
}

export function recordVisitorCashMovement(input: {
  cashSessionId: number;
  ticketId: string | number;
  method: PaymentMethod;
  amount: number;
  staffId?: number | null;
  note?: string | null;
}) {
  db.prepare(`
    INSERT INTO cash_movements (cash_session_id, source_type, source_id, method, direction, amount, created_by_staff_id, note)
    VALUES (?, 'visitor_ticket', ?, ?, 'in', ?, ?, ?)
  `).run(input.cashSessionId, String(input.ticketId), input.method, input.amount, input.staffId || null, input.note || null);
}

export function getCashSessionSummary(cashSessionId: string | number) {
  const session = db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(cashSessionId) as any | undefined;
  if (!session) throw new Error("Caja no encontrada");

  const byMethod = (db.prepare(`
    SELECT method, COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) as total, COUNT(*) as count
    FROM cash_movements
    WHERE cash_session_id = ?
    GROUP BY method
  `).all(cashSessionId) as any[]).map(row => ({
    method: String(row.method),
    total: Number(row.total || 0),
    count: Number(row.count || 0),
  }));

  const totals = byMethod.reduce((acc, row) => {
    acc[row.method] = Number(row.total || 0);
    return acc;
  }, {} as Record<string, number>);
  const expectedCash = Number(session.opening_cash || 0) + Number(totals.cash || 0);

  const tickets = db.prepare(`
    SELECT id, plate, amount, payment_method, paid_at, status
    FROM visitor_tickets
    WHERE cash_session_id = ?
    ORDER BY paid_at DESC, id DESC
  `).all(cashSessionId);

  return {
    session,
    byMethod,
    totals,
    expectedCash,
    tickets,
  };
}

export function getCashSessionOperationalChecks(cashSessionId: string | number) {
  const paidTicketsAwaitingExit = db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE cash_session_id = ?
      AND status = 'paid'
  `).get(cashSessionId) as { count: number };

  const activeVisitorTickets = db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE status = 'active'
  `).get() as { count: number };

  const unresolvedDeniedExits = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE status = 'denied'
      AND access_type = 'exit'
      AND resolved_by_access_log_id IS NULL
  `).get() as { count: number };

  return {
    blockers: {
      paidTicketsAwaitingExit: Number(paidTicketsAwaitingExit?.count || 0),
    },
    warnings: {
      activeVisitorTickets: Number(activeVisitorTickets?.count || 0),
      unresolvedDeniedExits: Number(unresolvedDeniedExits?.count || 0),
    },
  };
}

export function getCashSessionOperationalSummary(cashSessionId: string | number) {
  return {
    ...getCashSessionSummary(cashSessionId),
    ...getCashSessionOperationalChecks(cashSessionId),
  };
}

export function closeCashSession(input: {
  req: Request;
  cashSessionId: number;
  countedCash: number;
  countedTransfer?: number | null;
  countedCard?: number | null;
  notes?: string | null;
  user: AuthUser | null;
}) {
  const summary = getCashSessionSummary(input.cashSessionId);
  if (summary.session.status === "closed") throw new Error("La caja ya está cerrada");

  const differenceCash = Number(input.countedCash || 0) - Number(summary.expectedCash || 0);
  const snapshot = {
    closed_at: new Date().toISOString(),
    opening_cash: Number(summary.session.opening_cash || 0),
    expected_cash: summary.expectedCash,
    counted_cash: Number(input.countedCash || 0),
    counted_transfer: Number(input.countedTransfer || 0),
    counted_card: Number(input.countedCard || 0),
    difference_cash: differenceCash,
    totals: summary.totals,
    tickets: summary.tickets,
  };

  db.prepare(`
    UPDATE cash_sessions
    SET status = 'closed',
        expected_cash = ?,
        counted_cash = ?,
        counted_transfer = ?,
        counted_card = ?,
        difference_cash = ?,
        notes = ?,
        closed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    summary.expectedCash,
    input.countedCash,
    input.countedTransfer || 0,
    input.countedCard || 0,
    differenceCash,
    input.notes || null,
    input.cashSessionId,
  );

  db.prepare(`
    INSERT INTO cash_session_closures (cash_session_id, closed_by_staff_id, snapshot_json)
    VALUES (?, ?, ?)
  `).run(input.cashSessionId, input.user?.id || null, JSON.stringify(snapshot));

  recordAuditEvent(input.req, {
    action: "cash_session.closed",
    entityType: "cash_session",
    entityId: input.cashSessionId,
    metadata: snapshot,
  });

  return snapshot;
}
