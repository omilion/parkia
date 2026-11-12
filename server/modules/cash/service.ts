import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import type { AuthUser } from "../../auth/sessions";
import { getCurrentUser } from "../../auth/sessions";
import { getDefaultBranchId } from "../../branches";
import { db } from "../../db";
import { getTenantIdFromRequest } from "../../tenant";
import {
  attachShiftLogToCashSession,
  closeLinkedShiftLogIfOpen,
  countCashMovementsForSession,
  findCashSessionById,
  findOpenCashSessionRow,
  insertOpenCashSession,
  insertVisitorCashMovementRow,
  persistCashSessionClosure,
  queryCashMovementsSummaryByMethod,
  queryCashSessionOperationalCounts,
  queryClosedCashSessions,
  queryVisitorTicketsForCashSession,
  type PaymentMethod,
} from "./repo";

export type { PaymentMethod };

export function normalizePaymentMethod(method: string): PaymentMethod {
  const value = String(method || "").trim().toLowerCase();
  if (value === "efectivo") return "cash";
  if (value === "transferencia") return "transfer";
  if (value === "tarjeta") return "card";
  if (["cash", "transfer", "card", "automatic", "other"].includes(value)) return value as PaymentMethod;
  return "other";
}

export function getOpenCashSessionForUser(
  user: AuthUser | null | undefined,
  options: { branchId?: number | null; tenantId?: number | null } = {},
) {
  if (!user) return null;
  return findOpenCashSessionRow({
    staffId: user.id,
    branchId: options.branchId,
    tenantId: options.tenantId,
  });
}

export function ensureOpenCashSession(
  user: AuthUser | null | undefined,
  shiftLogId?: number | null,
  options: { branchId?: number | null; tenantId?: number | null } = {},
) {
  if (!user) throw new Error("Usuario autenticado requerido");
  const branchId = options.branchId || getDefaultBranchId(options.tenantId);

  if (shiftLogId) {
    const linked = findOpenCashSessionRow({
      staffId: user.id,
      shiftLogId,
      tenantId: options.tenantId,
    });
    if (linked) return linked;

    const floating = findOpenCashSessionRow({
      staffId: user.id,
      branchId,
      tenantId: options.tenantId,
      requireNullShiftLog: true,
    });
    if (floating && countCashMovementsForSession(floating.id) === 0) {
      return attachShiftLogToCashSession(floating.id, shiftLogId);
    }

    return insertOpenCashSession({
      staffId: user.id,
      shiftLogId,
      branchId,
      tenantId: options.tenantId || null,
    });
  }

  const existing = getOpenCashSessionForUser(user, { branchId, tenantId: options.tenantId });
  if (existing) return existing;

  return insertOpenCashSession({
    staffId: user.id,
    shiftLogId: shiftLogId || null,
    branchId,
    tenantId: options.tenantId || null,
  });
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
  insertVisitorCashMovementRow({
    cashSessionId: input.cashSessionId,
    ticketId: input.ticketId,
    method: input.method,
    amount: input.amount,
    staffId: input.staffId || null,
    note: input.note || null,
    tenantId: input.tenantId || null,
  });
}

export function getCashSessionSummary(
  cashSessionId: string | number,
  options: { tenantId?: number | null } = {},
) {
  const session = findCashSessionById(cashSessionId, options.tenantId);
  if (!session) throw new Error("Caja no encontrada");

  const byMethod = queryCashMovementsSummaryByMethod(cashSessionId);
  const totals = byMethod.reduce(
    (acc, row) => {
      acc[row.method] = Number(row.total || 0);
      return acc;
    },
    {} as Record<string, number>,
  );
  const expectedCash = Number(session.opening_cash || 0) + Number(totals.cash || 0);
  const tickets = queryVisitorTicketsForCashSession(cashSessionId);

  return {
    session,
    byMethod,
    totals,
    expectedCash,
    tickets,
  };
}

export function getCashSessionOperationalChecks(
  cashSessionId: string | number,
  options: { tenantId?: number | null } = {},
) {
  const session = findCashSessionById(cashSessionId, options.tenantId);
  if (!session) throw new Error("Caja no encontrada");
  const tenantId = options.tenantId || session.tenant_id || null;

  return queryCashSessionOperationalCounts({
    cashSessionId,
    tenantId,
    branchId: session.branch_id || null,
  });
}

export function getCashSessionOperationalSummary(
  cashSessionId: string | number,
  options: { tenantId?: number | null } = {},
) {
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

  persistCashSessionClosure({
    cashSessionId: input.cashSessionId,
    expectedCash: summary.expectedCash,
    countedCash: input.countedCash,
    countedTransfer: input.countedTransfer || 0,
    countedCard: input.countedCard || 0,
    differenceCash,
    notes: input.notes || null,
    closedByStaffId: input.user?.id || null,
    snapshotJson: JSON.stringify(snapshot),
    tenantId: input.tenantId || null,
  });

  recordAuditEvent(input.req, {
    action: "cash_session.closed",
    entityType: "cash_session",
    entityId: input.cashSessionId,
    metadata: snapshot,
  });

  return snapshot;
}

export function getVisitorCashClosures(
  query: { date?: string; branch_id?: number },
  currentUser: AuthUser | null,
  tenantId: number,
): Record<string, any>[] {
  const rows = queryClosedCashSessions({
    tenantId,
    staffIdFilter: currentUser?.role !== "admin" ? currentUser?.id || 0 : null,
    date: query.date,
    branchId: query.branch_id,
  });

  return rows.map((row) => ({
    ...row,
    tickets_count: Number(row.tickets_count || 0),
    opening_cash: Number(row.opening_cash || 0),
    expected_cash: Number(row.expected_cash || 0),
    counted_cash: Number(row.counted_cash || 0),
    counted_transfer: Number(row.counted_transfer || 0),
    counted_card: Number(row.counted_card || 0),
    difference_cash: Number(row.difference_cash || 0),
  }));
}

export function closeCurrentVisitorCashSessionForRequest(
  req: Request,
  body: {
    counted_cash: number;
    counted_transfer: number;
    counted_card: number;
    notes?: string | null;
    handover_notes?: string | null;
  },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const cashSession = getOpenCashSessionForUser(currentUser, { tenantId });
  if (!cashSession) return null;

  const result = db.transaction(() => {
    const summary = getCashSessionOperationalSummary(cashSession.id, { tenantId });
    if (summary.blockers.paidTicketsAwaitingExit > 0) {
      throw new Error(
        `No se puede cerrar la caja: hay ${summary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) pendientes de salida.`,
      );
    }

    const closure = closeCashSession({
      req,
      cashSessionId: Number(cashSession.id),
      countedCash: body.counted_cash,
      countedTransfer: body.counted_transfer,
      countedCard: body.counted_card,
      notes: body.notes || null,
      user: currentUser,
      tenantId,
    });

    let shiftLogClosed = false;
    if (cashSession.shift_log_id) {
      shiftLogClosed = closeLinkedShiftLogIfOpen({
        shiftLogId: Number(cashSession.shift_log_id),
        handoverNotes: body.handover_notes || "Cierre operativo registrado desde visitas",
        cashCountNote: body.notes || null,
      });
    }

    return {
      closure,
      summary,
      cash_session_id: Number(cashSession.id),
      shift_log_id: cashSession.shift_log_id || null,
      shift_log_closed: shiftLogClosed,
    };
  })();

  if (result.shift_log_closed) {
    recordAuditEvent(req, {
      action: "guard_shift_log.closed",
      entityType: "guard_shift_log",
      entityId: result.shift_log_id,
      metadata: {
        source: "visitor_cash_close",
        cash_session_id: result.cash_session_id,
        cash_closure: result.closure,
      },
    });
  }

  return { success: true as const, ...result };
}