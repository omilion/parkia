import { db } from "../../db";

export type PaymentMethod = "cash" | "transfer" | "card" | "automatic" | "other";

export async function findOpenCashSessionRow(params: {
  staffId: number;
  branchId?: number | null;
  tenantId?: number | null;
  shiftLogId?: number | null;
  requireNullShiftLog?: boolean;
}) {
  const queryParams: Array<string | number> = [params.staffId];
  let filters = "";
  if (params.shiftLogId !== undefined && params.shiftLogId !== null) {
    filters += " AND shift_log_id = ?";
    queryParams.push(params.shiftLogId);
  } else if (params.requireNullShiftLog) {
    filters += " AND shift_log_id IS NULL";
  }
  if (params.branchId) {
    filters += " AND branch_id = ?";
    queryParams.push(params.branchId);
  }
  if (params.tenantId) {
    filters += " AND tenant_id = ?";
    queryParams.push(params.tenantId);
  }

  return await db.prepare(`
    SELECT *
    FROM cash_sessions
    WHERE staff_id = ? AND status = 'open'
      ${filters}
    ORDER BY opened_at DESC, id DESC
    LIMIT 1
  `).get(...queryParams) as Record<string, any> | undefined;
}

export async function countCashMovementsForSession(cashSessionId: number | string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM cash_movements WHERE cash_session_id = ?")
    .get(cashSessionId) as { count: number };
  return Number(row?.count || 0);
}

export async function attachShiftLogToCashSession(cashSessionId: number | string, shiftLogId: number): Promise<Record<string, any>> {
  await db.prepare("UPDATE cash_sessions SET shift_log_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    shiftLogId,
    cashSessionId,
  );
  return await db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(cashSessionId) as Record<string, any>;
}

export async function insertOpenCashSession(params: {
  staffId: number;
  shiftLogId: number | null;
  branchId: number;
  tenantId: number | null;
}): Promise<Record<string, any>> {
  const result = await db.prepare(`
    INSERT INTO cash_sessions (staff_id, shift_log_id, branch_id, status, opening_cash, tenant_id)
    VALUES (?, ?, ?, 'open', 0, ?)
  `).run(params.staffId, params.shiftLogId, params.branchId, params.tenantId);
  return await db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(result.lastInsertRowid) as Record<string, any>;
}

export async function insertVisitorCashMovementRow(params: {
  cashSessionId: number;
  ticketId: string | number;
  method: PaymentMethod;
  amount: number;
  staffId: number | null;
  note: string | null;
  tenantId: number | null;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO cash_movements (cash_session_id, source_type, source_id, method, direction, amount, created_by_staff_id, note, tenant_id)
    VALUES (?, 'visitor_ticket', ?, ?, 'in', ?, ?, ?, ?)
  `).run(
    params.cashSessionId,
    String(params.ticketId),
    params.method,
    params.amount,
    params.staffId,
    params.note,
    params.tenantId,
  );
}

export async function findCashSessionById(cashSessionId: string | number, tenantId?: number | null) {
  return tenantId
    ? (await db.prepare("SELECT * FROM cash_sessions WHERE id = ? AND tenant_id = ?").get(cashSessionId, tenantId) as
        | Record<string, any>
        | undefined)
    : (await db.prepare("SELECT * FROM cash_sessions WHERE id = ?").get(cashSessionId) as Record<string, any> | undefined);
}

export async function queryCashMovementsSummaryByMethod(cashSessionId: string | number) {
  return (
    await db.prepare(`
      SELECT method, COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) as total, COUNT(*) as count
      FROM cash_movements
      WHERE cash_session_id = ?
      GROUP BY method
    `).all(cashSessionId) as Record<string, any>[]
  ).map((row) => ({
    method: String(row.method),
    total: Number(row.total || 0),
    count: Number(row.count || 0),
  }));
}

export async function queryVisitorTicketsForCashSession(cashSessionId: string | number) {
  return await db.prepare(`
    SELECT id, plate, amount, payment_method, paid_at, status
    FROM visitor_tickets
    WHERE cash_session_id = ?
    ORDER BY paid_at DESC, id DESC
  `).all(cashSessionId);
}

export async function queryCashSessionOperationalCounts(params: {
  cashSessionId: string | number;
  tenantId: number | null;
  branchId: number | null;
}) {
  const tenantParams = params.tenantId ? [params.tenantId] : [];
  const tenantFilter = params.tenantId ? " AND tenant_id = ?" : "";
  const branchParams = params.branchId ? [params.branchId] : [];
  const branchFilter = params.branchId ? " AND branch_id = ?" : "";

  const paidTicketsAwaitingExit = await db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE cash_session_id = ?
      AND status = 'paid'
  `).get(params.cashSessionId) as { count: number };

  const activeVisitorTickets = await db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE status = 'active'
      ${tenantFilter}
      ${branchFilter}
  `).get(...tenantParams, ...branchParams) as { count: number };

  const unresolvedDeniedExits = await db.prepare(`
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

export async function persistCashSessionClosure(params: {
  cashSessionId: number;
  expectedCash: number;
  countedCash: number;
  countedTransfer: number;
  countedCard: number;
  differenceCash: number;
  notes: string | null;
  closedByStaffId: number | null;
  snapshotJson: string;
  tenantId: number | null;
}): Promise<void> {
  await db.prepare(`
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
    params.expectedCash,
    params.countedCash,
    params.countedTransfer,
    params.countedCard,
    params.differenceCash,
    params.notes,
    params.cashSessionId,
  );

  await db.prepare(`
    INSERT INTO cash_session_closures (cash_session_id, closed_by_staff_id, snapshot_json, tenant_id)
    VALUES (?, ?, ?, ?)
  `).run(params.cashSessionId, params.closedByStaffId, params.snapshotJson, params.tenantId);
}

export async function queryClosedCashSessions(params: {
  tenantId: number;
  staffIdFilter?: number | null;
  date?: string;
  branchId?: number;
}) {
  const queryParams: Array<string | number> = [params.tenantId];
  let where = "WHERE cs.status = 'closed' AND cs.tenant_id = ?";
  if (params.staffIdFilter !== undefined && params.staffIdFilter !== null) {
    where += " AND cs.staff_id = ?";
    queryParams.push(params.staffIdFilter);
  }
  if (params.date) {
    where += " AND parkia_local_date(cs.closed_at) = ?";
    queryParams.push(params.date);
  }
  if (params.branchId) {
    where += " AND cs.branch_id = ?";
    queryParams.push(params.branchId);
  }

  return await db.prepare(`
    SELECT cs.id,
           cs.branch_id,
           b.name as branch_name,
           cs.staff_id,
           staff.name as staff_name,
           cs.shift_log_id,
           cs.opened_at,
           cs.closed_at,
           cs.opening_cash,
           cs.expected_cash,
           cs.counted_cash,
           cs.counted_transfer,
           cs.counted_card,
           cs.difference_cash,
           cs.notes,
           c.closed_by_staff_id,
           closer.name as closed_by_name,
           c.snapshot_json,
           c.created_at,
           (SELECT COUNT(*) FROM visitor_tickets vt WHERE vt.cash_session_id = cs.id AND vt.tenant_id = cs.tenant_id) as tickets_count
    FROM cash_sessions cs
    LEFT JOIN branches b ON b.id = cs.branch_id
    LEFT JOIN staff ON staff.id = cs.staff_id
    LEFT JOIN cash_session_closures c ON c.cash_session_id = cs.id
    LEFT JOIN staff closer ON closer.id = c.closed_by_staff_id
    ${where}
    ORDER BY cs.closed_at DESC, cs.id DESC
    LIMIT 100
  `).all(...queryParams) as Record<string, any>[];
}

export async function closeLinkedShiftLogIfOpen(params: {
  shiftLogId: number;
  handoverNotes: string;
  cashCountNote: string | null;
}): Promise<boolean> {
  const shiftLog = await db.prepare("SELECT status FROM guard_shift_logs WHERE id = ?").get(params.shiftLogId) as
    | { status: string }
    | undefined;
  if (shiftLog?.status !== "open") return false;

  await db.prepare(`
    UPDATE guard_shift_logs
    SET status = 'closed',
        handover_notes = ?,
        cash_count_note = ?,
        closed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(params.handoverNotes, params.cashCountNote, params.shiftLogId);
  return true;
}

