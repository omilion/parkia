import type { AuthRole } from "../../auth/sessions";
import { db } from "../../db";

export function branchFilterSql(column: string, branchId: number | null) {
  return branchId ? ` AND ${column} = ?` : "";
}

export function branchParam(branchId: number | null) {
  return branchId ? [branchId] : [];
}

export function scopedBranchFilterSql(tenantColumn: string, branchColumn: string, branchId: number | null) {
  return ` AND ${tenantColumn} = ?${branchFilterSql(branchColumn, branchId)}`;
}

export function scopedBranchParams(tenantId: number, branchId: number | null) {
  return [tenantId, ...branchParam(branchId)];
}

export const dashboardAccessRowsSelect = `
  SELECT a.*, c.name as client_name, s.name as space_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
  FROM access_logs a
  LEFT JOIN clients c ON a.client_id = c.id AND c.tenant_id = a.tenant_id
  LEFT JOIN spaces s ON a.space_id = s.id AND s.tenant_id = a.tenant_id
  LEFT JOIN visitor_passes v ON a.visitor_id = v.id AND v.tenant_id = a.tenant_id
`;

export function getOperationalTaskFromDb(id: string | number, tenantId: number) {
  return db.prepare(`
    SELECT t.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           creator.name as created_by_staff_name
    FROM operational_tasks t
    LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
    LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
    WHERE t.id = ? AND t.tenant_id = ?
  `).get(id, tenantId) as any | undefined;
}

export function getActiveTaskForAlertFromDb(alertId: string, tenantId: number) {
  return db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'dashboard_alert'
      AND source_id = ?
      AND tenant_id = ?
      AND status IN ('open', 'in_progress')
    ORDER BY id DESC
    LIMIT 1
  `).get(alertId, tenantId) as { id: number } | undefined;
}

export function findPreferredStaffByRoleInDb(preferredRole: AuthRole, tenantId: number) {
  return db.prepare(`
    SELECT s.id
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.role = ?
      AND s.status = 'active'
      AND tm.tenant_id = ?
      AND tm.status = 'active'
    ORDER BY s.id ASC
    LIMIT 1
  `).get(preferredRole, tenantId) as { id: number } | undefined;
}

export function getDashboardTodayAccessRowsFromDb(
  limit: number,
  startSql: string,
  endSql: string,
  branchId: number | null,
  tenantId: number,
) {
  return db.prepare(`
    ${dashboardAccessRowsSelect}
    WHERE a.timestamp >= ?
      AND a.timestamp < ?
      AND a.tenant_id = ?
      ${branchFilterSql("a.branch_id", branchId)}
    ORDER BY timestamp DESC, a.id DESC
    LIMIT ?
  `).all(startSql, endSql, tenantId, ...branchParam(branchId), limit);
}

export function getDashboardRecentAccessRowsFromDb(
  limit: number,
  startSql: string,
  branchId: number | null,
  tenantId: number,
) {
  return db.prepare(`
    ${dashboardAccessRowsSelect}
    WHERE a.timestamp < ?
      AND a.tenant_id = ?
      ${branchFilterSql("a.branch_id", branchId)}
    ORDER BY timestamp DESC, a.id DESC
    LIMIT ?
  `).all(startSql, tenantId, ...branchParam(branchId), limit);
}

export function queryDailyOperationsMetricsFromDb(
  startSql: string,
  endSql: string,
  branchId: number | null,
  tenantId: number,
) {
  const visitorRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total,
           COUNT(*) as count,
           SUM(CASE WHEN payment_method = 'cash' THEN amount ELSE 0 END) as cash,
           SUM(CASE WHEN payment_method = 'card' THEN amount ELSE 0 END) as card,
           SUM(CASE WHEN payment_method = 'transfer' THEN amount ELSE 0 END) as transfer
    FROM visitor_tickets
    WHERE paid_at >= ?
      AND paid_at < ?
      AND paid_at IS NOT NULL
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(startSql, endSql, ...scopedBranchParams(tenantId, branchId)) as any;

  const visitorStatus = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
      SUM(CASE WHEN status = 'completed' AND exit_time >= ? AND exit_time < ? THEN 1 ELSE 0 END) as completed_today,
      SUM(CASE WHEN status = 'active' AND entry_time < datetime('now', '-4 hours') THEN 1 ELSE 0 END) as stale_active
    FROM visitor_tickets
    WHERE tenant_id = ?
      ${branchFilterSql("branch_id", branchId)}
  `).get(startSql, endSql, tenantId, ...branchParam(branchId)) as any;

  const cashClosures = db.prepare(`
    SELECT COUNT(*) as count,
           COALESCE(SUM(expected_cash), 0) as expected_cash,
           COALESCE(SUM(counted_cash), 0) as counted_cash,
           COALESCE(SUM(difference_cash), 0) as difference_cash,
           SUM(CASE WHEN COALESCE(difference_cash, 0) != 0 THEN 1 ELSE 0 END) as with_difference
    FROM cash_sessions
    WHERE status = 'closed'
      AND closed_at >= ?
      AND closed_at < ?
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(startSql, endSql, ...scopedBranchParams(tenantId, branchId)) as any;

  const accessSummary = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'authorized' AND access_type = 'entry' THEN 1 ELSE 0 END) as entries,
           SUM(CASE WHEN status = 'authorized' AND access_type = 'exit' THEN 1 ELSE 0 END) as exits,
           SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(startSql, endSql, ...scopedBranchParams(tenantId, branchId)) as any;

  const unresolvedDeniedExits = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE status = 'denied'
      AND access_type = 'exit'
      AND resolved_by_access_log_id IS NULL
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(...scopedBranchParams(tenantId, branchId)) as any;

  const openCashSessions = db.prepare(`
    SELECT COUNT(*) as count
    FROM cash_sessions
    WHERE status = 'open'
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(...scopedBranchParams(tenantId, branchId)) as any;

  const occupancy = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
           SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
           SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
    FROM spaces
    WHERE type = 'parking'
      ${scopedBranchFilterSql("tenant_id", "branch_id", branchId)}
  `).get(...scopedBranchParams(tenantId, branchId)) as any;

  const byCashier = db.prepare(`
    SELECT COALESCE(staff.name, 'Sin cajera') as cashier_name,
           COUNT(vt.id) as tickets,
           COALESCE(SUM(vt.amount), 0) as total,
           COALESCE(SUM(CASE WHEN vt.payment_method = 'cash' THEN vt.amount ELSE 0 END), 0) as cash,
           COALESCE(SUM(CASE WHEN vt.payment_method = 'card' THEN vt.amount ELSE 0 END), 0) as card,
           COALESCE(SUM(CASE WHEN vt.payment_method = 'transfer' THEN vt.amount ELSE 0 END), 0) as transfer
    FROM visitor_tickets vt
    LEFT JOIN staff ON staff.id = vt.paid_by_staff_id
    WHERE vt.paid_at >= ?
      AND vt.paid_at < ?
      AND vt.paid_at IS NOT NULL
      ${scopedBranchFilterSql("vt.tenant_id", "vt.branch_id", branchId)}
    GROUP BY COALESCE(staff.name, 'Sin cajera')
    ORDER BY total DESC
  `).all(startSql, endSql, ...scopedBranchParams(tenantId, branchId)) as any[];

  return {
    visitorRevenue,
    visitorStatus,
    cashClosures,
    accessSummary,
    unresolvedDeniedExits,
    openCashSessions,
    occupancy,
    byCashier,
  };
}

export function queryDashboardAlertCountsFromDb(params: {
  userId: number | null;
  tenantId: number;
  accessWindowStartSql: string;
  accessWindowEndSql: string;
}) {
  const { userId, tenantId, accessWindowStartSql, accessWindowEndSql } = params;

  const overdueAssignedTasks = userId ? db.prepare(`
    SELECT COUNT(*) as count, MIN(id) as task_id
    FROM operational_tasks
    WHERE status IN ('open', 'in_progress')
      AND assigned_staff_id = ?
      AND tenant_id = ?
      AND due_date IS NOT NULL
      AND due_date < date('now')
  `).get(userId, tenantId) as { count: number; task_id: number | null } : { count: 0, task_id: null };

  const dueTodayAssignedTasks = userId ? db.prepare(`
    SELECT COUNT(*) as count, MIN(id) as task_id
    FROM operational_tasks
    WHERE status IN ('open', 'in_progress')
      AND assigned_staff_id = ?
      AND tenant_id = ?
      AND due_date = date('now')
  `).get(userId, tenantId) as { count: number; task_id: number | null } : { count: 0, task_id: null };

  const overduePayments = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE status = 'overdue'
      AND tenant_id = ?
  `).get(tenantId) as { count: number; amount: number };

  const overdueExpenses = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE payment_status = 'overdue'
      AND tenant_id = ?
  `).get(tenantId) as { count: number; amount: number };

  const pendingBankMovements = db.prepare("SELECT COUNT(*) as count FROM bank_movements WHERE status IN ('pending', 'partial') AND tenant_id = ?")
    .get(tenantId) as { count: number };

  const dueCollectionActions = db.prepare(`
    SELECT COUNT(*) as count
    FROM collection_actions
    WHERE status = 'open'
      AND tenant_id = ?
      AND next_action_at IS NOT NULL
      AND next_action_at <= date('now')
  `).get(tenantId) as { count: number };

  const documentIssues = db.prepare(`
    SELECT COUNT(*) as count
    FROM documents
    WHERE tenant_id = ?
      AND (
        status IN ('pending', 'rejected', 'expired')
        OR (expires_at IS NOT NULL AND date(expires_at) <= date('now', '+30 day'))
      )
  `).get(tenantId) as { count: number };

  const deniedAccess = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
      AND status = 'denied'
      AND tenant_id = ?
  `).get(accessWindowStartSql, accessWindowEndSql, tenantId) as { count: number };

  const guardShiftFollowUps = db.prepare(`
    SELECT COUNT(*) as count,
           SUM(CASE WHEN e.priority IN ('critical', 'high') THEN 1 ELSE 0 END) as high_count,
           MIN(t.id) as task_id
    FROM guard_shift_log_entries e
    LEFT JOIN operational_tasks t ON t.id = e.task_id AND t.tenant_id = e.tenant_id AND t.status IN ('open', 'in_progress')
    WHERE e.follow_up_required = 1
      AND e.tenant_id = ?
      AND e.resolved_at IS NULL
  `).get(tenantId) as { count: number; high_count: number | null; task_id: number | null };

  const expiringContracts = db.prepare(`
    SELECT COUNT(*) as count
    FROM contracts
    WHERE status = 'active'
      AND tenant_id = ?
      AND end_date IS NOT NULL
      AND end_date >= date('now')
      AND end_date <= date('now', '+30 days')
  `).get(tenantId) as { count: number };

  return {
    overdueAssignedTasks,
    dueTodayAssignedTasks,
    overduePayments,
    overdueExpenses,
    pendingBankMovements,
    dueCollectionActions,
    documentIssues,
    deniedAccess,
    guardShiftFollowUps,
    expiringContracts,
  };
}

export function searchForAdminOrFinanceInDb(tenantId: number, likeQuery: string) {
  const clients = db.prepare(`SELECT * FROM clients WHERE tenant_id = ? AND (name LIKE ? OR rut LIKE ?) LIMIT 5`).all(tenantId, likeQuery, likeQuery) as any[];
  const vehicles = db.prepare(`
    SELECT v.*, c.name as client_name
    FROM vehicles v
    JOIN clients c ON v.client_id = c.id AND c.tenant_id = v.tenant_id
    WHERE v.tenant_id = ? AND plate LIKE ? AND COALESCE(v.status, 'active') = 'active' LIMIT 5
  `).all(tenantId, likeQuery) as any[];
  return { clients, vehicles };
}

export function searchForGuardOrCashierInDb(tenantId: number, likeQuery: string) {
  return db.prepare(`
    SELECT v.id, v.plate, MIN(s.name) as space_name
    FROM vehicles v
    LEFT JOIN contracts c ON c.client_id = v.client_id AND c.status = 'active' AND c.tenant_id = v.tenant_id
    LEFT JOIN spaces s ON s.id = c.space_id AND s.tenant_id = v.tenant_id
    WHERE v.tenant_id = ? AND v.plate LIKE ? AND COALESCE(v.status, 'active') = 'active'
    GROUP BY v.id, v.plate
    LIMIT 5
  `).all(tenantId, likeQuery) as any[];
}

export function insertTaskFromAlertInDb(params: {
  title: string;
  description: string;
  category: string;
  priority: string;
  assigneeId: number | null;
  alertId: string;
  createdByStaffId: number | null;
  tenantId: number;
}) {
  const result = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, source_type, source_id, due_date, created_by_staff_id, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?)
  `).run(
    params.title,
    params.description,
    params.category,
    params.priority,
    params.assigneeId,
    "dashboard_alert",
    params.alertId,
    params.createdByStaffId,
    params.tenantId,
  );
  return result.lastInsertRowid;
}

export function queryMainDashboardFromDb(params: {
  tenantId: number;
  branchId: number | null;
  canSeeFinance: boolean;
  canSeeContracts: boolean;
  accessWindowStartSql: string;
  accessWindowEndSql: string;
}) {
  const { tenantId, branchId, canSeeFinance, canSeeContracts, accessWindowStartSql, accessWindowEndSql } = params;

  const selectedBranch = branchId
    ? db.prepare("SELECT id, name, code FROM branches WHERE id = ? AND tenant_id = ?").get(branchId, tenantId) as { id: number; name: string; code: string } | undefined
    : null;

  const totalSpaces = db.prepare(`SELECT COUNT(*) as count FROM spaces WHERE tenant_id = ? AND type = 'parking'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { count: number };
  const occupiedSpaces = db.prepare(`SELECT COUNT(*) as count FROM spaces WHERE tenant_id = ? AND type = 'parking' AND status = 'occupied'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { count: number };
  const parkingFree = db.prepare(`SELECT COUNT(*) as count FROM spaces WHERE tenant_id = ? AND type = 'parking' AND status = 'available'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { count: number };
  const availableSpaces = db.prepare(`
    SELECT id, name, type, location, level, branch_id
    FROM spaces
    WHERE status = 'available'
      AND type = 'parking'
      AND tenant_id = ?
      ${branchFilterSql("branch_id", branchId)}
    ORDER BY type ASC, name ASC
  `).all(tenantId, ...branchParam(branchId)) as Array<{ id: number; name: string; type: "parking"; location: string | null; level: string | null; branch_id: number | null }>;

  const totalCollected = canSeeFinance
    ? db.prepare(`SELECT SUM(amount) as total FROM payments WHERE tenant_id = ? AND status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { total: number }
    : { total: 0 };
  const visitorCollected = canSeeFinance
    ? db.prepare(`SELECT SUM(amount) as total FROM visitor_tickets WHERE tenant_id = ? AND amount > 0 AND payment_method IS NOT NULL AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { total: number }
    : { total: 0 };
  const previousMonthCollected = canSeeFinance
    ? db.prepare(`SELECT SUM(amount) as total FROM payments WHERE tenant_id = ? AND status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', date('now', 'start of month', '-1 month'))${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { total: number }
    : { total: 0 };
  const previousMonthVisitorCollected = canSeeFinance
    ? db.prepare(`SELECT SUM(amount) as total FROM visitor_tickets WHERE tenant_id = ? AND amount > 0 AND payment_method IS NOT NULL AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', date('now', 'start of month', '-1 month'))${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { total: number }
    : { total: 0 };
  const targetRevenue = canSeeFinance
    ? db.prepare(`SELECT SUM(monthly_fee) as total FROM contracts WHERE tenant_id = ? AND status = 'active'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParam(branchId)) as { total: number }
    : { total: 0 };

  const accessSummary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'authorized' THEN 1 ELSE 0 END) as authorized_total,
      SUM(CASE WHEN status = 'authorized' AND access_type = 'entry' THEN 1 ELSE 0 END) as entries,
      SUM(CASE WHEN status = 'authorized' AND access_type = 'exit' THEN 1 ELSE 0 END) as exits,
      SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
      AND tenant_id = ?
      ${branchFilterSql("branch_id", branchId)}
  `).get(accessWindowStartSql, accessWindowEndSql, tenantId, ...branchParam(branchId)) as {
    total: number;
    authorized_total: number | null;
    entries: number | null;
    exits: number | null;
    denied: number | null;
  };

  const lastAccessEvent = db.prepare(`SELECT timestamp FROM access_logs WHERE tenant_id = ?${branchFilterSql("branch_id", branchId)} ORDER BY timestamp DESC, id DESC LIMIT 1`).get(tenantId, ...branchParam(branchId)) as { timestamp: string } | undefined;

  const expiringContracts = canSeeContracts ? db.prepare(`
    SELECT c.*, cl.name as client_name, s.name as space_name
    FROM contracts c
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
    JOIN spaces s ON c.space_id = s.id AND s.tenant_id = c.tenant_id
    WHERE c.status = 'active'
      AND c.tenant_id = ?
      AND c.end_date >= date('now')
      AND c.end_date <= date('now', '+30 days')
      ${branchFilterSql("c.branch_id", branchId)}
    ORDER BY c.end_date ASC
  `).all(tenantId, ...branchParam(branchId)) : [];

  const recentPayments = canSeeFinance ? db.prepare(`
    SELECT p.*, cl.name as client_name
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
    WHERE p.status = 'paid'
      AND p.tenant_id = ?
      AND p.payment_date IS NOT NULL
      ${branchFilterSql("p.branch_id", branchId)}
    ORDER BY p.payment_date DESC LIMIT 5
  `).all(tenantId, ...branchParam(branchId)) : [];

  return {
    selectedBranch,
    totalSpaces,
    occupiedSpaces,
    parkingFree,
    availableSpaces,
    totalCollected,
    visitorCollected,
    previousMonthCollected,
    previousMonthVisitorCollected,
    targetRevenue,
    accessSummary,
    lastAccessEvent,
    expiringContracts,
    recentPayments,
  };
}
