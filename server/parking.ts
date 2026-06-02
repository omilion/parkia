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
  `).get(...params) as any | undefined;
}

export function calculateVisitorTicketQuote(ticketId: string | number, options: { quoteAt?: Date, tenantId?: number | null } = {}) {
  const ticket = options.tenantId
    ? db.prepare("SELECT * FROM visitor_tickets WHERE id = ? AND tenant_id = ?").get(ticketId, options.tenantId) as any | undefined
    : db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(ticketId) as any | undefined;
  if (!ticket) throw new Error("Ticket de visita no encontrado");
  if (ticket.status === "completed") throw new Error("El ticket ya fue completado");

  const rate = getGeneralVisitorRate(options.tenantId);
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

export function createVisitorTicketQuote(ticketId: string | number, options: { tenantId?: number | null } = {}) {
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

export function getUsableVisitorQuote(ticketId: string | number, quoteId?: number | null, options: { tenantId?: number | null } = {}) {
  const tenantFilter = options.tenantId ? " AND tenant_id = ?" : "";
  const quote = quoteId
    ? db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE id = ? AND ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
      `).get(...(options.tenantId ? [quoteId, ticketId, options.tenantId] : [quoteId, ticketId])) as any | undefined
    : db.prepare(`
        SELECT *
        FROM visitor_ticket_quotes
        WHERE ticket_id = ? AND status = 'quoted' AND expires_at > datetime('now')${tenantFilter}
        ORDER BY id DESC
        LIMIT 1
      `).get(...(options.tenantId ? [ticketId, options.tenantId] : [ticketId])) as any | undefined;

  if (quote) return quote;
  return createVisitorTicketQuote(ticketId, options);
}

export function getOpenCashSessionForUser(user: AuthUser | null | undefined, options: { branchId?: number | null, tenantId?: number | null } = {}) {
  if (!user) return null;
  const params: Array<string | number> = [user.id];
  let filters = "";
  if (options.branchId) {
    filters += " AND branch_id = ?";
    params.push(options.branchId);
  }
  if (options.tenantId) {
    filters += " AND tenant_id = ?";
    params.push(options.tenantId);
  }

  return db.prepare(`
    SELECT *
    FROM cash_sessions
    WHERE staff_id = ? AND status = 'open'
      ${filters}
    ORDER BY opened_at DESC, id DESC
    LIMIT 1
  `).get(...params) as any | undefined;
}

export function ensureOpenCashSession(user: AuthUser | null | undefined, shiftLogId?: number | null, options: { branchId?: number | null, tenantId?: number | null } = {}) {
  if (!user) throw new Error("Usuario autenticado requerido");
  const branchId = options.branchId || getDefaultBranchId(options.tenantId);
  if (shiftLogId) {
    const linkedParams: Array<string | number> = [user.id, shiftLogId];
    let linkedTenantFilter = "";
    if (options.tenantId) {
      linkedTenantFilter = "AND tenant_id = ?";
      linkedParams.push(options.tenantId);
    }
    const linked = db.prepare(`
      SELECT *
      FROM cash_sessions
      WHERE staff_id = ?
        AND shift_log_id = ?
        AND status = 'open'
        ${linkedTenantFilter}
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
    `).get(...linkedParams) as any | undefined;
    if (linked) return linked;

    const floatingParams: Array<string | number> = [user.id, branchId];
    let floatingTenantFilter = "";
    if (options.tenantId) {
      floatingTenantFilter = "AND tenant_id = ?";
      floatingParams.push(options.tenantId);
    }
    const floating = db.prepare(`
      SELECT *
      FROM cash_sessions
      WHERE staff_id = ?
        AND shift_log_id IS NULL
        AND status = 'open'
        AND branch_id = ?
        ${floatingTenantFilter}
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
    `).get(...floatingParams) as any | undefined;
    if (floating) {
      const movements = db.prepare("SELECT COUNT(*) as count FROM cash_movements WHERE cash_session_id = ?").get(floating.id) as { count: number };
      if (Number(movements?.count || 0) === 0) {
        db.prepare("UPDATE cash_sessions SET shift_log_id = ?, updated_at = datetime('now') WHERE id = ?").run(shiftLogId, floating.id);
        return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(floating.id) as any;
      }
    }

    const result = db.prepare(`
      INSERT INTO cash_sessions (staff_id, shift_log_id, branch_id, status, opening_cash, tenant_id)
      VALUES (?, ?, ?, 'open', 0, ?)
    `).run(user.id, shiftLogId, branchId, options.tenantId || null);

    return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid) as any;
  }

  const existing = getOpenCashSessionForUser(user, { branchId, tenantId: options.tenantId });
  if (existing) return existing;

  const result = db.prepare(`
    INSERT INTO cash_sessions (staff_id, shift_log_id, branch_id, status, opening_cash, tenant_id)
    VALUES (?, ?, ?, 'open', 0, ?)
  `).run(user.id, shiftLogId || null, branchId, options.tenantId || null);

  return db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid) as any;
}

export function recordVisitorCashMovement(input: {
  cashSessionId: number;
  ticketId: string | number;
  method: PaymentMethod;
  amount: number;
  staffId?: number | null;
  note?: string | null;
  tenantId?: number | null;
}) {
  db.prepare(`
    INSERT INTO cash_movements (cash_session_id, source_type, source_id, method, direction, amount, created_by_staff_id, note, tenant_id)
    VALUES (?, 'visitor_ticket', ?, ?, 'in', ?, ?, ?, ?)
  `).run(input.cashSessionId, String(input.ticketId), input.method, input.amount, input.staffId || null, input.note || null, input.tenantId || null);
}

export function getCashSessionSummary(cashSessionId: string | number, options: { tenantId?: number | null } = {}) {
  const session = options.tenantId
    ? db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND tenant_id = ?").get(cashSessionId, options.tenantId) as any | undefined
    : db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(cashSessionId) as any | undefined;
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

export function getCashSessionOperationalChecks(cashSessionId: string | number, options: { tenantId?: number | null } = {}) {
  const session = options.tenantId
    ? db.prepare("SELECT branch_id, tenant_id FROM cash_sessions WHERE id = ? AND tenant_id = ?").get(cashSessionId, options.tenantId) as { branch_id: number | null, tenant_id?: number | null } | undefined
    : db.prepare("SELECT branch_id, tenant_id FROM cash_sessions WHERE id = ?").get(cashSessionId) as { branch_id: number | null, tenant_id?: number | null } | undefined;
  if (!session) throw new Error("Caja no encontrada");
  const tenantId = options.tenantId || session.tenant_id || null;
  const tenantParams = tenantId ? [tenantId] : [];
  const tenantFilter = tenantId ? " AND tenant_id = ?" : "";
  const branchParams = session.branch_id ? [session.branch_id] : [];
  const branchFilter = session.branch_id ? " AND branch_id = ?" : "";

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
      ${tenantFilter}
      ${branchFilter}
  `).get(...tenantParams, ...branchParams) as { count: number };

  const unresolvedDeniedExits = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE status = 'denied'
      AND access_type = 'exit'
      AND resolved_by_access_log_id IS NULL
      ${tenantFilter}
      ${branchFilter}
  `).get(...tenantParams, ...branchParams) as { count: number };

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

export function getCashSessionOperationalSummary(cashSessionId: string | number, options: { tenantId?: number | null } = {}) {
  return {
    ...getCashSessionSummary(cashSessionId, options),
    ...getCashSessionOperationalChecks(cashSessionId, options),
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
  tenantId?: number | null;
}) {
  const summary = getCashSessionSummary(input.cashSessionId, { tenantId: input.tenantId || null });
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
    INSERT INTO cash_session_closures (cash_session_id, closed_by_staff_id, snapshot_json, tenant_id)
    VALUES (?, ?, ?, ?)
  `).run(input.cashSessionId, input.user?.id || null, JSON.stringify(snapshot), input.tenantId || null);

  recordAuditEvent(input.req, {
    action: "cash_session.closed",
    entityType: "cash_session",
    entityId: input.cashSessionId,
    metadata: snapshot,
  });

  return snapshot;
}
