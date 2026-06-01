import type { Express } from "express";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole, type AuthRole, type AuthUser } from "../auth/sessions";
import { ensureUpcomingReceivables, refreshOverduePayments } from "../billing";
import { db } from "../db";
import { createSimpleReportPdfBuffer } from "../pdf";
import { sendXlsxTable, type XlsxColumn } from "../xlsx";

type DashboardAlert = {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  count: number;
  amount?: number;
  href: string;
  actionLabel: string;
  taskId: number | null;
};

type TaskCategory = "finance" | "access" | "documents" | "contracts" | "maintenance" | "general";
type TaskPriority = "low" | "medium" | "high" | "critical";
const ACCESS_TIMEZONE = "America/Santiago";

const alertTypesByRole: Record<AuthRole, string[]> = {
  admin: ["finance", "access", "documents", "contracts", "maintenance", "general"],
  finance: ["finance", "documents", "contracts", "general"],
  guard: ["access", "maintenance", "general"],
  cashier: ["general"],
};

function canSeeFinanceRole(role: AuthRole | undefined) {
  return role === "admin" || role === "finance";
}

function canSeeContractsRole(role: AuthRole | undefined) {
  return role === "admin" || role === "finance";
}

function canSeeAlert(user: AuthUser | null, alert: Pick<DashboardAlert, "type">) {
  if (!user) return false;
  return alertTypesByRole[user.role].includes(alert.type);
}

function getOperationalTask(id: string | number) {
  return db.prepare(`
    SELECT t.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           creator.name as created_by_staff_name
    FROM operational_tasks t
    LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
    LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
    WHERE t.id = ?
  `).get(id) as any | undefined;
}

function getActiveTaskForAlert(alertId: string) {
  return db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'dashboard_alert'
      AND source_id = ?
      AND status IN ('open', 'in_progress')
    ORDER BY id DESC
    LIMIT 1
  `).get(alertId) as { id: number } | undefined;
}

function attachTaskState(alert: Omit<DashboardAlert, "taskId">, fallbackTaskId?: number | null): DashboardAlert {
  const task = getActiveTaskForAlert(alert.id);
  return { ...alert, taskId: task?.id || fallbackTaskId || null };
}

function priorityFromSeverity(severity: DashboardAlert["severity"]): TaskPriority {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "high";
  return "medium";
}

function categoryFromAlertType(type: string): TaskCategory {
  if (["finance", "access", "documents", "contracts", "maintenance"].includes(type)) {
    return type as TaskCategory;
  }
  return "general";
}

function canCreateTaskForAlert(user: AuthUser | null, alert: DashboardAlert) {
  if (!user || !canSeeAlert(user, alert)) return false;
  return alertTypesByRole[user.role].includes(categoryFromAlertType(alert.type));
}

function getDefaultAssigneeForCategory(category: TaskCategory, currentUser: AuthUser | null) {
  if (category === "general") return currentUser?.id || null;

    const preferredRoleByCategory: Partial<Record<TaskCategory, AuthRole>> = {
      finance: "finance",
      documents: "finance",
      contracts: "finance",
      access: "guard",
      maintenance: "guard",
  };
  const preferredRole = preferredRoleByCategory[category];

  if (preferredRole && currentUser?.role === preferredRole) return currentUser.id;
  if (!preferredRole) return currentUser?.id || null;

  const staff = db.prepare(`
    SELECT id
    FROM staff
    WHERE role = ?
      AND status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `).get(preferredRole) as { id: number } | undefined;

  return staff?.id || currentUser?.id || null;
}

function calculateRevenueTrend(currentTotal: number, previousTotal: number) {
  if (previousTotal <= 0) return currentTotal > 0 ? 100 : 0;
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
}

const dashboardAccessRowsSelect = `
  SELECT a.*, c.name as client_name, s.name as space_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
  FROM access_logs a
  LEFT JOIN clients c ON a.client_id = c.id
  LEFT JOIN spaces s ON a.space_id = s.id
  LEFT JOIN visitor_passes v ON a.visitor_id = v.id
`;

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function getOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedMidnightToUtc(dateText: string, timeZone: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstOffset = getOffsetMs(new Date(utcGuess), timeZone);
  const firstUtc = utcGuess - firstOffset;
  const secondOffset = getOffsetMs(new Date(firstUtc), timeZone);
  return new Date(utcGuess - secondOffset);
}

function addDays(dateText: string, days: number) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));
  return date.toISOString().slice(0, 10);
}

function getBusinessDayWindow(date = new Date(), timeZone = ACCESS_TIMEZONE) {
  const parts = getZonedParts(date, timeZone);
  const businessDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const start = zonedMidnightToUtc(businessDate, timeZone);
  const end = zonedMidnightToUtc(addDays(businessDate, 1), timeZone);
  const toSqliteUtc = (value: Date) => value.toISOString().slice(0, 19).replace("T", " ");
  return {
    businessDate,
    timeZone,
    start,
    end,
    startSql: toSqliteUtc(start),
    endSql: toSqliteUtc(end),
  };
}

function parseBusinessDateQuery(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getBusinessDayWindowForDate(dateText?: string, timeZone = ACCESS_TIMEZONE) {
  if (!dateText) return getBusinessDayWindow(new Date(), timeZone);
  const start = zonedMidnightToUtc(dateText, timeZone);
  const end = zonedMidnightToUtc(addDays(dateText, 1), timeZone);
  const toSqliteUtc = (value: Date) => value.toISOString().slice(0, 19).replace("T", " ");
  return {
    businessDate: dateText,
    timeZone,
    start,
    end,
    startSql: toSqliteUtc(start),
    endSql: toSqliteUtc(end),
  };
}

function toCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map(row => row.map(escape).join(",")).join("\n");
}

function buildDailyOperationsReport(window: ReturnType<typeof getBusinessDayWindow>) {
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
  `).get(window.startSql, window.endSql) as any;

  const visitorStatus = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
      SUM(CASE WHEN status = 'completed' AND exit_time >= ? AND exit_time < ? THEN 1 ELSE 0 END) as completed_today,
      SUM(CASE WHEN status = 'active' AND entry_time < datetime('now', '-4 hours') THEN 1 ELSE 0 END) as stale_active
    FROM visitor_tickets
  `).get(window.startSql, window.endSql) as any;

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
  `).get(window.startSql, window.endSql) as any;

  const accessSummary = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'authorized' AND access_type = 'entry' THEN 1 ELSE 0 END) as entries,
           SUM(CASE WHEN status = 'authorized' AND access_type = 'exit' THEN 1 ELSE 0 END) as exits,
           SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as denied
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
  `).get(window.startSql, window.endSql) as any;

  const unresolvedDeniedExits = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE status = 'denied'
      AND access_type = 'exit'
      AND resolved_by_access_log_id IS NULL
  `).get() as any;

  const openCashSessions = db.prepare(`
    SELECT COUNT(*) as count
    FROM cash_sessions
    WHERE status = 'open'
  `).get() as any;

  const occupancy = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
           SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
           SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) as maintenance
    FROM spaces
    WHERE type = 'parking'
  `).get() as any;

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
    GROUP BY COALESCE(staff.name, 'Sin cajera')
    ORDER BY total DESC
  `).all(window.startSql, window.endSql) as any[];

  const hourly = buildHourlyAccessSeries(getDashboardTodayAccessRows(5000, window), window.timeZone);

  const alerts = [
    Number(cashClosures.with_difference || 0) > 0 ? {
      id: "cash-differences",
      severity: "critical",
      title: "Cajas con diferencia",
      detail: `${cashClosures.with_difference} cierre(s) con diferencia por $${Number(cashClosures.difference_cash || 0).toLocaleString()}`,
    } : null,
    Number(visitorStatus.paid || 0) > 0 ? {
      id: "paid-awaiting-exit",
      severity: "warning",
      title: "Tickets pagados sin salida",
      detail: `${visitorStatus.paid} ticket(s) requieren autorizacion de salida`,
    } : null,
    Number(visitorStatus.stale_active || 0) > 0 ? {
      id: "stale-active-visitors",
      severity: "warning",
      title: "Tickets activos antiguos",
      detail: `${visitorStatus.stale_active} ticket(s) llevan mas de 4 horas activos`,
    } : null,
    Number(unresolvedDeniedExits.count || 0) > 0 ? {
      id: "unresolved-denied-exits",
      severity: "critical",
      title: "Salidas denegadas sin resolver",
      detail: `${unresolvedDeniedExits.count} salida(s) denegada(s) siguen abiertas`,
    } : null,
  ].filter(Boolean);

  return {
    date: window.businessDate,
    timezone: window.timeZone,
    window_start_utc: window.start.toISOString(),
    window_end_utc: window.end.toISOString(),
    visitorRevenue: {
      total: Number(visitorRevenue.total || 0),
      count: Number(visitorRevenue.count || 0),
      cash: Number(visitorRevenue.cash || 0),
      card: Number(visitorRevenue.card || 0),
      transfer: Number(visitorRevenue.transfer || 0),
    },
    cashClosures: {
      count: Number(cashClosures.count || 0),
      expectedCash: Number(cashClosures.expected_cash || 0),
      countedCash: Number(cashClosures.counted_cash || 0),
      differenceCash: Number(cashClosures.difference_cash || 0),
      withDifference: Number(cashClosures.with_difference || 0),
      openSessions: Number(openCashSessions.count || 0),
    },
    tickets: {
      active: Number(visitorStatus.active || 0),
      paidAwaitingExit: Number(visitorStatus.paid || 0),
      completedToday: Number(visitorStatus.completed_today || 0),
      staleActive: Number(visitorStatus.stale_active || 0),
    },
    access: {
      total: Number(accessSummary.total || 0),
      entries: Number(accessSummary.entries || 0),
      exits: Number(accessSummary.exits || 0),
      denied: Number(accessSummary.denied || 0),
      unresolvedDeniedExits: Number(unresolvedDeniedExits.count || 0),
      hourly,
    },
    occupancy: {
      total: Number(occupancy.total || 0),
      occupied: Number(occupancy.occupied || 0),
      available: Number(occupancy.available || 0),
      maintenance: Number(occupancy.maintenance || 0),
    },
    byCashier: byCashier.map(row => ({
      cashierName: row.cashier_name,
      tickets: Number(row.tickets || 0),
      total: Number(row.total || 0),
      cash: Number(row.cash || 0),
      card: Number(row.card || 0),
      transfer: Number(row.transfer || 0),
    })),
    alerts,
  };
}

function getDashboardTodayAccessRows(limit: number, window: ReturnType<typeof getBusinessDayWindow>) {
  return db.prepare(`
    ${dashboardAccessRowsSelect}
    WHERE a.timestamp >= ?
      AND a.timestamp < ?
    ORDER BY timestamp DESC, a.id DESC
    LIMIT ?
  `).all(window.startSql, window.endSql, limit);
}

function getDashboardRecentAccessRows(limit: number, window: ReturnType<typeof getBusinessDayWindow>) {
  return db.prepare(`
    ${dashboardAccessRowsSelect}
    WHERE a.timestamp < ?
    ORDER BY timestamp DESC, a.id DESC
    LIMIT ?
  `).all(window.startSql, limit);
}

function parseSqliteUtcTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAccessLocalHour(row: any, timeZone: string) {
  const date = parseSqliteUtcTimestamp(row.timestamp);
  if (!date) return null;
  return getZonedParts(date, timeZone).hour;
}

function buildHourlyAccessSeries(rows: any[], timeZone: string) {
  const buckets = new Map<number, { hour: number, count: number, entries: number, exits: number, denied: number }>();

  rows.forEach(row => {
    const hour = getAccessLocalHour(row, timeZone);
    if (hour === null) return;
    const bucket = buckets.get(hour) || { hour, count: 0, entries: 0, exits: 0, denied: 0 };
    bucket.count += 1;
    if (row.status === "authorized" && row.access_type === "entry") bucket.entries += 1;
    if (row.status === "authorized" && row.access_type === "exit") bucket.exits += 1;
    if (row.status === "denied") bucket.denied += 1;
    buckets.set(hour, bucket);
  });

  return [...buckets.values()].sort((a, b) => a.hour - b.hour);
}

function buildDashboardAlerts(user: AuthUser | null) {
  ensureUpcomingReceivables();
  refreshOverduePayments();
  const alerts: DashboardAlert[] = [];
  const severityRank = { critical: 0, warning: 1, info: 2 };

  if (user) {
    const overdueAssignedTasks = db.prepare(`
      SELECT COUNT(*) as count, MIN(id) as task_id
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND assigned_staff_id = ?
        AND due_date IS NOT NULL
        AND due_date < date('now')
    `).get(user.id) as { count: number, task_id: number | null };
    if (overdueAssignedTasks.count > 0) {
      const taskId = overdueAssignedTasks.task_id;
      alerts.push({
        id: `my-overdue-tasks-${user.id}`,
        type: "general",
        severity: "critical",
        title: "Mis tareas atrasadas",
        detail: `${overdueAssignedTasks.count} tarea(s) asignada(s) vencidas requieren cierre o nueva fecha`,
        count: overdueAssignedTasks.count,
        href: `/tasks?assigned=me&due=overdue&status=active${taskId ? `&taskId=${taskId}` : ""}`,
        actionLabel: "Ver tareas",
        taskId,
      });
    }

    const dueTodayAssignedTasks = db.prepare(`
      SELECT COUNT(*) as count, MIN(id) as task_id
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND assigned_staff_id = ?
        AND due_date = date('now')
    `).get(user.id) as { count: number, task_id: number | null };
    if (dueTodayAssignedTasks.count > 0) {
      const taskId = dueTodayAssignedTasks.task_id;
      alerts.push({
        id: `my-due-today-tasks-${user.id}`,
        type: "general",
        severity: "warning",
        title: "Tareas para hoy",
        detail: `${dueTodayAssignedTasks.count} tarea(s) asignada(s) vencen hoy`,
        count: dueTodayAssignedTasks.count,
        href: `/tasks?assigned=me&due=today&status=active${taskId ? `&taskId=${taskId}` : ""}`,
        actionLabel: "Ver tareas",
        taskId,
      });
    }
  }

  const overduePayments = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE status = 'overdue'
  `).get() as { count: number, amount: number };
  if (overduePayments.count > 0) {
    alerts.push(attachTaskState({
      id: "overdue-payments",
      type: "finance",
      severity: "critical",
      title: "Clientes en mora",
      detail: `${overduePayments.count} cuenta(s) vencida(s) por $${Number(overduePayments.amount || 0).toLocaleString()}`,
      count: overduePayments.count,
      amount: overduePayments.amount || 0,
      href: "/finance?tab=collections&collectionStatus=open&collectionDue=all",
      actionLabel: "Gestionar cobranza",
    }));
  }

  const overdueExpenses = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE payment_status = 'overdue'
  `).get() as { count: number, amount: number };
  if (overdueExpenses.count > 0) {
    alerts.push(attachTaskState({
      id: "overdue-expenses",
      type: "finance",
      severity: "critical",
      title: "Gastos vencidos",
      detail: `${overdueExpenses.count} gasto(s) vencido(s) por $${Number(overdueExpenses.amount || 0).toLocaleString()}`,
      count: overdueExpenses.count,
      amount: overdueExpenses.amount || 0,
      href: "/finance?tab=expenses&expenseStatus=overdue&expenseDue=all",
      actionLabel: "Revisar pagos",
    }));
  }

  const pendingBankMovements = db.prepare("SELECT COUNT(*) as count FROM bank_movements WHERE status IN ('pending', 'partial')").get() as { count: number };
  if (pendingBankMovements.count > 0) {
    alerts.push(attachTaskState({
      id: "bank-reconciliation",
      type: "finance",
      severity: "warning",
      title: "Cartola por conciliar",
      detail: `${pendingBankMovements.count} movimiento(s) bancario(s) requieren revisión`,
      count: pendingBankMovements.count,
      href: "/finance?tab=cgvc&movementStatus=attention",
      actionLabel: "Conciliar",
    }));
  }

  const dueCollectionActions = db.prepare(`
    SELECT COUNT(*) as count
    FROM collection_actions
    WHERE status = 'open'
      AND next_action_at IS NOT NULL
      AND next_action_at <= date('now')
  `).get() as { count: number };
  if (dueCollectionActions.count > 0) {
    alerts.push(attachTaskState({
      id: "collection-actions",
      type: "finance",
      severity: "warning",
      title: "Seguimientos de cobranza",
      detail: `${dueCollectionActions.count} seguimiento(s) vencen hoy o están atrasados`,
      count: dueCollectionActions.count,
      href: "/finance?tab=collections&collectionStatus=open&collectionDue=actionable",
      actionLabel: "Ver seguimiento",
    }));
  }

  const documentIssues = db.prepare(`
    SELECT COUNT(*) as count
    FROM documents
    WHERE status IN ('pending', 'rejected', 'expired')
       OR (expires_at IS NOT NULL AND date(expires_at) <= date('now', '+30 day'))
  `).get() as { count: number };
  if (documentIssues.count > 0) {
    alerts.push(attachTaskState({
      id: "document-review",
      type: "documents",
      severity: "warning",
      title: "Documentos por revisar",
      detail: `${documentIssues.count} documento(s) pendientes, rechazados o próximos a vencer`,
      count: documentIssues.count,
      href: "/documents?filter=critical",
      actionLabel: "Revisar documentos",
    }));
  }

  const accessWindow = getBusinessDayWindow();
  const deniedAccess = db.prepare(`
    SELECT COUNT(*) as count
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
      AND status = 'denied'
  `).get(accessWindow.startSql, accessWindow.endSql) as { count: number };
  if (deniedAccess.count > 0) {
    alerts.push(attachTaskState({
      id: "denied-access",
      type: "access",
      severity: "critical",
      title: "Accesos denegados hoy",
      detail: `${deniedAccess.count} intento(s) de acceso denegado registrados`,
      count: deniedAccess.count,
      href: `/access?tab=audit&type=denied&start=${accessWindow.businessDate}`,
      actionLabel: "Ver accesos",
    }));
  }

  const guardShiftFollowUps = db.prepare(`
    SELECT COUNT(*) as count,
           SUM(CASE WHEN e.priority IN ('critical', 'high') THEN 1 ELSE 0 END) as high_count,
           MIN(t.id) as task_id
    FROM guard_shift_log_entries e
    LEFT JOIN operational_tasks t ON t.id = e.task_id AND t.status IN ('open', 'in_progress')
    WHERE e.follow_up_required = 1
      AND e.resolved_at IS NULL
  `).get() as { count: number, high_count: number | null, task_id: number | null };
  if (guardShiftFollowUps.count > 0) {
    alerts.push(attachTaskState({
      id: "guard-shift-follow-ups",
      type: "access",
      severity: Number(guardShiftFollowUps.high_count || 0) > 0 ? "critical" : "warning",
      title: "Seguimientos de Guardia",
      detail: `${guardShiftFollowUps.count} pendiente(s) de bitácora requieren traspaso o cierre operacional`,
      count: guardShiftFollowUps.count,
      href: "/access?tab=shift-log",
      actionLabel: "Ver bitácora",
    }, guardShiftFollowUps.task_id));
  }

  const expiringContracts = db.prepare(`
    SELECT COUNT(*) as count
    FROM contracts
    WHERE status = 'active'
      AND end_date IS NOT NULL
      AND end_date >= date('now')
      AND end_date <= date('now', '+30 days')
  `).get() as { count: number };
  if (expiringContracts.count > 0) {
    alerts.push(attachTaskState({
      id: "expiring-contracts",
      type: "contracts",
      severity: "info",
      title: "Contratos por vencer",
      detail: `${expiringContracts.count} contrato(s) vencen dentro de 30 días`,
      count: expiringContracts.count,
      href: "/contracts?filter=expiring",
      actionLabel: "Revisar contratos",
    }));
  }

  return alerts
    .filter(alert => canSeeAlert(user, alert))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count)
    .slice(0, 8);
}

export function registerGeneralRoutes(app: Express) {
  app.get("/api/search", (req, res) => {
    const currentUser = getCurrentUser(req);
    const query = req.query.q as string;
    if (!query || query.length < 2) return res.json([]);

    const likeQuery = `%${query}%`;
    const results: Array<{ id: number, type: string, title: string, subtitle: string, link: string }> = [];

    if (currentUser?.role === "admin" || currentUser?.role === "finance") {
      const clients = db.prepare(`SELECT * FROM clients WHERE name LIKE ? OR rut LIKE ? LIMIT 5`).all(likeQuery, likeQuery) as any[];
      clients.forEach(c => results.push({ id: c.id, type: 'client', title: c.name, subtitle: `RUT: ${c.rut} - Cliente`, link: `/clients?id=${c.id}` }));

      const vehicles = db.prepare(`
        SELECT v.*, c.name as client_name
        FROM vehicles v
        JOIN clients c ON v.client_id = c.id
        WHERE plate LIKE ? AND COALESCE(v.status, 'active') = 'active' LIMIT 5
      `).all(likeQuery) as any[];
      vehicles.forEach(v => results.push({ id: v.client_id, type: 'client', title: v.client_name, subtitle: `Patente: ${v.plate}`, link: `/clients?id=${v.client_id}` }));
    } else if (currentUser?.role === "guard" || currentUser?.role === "cashier") {
      const vehicles = db.prepare(`
        SELECT v.id, v.plate, MIN(s.name) as space_name
        FROM vehicles v
        LEFT JOIN contracts c ON c.client_id = v.client_id AND c.status = 'active'
        LEFT JOIN spaces s ON s.id = c.space_id
        WHERE v.plate LIKE ? AND COALESCE(v.status, 'active') = 'active'
        GROUP BY v.id, v.plate
        LIMIT 5
      `).all(likeQuery) as any[];
      vehicles.forEach(v => results.push({
        id: v.id,
        type: 'space',
        title: `Patente ${v.plate}`,
        subtitle: v.space_name ? `Vehiculo registrado · ${v.space_name}` : "Vehiculo registrado",
        link: currentUser?.role === "cashier" ? "/spaces" : "/access",
      }));
    }

    res.json(results);
  });

  app.get("/api/dashboard/alerts", (req, res) => {
    res.json({ alerts: buildDashboardAlerts(getCurrentUser(req)) });
  });

  app.post("/api/dashboard/alerts/:id/task", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const currentUser = getCurrentUser(req);
    const alert = buildDashboardAlerts(currentUser).find((item) => item.id === req.params.id);
    if (!alert) return res.status(404).json({ error: "Alerta no encontrada o ya resuelta" });
    if (alert.taskId) {
      return res.json({ success: true, existing: true, task: getOperationalTask(alert.taskId) });
    }

    const existing = getActiveTaskForAlert(alert.id);
    if (existing) {
      return res.json({ success: true, existing: true, task: getOperationalTask(existing.id) });
    }

    if (!canCreateTaskForAlert(currentUser, alert)) {
      return res.status(403).json({ error: "No tienes permisos para crear tareas desde esta alerta" });
    }

    const category = categoryFromAlertType(alert.type);
    const assigneeId = getDefaultAssigneeForCategory(category, currentUser);
    const result = db.prepare(`
      INSERT INTO operational_tasks (
        title, description, category, priority, assigned_staff_id, source_type, source_id, due_date, created_by_staff_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), ?)
    `).run(
      alert.title,
      `${alert.detail}\n\nOrigen: alerta prioritaria del dashboard. Accion sugerida: ${alert.actionLabel}.`,
      category,
      priorityFromSeverity(alert.severity),
      assigneeId,
      "dashboard_alert",
      alert.id,
      currentUser?.id || null,
    );

    recordAuditEvent(req, {
      action: "dashboard_alert.task_created",
      entityType: "operational_task",
      entityId: result.lastInsertRowid,
      metadata: {
        alertId: alert.id,
        alertTitle: alert.title,
        alertSeverity: alert.severity,
        assignedStaffId: assigneeId,
      },
    });

    res.json({ success: true, existing: false, task: getOperationalTask(result.lastInsertRowid) });
  });

  app.get("/api/dashboard/operations-daily", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const date = parseBusinessDateQuery(req.query.date);
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined));
    const currentUser = getCurrentUser(req);
    if (!canSeeFinanceRole(currentUser?.role)) {
      report.visitorRevenue = { total: 0, count: report.visitorRevenue.count, cash: 0, card: 0, transfer: 0 };
      report.cashClosures.expectedCash = 0;
      report.cashClosures.countedCash = 0;
      report.cashClosures.differenceCash = 0;
      report.byCashier = [];
    }
    res.json(report);
  });

  app.get("/api/dashboard/export/operations-daily.csv", requireAnyRole(["admin", "finance"]), (req, res) => {
    const date = parseBusinessDateQuery(req.query.date);
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined));
    const rows = [
      ["Seccion", "Metrica", "Valor"],
      ["Dia", "Fecha", report.date],
      ["Visitas", "Ingresos", report.visitorRevenue.total],
      ["Visitas", "Tickets cobrados", report.visitorRevenue.count],
      ["Visitas", "Efectivo", report.visitorRevenue.cash],
      ["Visitas", "Tarjeta", report.visitorRevenue.card],
      ["Visitas", "Transferencia", report.visitorRevenue.transfer],
      ["Caja", "Cierres", report.cashClosures.count],
      ["Caja", "Efectivo esperado", report.cashClosures.expectedCash],
      ["Caja", "Efectivo contado", report.cashClosures.countedCash],
      ["Caja", "Diferencia", report.cashClosures.differenceCash],
      ["Caja", "Cajas abiertas", report.cashClosures.openSessions],
      ["Tickets", "Activos", report.tickets.active],
      ["Tickets", "Pagados sin salida", report.tickets.paidAwaitingExit],
      ["Tickets", "Completados hoy", report.tickets.completedToday],
      ["Accesos", "Total", report.access.total],
      ["Accesos", "Entradas", report.access.entries],
      ["Accesos", "Salidas", report.access.exits],
      ["Accesos", "Denegados", report.access.denied],
      ["Ocupacion", "Total", report.occupancy.total],
      ["Ocupacion", "Ocupados", report.occupancy.occupied],
      ["Ocupacion", "Disponibles", report.occupancy.available],
      [],
      ["Cajera", "Tickets", "Total", "Efectivo", "Tarjeta", "Transferencia"],
      ...report.byCashier.map(row => [row.cashierName, row.tickets, row.total, row.cash, row.card, row.transfer]),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="operacion-diaria-${report.date}.csv"`);
    res.send(toCsv(rows));
  });

  app.get("/api/dashboard/export/operations-daily.xlsx", requireAnyRole(["admin", "finance"]), async (req, res, next) => {
    try {
      const date = parseBusinessDateQuery(req.query.date);
      const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined));
      const rows = [
        { section: "Dia", metric: "Fecha", value: report.date },
        { section: "Visitas", metric: "Ingresos", value: report.visitorRevenue.total },
        { section: "Visitas", metric: "Tickets cobrados", value: report.visitorRevenue.count },
        { section: "Caja", metric: "Efectivo esperado", value: report.cashClosures.expectedCash },
        { section: "Caja", metric: "Efectivo contado", value: report.cashClosures.countedCash },
        { section: "Caja", metric: "Diferencia", value: report.cashClosures.differenceCash },
        { section: "Tickets", metric: "Activos", value: report.tickets.active },
        { section: "Tickets", metric: "Pagados sin salida", value: report.tickets.paidAwaitingExit },
        { section: "Accesos", metric: "Entradas", value: report.access.entries },
        { section: "Accesos", metric: "Salidas", value: report.access.exits },
        { section: "Accesos", metric: "Denegados", value: report.access.denied },
        { section: "Ocupacion", metric: "Ocupados", value: report.occupancy.occupied },
        ...report.byCashier.map(row => ({ section: "Cajera", metric: row.cashierName, value: row.total })),
      ];
      const columns: XlsxColumn<(typeof rows)[number]>[] = [
        { header: "Seccion", width: 20, value: row => row.section },
        { header: "Metrica", width: 28, value: row => row.metric },
        { header: "Valor", width: 18, value: row => row.value },
      ];
      await sendXlsxTable(res, { filename: `operacion-diaria-${report.date}.xlsx`, sheetName: "Operacion diaria", columns, rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard/export/operations-daily.pdf", requireAnyRole(["admin", "finance"]), (req, res) => {
    const date = parseBusinessDateQuery(req.query.date);
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined));
    const buffer = createSimpleReportPdfBuffer({
      title: `Operacion diaria Parkia - ${report.date}`,
      subtitle: "Reporte ejecutivo de visitas, caja, accesos y ocupacion",
      rows: [
        ["Ingresos visitas", report.visitorRevenue.total],
        ["Tickets cobrados", report.visitorRevenue.count],
        ["Efectivo visitas", report.visitorRevenue.cash],
        ["Tarjeta visitas", report.visitorRevenue.card],
        ["Transferencia visitas", report.visitorRevenue.transfer],
        ["Cierres de caja", report.cashClosures.count],
        ["Efectivo esperado", report.cashClosures.expectedCash],
        ["Efectivo contado", report.cashClosures.countedCash],
        ["Diferencia de caja", report.cashClosures.differenceCash],
        ["Cajas abiertas", report.cashClosures.openSessions],
        ["Tickets activos", report.tickets.active],
        ["Tickets pagados sin salida", report.tickets.paidAwaitingExit],
        ["Tickets completados hoy", report.tickets.completedToday],
        ["Accesos totales", report.access.total],
        ["Entradas", report.access.entries],
        ["Salidas", report.access.exits],
        ["Denegados", report.access.denied],
        ["Salidas denegadas sin resolver", report.access.unresolvedDeniedExits],
        ["Estacionamientos ocupados", report.occupancy.occupied],
        ["Estacionamientos disponibles", report.occupancy.available],
      ],
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="operacion-diaria-${report.date}.pdf"`);
    res.send(buffer);
  });

  app.get("/api/dashboard", (req, res) => {
    ensureUpcomingReceivables();
    refreshOverduePayments();
    const currentUser = getCurrentUser(req);
    const canSeeFinance = canSeeFinanceRole(currentUser?.role);
    const canSeeContracts = canSeeContractsRole(currentUser?.role);

    // Occupancy
    const totalSpaces = db.prepare("SELECT COUNT(*) as count FROM spaces WHERE type = 'parking'").get() as { count: number };
    const occupiedSpaces = db.prepare("SELECT COUNT(*) as count FROM spaces WHERE type = 'parking' AND status = 'occupied'").get() as { count: number };
    const parkingFree = db.prepare("SELECT COUNT(*) as count FROM spaces WHERE type = 'parking' AND status = 'available'").get() as { count: number };
    const availableSpaces = db.prepare(`
      SELECT id, name, type, location, level
      FROM spaces
      WHERE status = 'available'
        AND type = 'parking'
      ORDER BY type ASC, name ASC
    `).all() as Array<{ id: number, name: string, type: "parking", location: string | null, level: string | null }>;

    // Revenue
    const totalCollected = canSeeFinance
      ? db.prepare("SELECT SUM(amount) as total FROM payments WHERE status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')").get() as { total: number }
      : { total: 0 };
    const visitorCollected = canSeeFinance
      ? db.prepare("SELECT SUM(amount) as total FROM visitor_tickets WHERE amount > 0 AND payment_method IS NOT NULL AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')").get() as { total: number }
      : { total: 0 };
    const previousMonthCollected = canSeeFinance
      ? db.prepare("SELECT SUM(amount) as total FROM payments WHERE status = 'paid' AND strftime('%Y-%m', payment_date) = strftime('%Y-%m', date('now', 'start of month', '-1 month'))").get() as { total: number }
      : { total: 0 };
    const previousMonthVisitorCollected = canSeeFinance
      ? db.prepare("SELECT SUM(amount) as total FROM visitor_tickets WHERE amount > 0 AND payment_method IS NOT NULL AND paid_at IS NOT NULL AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', date('now', 'start of month', '-1 month'))").get() as { total: number }
      : { total: 0 };
    const targetRevenue = canSeeFinance
      ? db.prepare("SELECT SUM(monthly_fee) as total FROM contracts WHERE status = 'active'").get() as { total: number }
      : { total: 0 };
    const currentRevenueTotal = Number(totalCollected.total || 0) + Number(visitorCollected.total || 0);
    const previousRevenueTotal = Number(previousMonthCollected.total || 0) + Number(previousMonthVisitorCollected.total || 0);

    // Access
    const accessWindow = getBusinessDayWindow();
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
    `).get(accessWindow.startSql, accessWindow.endSql) as { total: number, authorized_total: number | null, entries: number | null, exits: number | null, denied: number | null };
    const allTodayAccess = getDashboardTodayAccessRows(5000, accessWindow);
    const hourlyAccess = buildHourlyAccessSeries(allTodayAccess, accessWindow.timeZone);
    const todayAccess = allTodayAccess.slice(0, 10);
    const recentAccess = todayAccess.length === 0 ? getDashboardRecentAccessRows(5, accessWindow) : [];
    const liveAccess = todayAccess.length > 0 ? todayAccess.slice(0, 5) : recentAccess;
    const lastAccessEvent = db.prepare("SELECT timestamp FROM access_logs ORDER BY timestamp DESC, id DESC LIMIT 1").get() as { timestamp: string } | undefined;

    // Expiring Contracts
    const expiringContracts = canSeeContracts ? db.prepare(`
      SELECT c.*, cl.name as client_name, s.name as space_name 
      FROM contracts c 
      JOIN clients cl ON c.client_id = cl.id 
      JOIN spaces s ON c.space_id = s.id
      WHERE c.status = 'active'
        AND c.end_date >= date('now')
        AND c.end_date <= date('now', '+30 days')
      ORDER BY c.end_date ASC
    `).all() : [];

    // Recent Payments
    const recentPayments = canSeeFinance ? db.prepare(`
      SELECT p.*, cl.name as client_name 
      FROM payments p 
      JOIN contracts c ON p.contract_id = c.id 
      JOIN clients cl ON c.client_id = cl.id
      WHERE p.status = 'paid'
        AND p.payment_date IS NOT NULL
      ORDER BY p.payment_date DESC LIMIT 5
    `).all() : [];

    const operationsDaily = buildDailyOperationsReport(accessWindow);
    if (!canSeeFinance) {
      operationsDaily.visitorRevenue = { total: 0, count: operationsDaily.visitorRevenue.count, cash: 0, card: 0, transfer: 0 };
      operationsDaily.cashClosures.expectedCash = 0;
      operationsDaily.cashClosures.countedCash = 0;
      operationsDaily.cashClosures.differenceCash = 0;
      operationsDaily.byCashier = [];
    }

    res.json({
      occupancy: {
        total: totalSpaces.count,
        occupied: occupiedSpaces.count,
        parking_free: parkingFree.count,
        storage_free: 0,
        available_parking: availableSpaces.filter(space => space.type === "parking"),
        available_storage: []
      },
      revenue: {
        total_collected: currentRevenueTotal,
        target: targetRevenue.total || 0,
        trend: calculateRevenueTrend(currentRevenueTotal, previousRevenueTotal)
      },
      access: {
        business_date: accessWindow.businessDate,
        timezone: accessWindow.timeZone,
        window_start_utc: accessWindow.start.toISOString(),
        window_end_utc: accessWindow.end.toISOString(),
        daily_total: accessSummary.total,
        today_total: accessSummary.total,
        today_authorized_total: accessSummary.authorized_total || 0,
        today_entries: accessSummary.entries || 0,
        today_exits: accessSummary.exits || 0,
        today_denied: accessSummary.denied || 0,
        entries: accessSummary.entries || 0,
        exits: accessSummary.exits || 0,
        denied: accessSummary.denied || 0,
        hourly_peaks: hourlyAccess.map(p => ({ hour: p.hour, count: p.count })),
        hourly_series: hourlyAccess.map(p => ({
          hour: p.hour,
          count: p.count,
          entries: p.entries,
          exits: p.exits,
          denied: p.denied
        })),
        today_access: todayAccess,
        recent_access: recentAccess,
        last_event_at: lastAccessEvent?.timestamp || null
      },
      expiring_contracts: expiringContracts,
      recent_payments: recentPayments,
      live_access: liveAccess,
      alerts: buildDashboardAlerts(currentUser),
      operations_daily: operationsDaily,
    });
  });
}
