import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import type { AuthRole, AuthUser } from "../../auth/sessions";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { DEFAULT_TIMEZONE, getBranchTimezone } from "../../platform/timezone";
import { getTenantIdFromRequest } from "../../tenant";
import { dteService } from "../dte/instance";
import {
  findPreferredStaffByRoleInDb,
  getActiveTaskForAlertFromDb,
  getDashboardRecentAccessRowsFromDb,
  getDashboardTodayAccessRowsFromDb,
  getOperationalTaskFromDb,
  insertTaskFromAlertInDb,
  queryDailyOperationsMetricsFromDb,
  queryDashboardAlertCountsFromDb,
  queryMainDashboardFromDb,
  searchForAdminOrFinanceInDb,
  searchForGuardOrCashierInDb,
} from "./repo";

export type DashboardAlert = {
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
const ACCESS_TIMEZONE = DEFAULT_TIMEZONE;

const alertTypesByRole: Record<AuthRole, string[]> = {
  admin: ["finance", "access", "documents", "contracts", "maintenance", "general", "billing"],
  finance: ["finance", "documents", "contracts", "general"],
  guard: ["access", "maintenance", "general"],
  cashier: ["general"],
};

export function canSeeFinanceRole(role: AuthRole | undefined) {
  return role === "admin" || role === "finance";
}

export function canSeeContractsRole(role: AuthRole | undefined) {
  return role === "admin" || role === "finance";
}

export function canSeeAlert(user: AuthUser | null, alert: Pick<DashboardAlert, "type">) {
  if (!user) return false;
  return alertTypesByRole[user.role].includes(alert.type);
}

async function attachTaskState(alert: Omit<DashboardAlert, "taskId">, tenantId: number, fallbackTaskId?: number | null): Promise<DashboardAlert> {
  const task = await getActiveTaskForAlertFromDb(alert.id, tenantId);
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

async function getDefaultAssigneeForCategory(category: TaskCategory, currentUser: AuthUser | null, tenantId: number) {
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

  const staff = await findPreferredStaffByRoleInDb(preferredRole, tenantId);
  return staff?.id || currentUser?.id || null;
}

export function calculateRevenueTrend(currentTotal: number, previousTotal: number) {
  if (previousTotal <= 0) return currentTotal > 0 ? 100 : 0;
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
}

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

export function getBusinessDayWindow(date = new Date(), timeZone = ACCESS_TIMEZONE) {
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

export function parseBusinessDateQuery(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function parseBranchIdQuery(value: unknown) {
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

export function getBusinessDayWindowForDate(dateText?: string, timeZone = ACCESS_TIMEZONE) {
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

export function toCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map(row => row.map(escape).join(",")).join("\n");
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

export function buildHourlyAccessSeries(rows: any[], timeZone: string) {
  const buckets = new Map<number, { hour: number; count: number; entries: number; exits: number; denied: number }>();

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

export async function buildDailyOperationsReport(
  window: ReturnType<typeof getBusinessDayWindow>,
  branchId: number | null,
  tenantId: number,
) {
  const {
    visitorRevenue,
    visitorStatus,
    cashClosures,
    accessSummary,
    unresolvedDeniedExits,
    openCashSessions,
    occupancy,
    byCashier,
  } = await queryDailyOperationsMetricsFromDb(window.startSql, window.endSql, branchId, tenantId);

  const hourly = buildHourlyAccessSeries(
    await getDashboardTodayAccessRowsFromDb(5000, window.startSql, window.endSql, branchId, tenantId),
    window.timeZone,
  );

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

const DTE_ALERT_TITLES: Record<string, string> = {
  CERT_EXPIRED: "Certificado digital vencido",
  CERT_EXPIRING: "Certificado digital por vencer",
  NO_CAF: "Sin folios para boletas",
  CAF_LOW: "Folios por agotarse",
  QUEUE_STUCK: "Documentos sin enviar al SII",
  REJECTED: "Documentos rechazados por el SII",
};

export async function buildDashboardAlerts(user: AuthUser | null, tenantId: number) {
  const alerts: DashboardAlert[] = [];
  const severityRank = { critical: 0, warning: 1, info: 2 };
  const accessWindow = getBusinessDayWindow(new Date(), await getBranchTimezone(null, tenantId));

  const {
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
  } = await queryDashboardAlertCountsFromDb({
    userId: user?.id || null,
    tenantId,
    accessWindowStartSql: accessWindow.startSql,
    accessWindowEndSql: accessWindow.endSql,
  });

  if (user) {
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

  if (overduePayments.count > 0) {
    alerts.push(await attachTaskState({
      id: "overdue-payments",
      type: "finance",
      severity: "critical",
      title: "Clientes en mora",
      detail: `${overduePayments.count} cuenta(s) vencida(s) por $${Number(overduePayments.amount || 0).toLocaleString()}`,
      count: overduePayments.count,
      amount: overduePayments.amount || 0,
      href: "/finance?tab=collections&collectionStatus=open&collectionDue=all",
      actionLabel: "Gestionar cobranza",
    }, tenantId));
  }

  if (overdueExpenses.count > 0) {
    alerts.push(await attachTaskState({
      id: "overdue-expenses",
      type: "finance",
      severity: "critical",
      title: "Gastos vencidos",
      detail: `${overdueExpenses.count} gasto(s) vencido(s) por $${Number(overdueExpenses.amount || 0).toLocaleString()}`,
      count: overdueExpenses.count,
      amount: overdueExpenses.amount || 0,
      href: "/finance?tab=expenses&expenseStatus=overdue&expenseDue=all",
      actionLabel: "Revisar pagos",
    }, tenantId));
  }

  if (pendingBankMovements.count > 0) {
    alerts.push(await attachTaskState({
      id: "bank-reconciliation",
      type: "finance",
      severity: "warning",
      title: "Cartola por conciliar",
      detail: `${pendingBankMovements.count} movimiento(s) bancario(s) requieren revisión`,
      count: pendingBankMovements.count,
      href: "/finance?tab=cgvc&movementStatus=attention",
      actionLabel: "Conciliar",
    }, tenantId));
  }

  if (dueCollectionActions.count > 0) {
    alerts.push(await attachTaskState({
      id: "collection-actions",
      type: "finance",
      severity: "warning",
      title: "Seguimientos de cobranza",
      detail: `${dueCollectionActions.count} seguimiento(s) vencen hoy o están atrasados`,
      count: dueCollectionActions.count,
      href: "/finance?tab=collections&collectionStatus=open&collectionDue=actionable",
      actionLabel: "Ver seguimiento",
    }, tenantId));
  }

  if (documentIssues.count > 0) {
    alerts.push(await attachTaskState({
      id: "document-review",
      type: "documents",
      severity: "warning",
      title: "Documentos por revisar",
      detail: `${documentIssues.count} documento(s) pendientes, rechazados o próximos a vencer`,
      count: documentIssues.count,
      href: "/documents?filter=critical",
      actionLabel: "Revisar documentos",
    }, tenantId));
  }

  if (deniedAccess.count > 0) {
    alerts.push(await attachTaskState({
      id: "denied-access",
      type: "access",
      severity: "critical",
      title: "Accesos denegados hoy",
      detail: `${deniedAccess.count} intento(s) de acceso denegado registrados`,
      count: deniedAccess.count,
      href: `/access?tab=audit&type=denied&start=${accessWindow.businessDate}`,
      actionLabel: "Ver accesos",
    }, tenantId));
  }

  if (guardShiftFollowUps.count > 0) {
    alerts.push(await attachTaskState({
      id: "guard-shift-follow-ups",
      type: "access",
      severity: Number(guardShiftFollowUps.high_count || 0) > 0 ? "critical" : "warning",
      title: "Seguimientos de Guardia",
      detail: `${guardShiftFollowUps.count} pendiente(s) de bitácora requieren traspaso o cierre operacional`,
      count: guardShiftFollowUps.count,
      href: "/access?tab=shift-log",
      actionLabel: "Ver bitácora",
    }, tenantId, guardShiftFollowUps.task_id));
  }

  if (expiringContracts.count > 0) {
    alerts.push(await attachTaskState({
      id: "expiring-contracts",
      type: "contracts",
      severity: "info",
      title: "Contratos por vencer",
      detail: `${expiringContracts.count} contrato(s) vencen dentro de 30 días`,
      count: expiringContracts.count,
      href: "/contracts?filter=expiring",
      actionLabel: "Revisar contratos",
    }, tenantId));
  }

  // Facturacion electronica: el administrador se entera del certificado o los folios sin abrir el asistente.
  // Las empresas que no usan el SII no generan ninguna alerta.
  if (user?.role === "admin") {
    for (const dteAlert of (await dteService.getOnboarding(tenantId)).alerts) {
      alerts.push(await attachTaskState({
        id: `dte-${dteAlert.code.toLowerCase().replace(/_/g, "-")}`,
        type: "billing",
        severity: dteAlert.level === "error" ? "critical" : "warning",
        title: DTE_ALERT_TITLES[dteAlert.code] || "Facturación electrónica",
        detail: dteAlert.message,
        count: 1,
        href: "/settings?tab=sii",
        actionLabel: "Abrir facturación",
      }, tenantId));
    }
  }

  return alerts
    .filter(alert => canSeeAlert(user, alert))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count)
    .slice(0, 8);
}

export async function performGlobalSearch(currentUser: AuthUser | null, tenantId: number, query: string) {
  if (!query || query.length < 2) return [];

  const likeQuery = `%${query}%`;
  const results: Array<{ id: number; type: string; title: string; subtitle: string; link: string }> = [];

  if (currentUser?.role === "admin" || currentUser?.role === "finance") {
    const { clients, vehicles } = await searchForAdminOrFinanceInDb(tenantId, likeQuery);
    clients.forEach(c => results.push({ id: c.id, type: "client", title: c.name, subtitle: `RUT: ${c.rut} - Cliente`, link: `/clients?id=${c.id}` }));
    vehicles.forEach(v => results.push({ id: v.client_id, type: "client", title: v.client_name, subtitle: `Patente: ${v.plate}`, link: `/clients?id=${v.client_id}` }));
  } else if (currentUser?.role === "guard" || currentUser?.role === "cashier") {
    const vehicles = await searchForGuardOrCashierInDb(tenantId, likeQuery);
    vehicles.forEach(v => results.push({
      id: v.id,
      type: "space",
      title: `Patente ${v.plate}`,
      subtitle: v.space_name ? `Vehiculo registrado · ${v.space_name}` : "Vehiculo registrado",
      link: currentUser?.role === "cashier" ? "/spaces" : "/access",
    }));
  }

  return results;
}

export async function createTaskFromDashboardAlert(req: Request, alertId: string) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const alert = (await buildDashboardAlerts(currentUser, tenantId)).find((item) => item.id === alertId);
  if (!alert) return { ok: false as const, status: 404, error: "Alerta no encontrada o ya resuelta" };
  if (alert.taskId) {
    return { ok: true as const, existing: true, task: await getOperationalTaskFromDb(alert.taskId, tenantId) };
  }

  const existing = await getActiveTaskForAlertFromDb(alert.id, tenantId);
  if (existing) {
    return { ok: true as const, existing: true, task: await getOperationalTaskFromDb(existing.id, tenantId) };
  }

  if (!canCreateTaskForAlert(currentUser, alert)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para crear tareas desde esta alerta" };
  }

  const category = categoryFromAlertType(alert.type);
  const assigneeId = await getDefaultAssigneeForCategory(category, currentUser, tenantId);
  const insertedId = await insertTaskFromAlertInDb({
    title: alert.title,
    description: `${alert.detail}\n\nOrigen: alerta prioritaria del dashboard. Accion sugerida: ${alert.actionLabel}.`,
    category,
    priority: priorityFromSeverity(alert.severity),
    assigneeId,
    alertId: alert.id,
    createdByStaffId: currentUser?.id || null,
    tenantId,
  });

  await recordAuditEvent(req, {
    action: "dashboard_alert.task_created",
    entityType: "operational_task",
    entityId: insertedId,
    metadata: {
      alertId: alert.id,
      alertTitle: alert.title,
      alertSeverity: alert.severity,
      assignedStaffId: assigneeId,
    },
  });

  return { ok: true as const, existing: false, task: await getOperationalTaskFromDb(insertedId, tenantId) };
}

export async function buildMainDashboardPayload(req: Request) {
  const currentUser = await getCurrentUser(req);
  const canSeeFinance = canSeeFinanceRole(currentUser?.role);
  const canSeeContracts = canSeeContractsRole(currentUser?.role);
  const tenantId = await getTenantIdFromRequest(req);
  const rawBranchId = parseBranchIdQuery(req.query.branch_id);
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const accessWindow = getBusinessDayWindow(new Date(), await getBranchTimezone(branchId, tenantId));

  const metrics = await queryMainDashboardFromDb({
    tenantId,
    branchId,
    canSeeFinance,
    canSeeContracts,
    accessWindowStartSql: accessWindow.startSql,
    accessWindowEndSql: accessWindow.endSql,
  });

  if (branchId && !metrics.selectedBranch) {
    return { ok: false as const, status: 404, error: "Sucursal no encontrada" };
  }

  const currentRevenueTotal = Number(metrics.totalCollected.total || 0) + Number(metrics.visitorCollected.total || 0);
  const previousRevenueTotal = Number(metrics.previousMonthCollected.total || 0) + Number(metrics.previousMonthVisitorCollected.total || 0);

  const allTodayAccess = await getDashboardTodayAccessRowsFromDb(5000, accessWindow.startSql, accessWindow.endSql, branchId, tenantId);
  const hourlyAccess = buildHourlyAccessSeries(allTodayAccess, accessWindow.timeZone);
  const todayAccess = allTodayAccess.slice(0, 10);
  const recentAccess = todayAccess.length === 0 ? await getDashboardRecentAccessRowsFromDb(5, accessWindow.startSql, branchId, tenantId) : [];
  const liveAccess = todayAccess.length > 0 ? todayAccess.slice(0, 5) : recentAccess;

  const operationsDaily = await buildDailyOperationsReport(accessWindow, branchId, tenantId);
  if (!canSeeFinance) {
    operationsDaily.visitorRevenue = { total: 0, count: operationsDaily.visitorRevenue.count, cash: 0, card: 0, transfer: 0 };
    operationsDaily.cashClosures.expectedCash = 0;
    operationsDaily.cashClosures.countedCash = 0;
    operationsDaily.cashClosures.differenceCash = 0;
    operationsDaily.byCashier = [];
  }

  return {
    ok: true as const,
    data: {
      branch: metrics.selectedBranch || null,
      occupancy: {
        total: metrics.totalSpaces.count,
        occupied: metrics.occupiedSpaces.count,
        parking_free: metrics.parkingFree.count,
        available_parking: metrics.availableSpaces,
      },
      revenue: {
        total_collected: currentRevenueTotal,
        target: metrics.targetRevenue.total || 0,
        trend: calculateRevenueTrend(currentRevenueTotal, previousRevenueTotal),
      },
      access: {
        business_date: accessWindow.businessDate,
        timezone: accessWindow.timeZone,
        window_start_utc: accessWindow.start.toISOString(),
        window_end_utc: accessWindow.end.toISOString(),
        daily_total: metrics.accessSummary.total,
        today_total: metrics.accessSummary.total,
        today_authorized_total: metrics.accessSummary.authorized_total || 0,
        today_entries: metrics.accessSummary.entries || 0,
        today_exits: metrics.accessSummary.exits || 0,
        today_denied: metrics.accessSummary.denied || 0,
        entries: metrics.accessSummary.entries || 0,
        exits: metrics.accessSummary.exits || 0,
        denied: metrics.accessSummary.denied || 0,
        hourly_peaks: hourlyAccess.map(p => ({ hour: p.hour, count: p.count })),
        hourly_series: hourlyAccess.map(p => ({
          hour: p.hour,
          count: p.count,
          entries: p.entries,
          exits: p.exits,
          denied: p.denied,
        })),
        today_access: todayAccess,
        recent_access: recentAccess,
        last_event_at: metrics.lastAccessEvent?.timestamp || null,
      },
      expiring_contracts: metrics.expiringContracts,
      recent_payments: metrics.recentPayments,
      live_access: liveAccess,
      alerts: await buildDashboardAlerts(currentUser, tenantId),
      operations_daily: operationsDaily,
    },
  };
}
