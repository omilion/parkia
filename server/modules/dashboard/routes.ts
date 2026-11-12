import type { Express } from "express";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { createSimpleReportPdfBuffer } from "../../pdf";
import { getTenantIdFromRequest } from "../../tenant";
import { sendXlsxTable, type XlsxColumn } from "../../xlsx";
import {
  buildDailyOperationsReport,
  buildDashboardAlerts,
  buildMainDashboardPayload,
  canSeeFinanceRole,
  createTaskFromDashboardAlert,
  getBusinessDayWindowForDate,
  parseBranchIdQuery,
  parseBusinessDateQuery,
  performGlobalSearch,
  toCsv,
} from "./service";

export function registerDashboardRoutes(app: Express) {
  app.get("/api/search", (req, res) => {
    const currentUser = getCurrentUser(req);
    const tenantId = getTenantIdFromRequest(req);
    const query = req.query.q as string;
    res.json(performGlobalSearch(currentUser, tenantId, query));
  });

  app.get("/api/dashboard/alerts", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    res.json({ alerts: buildDashboardAlerts(getCurrentUser(req), tenantId) });
  });

  app.post("/api/dashboard/alerts/:id/task", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const result = createTaskFromDashboardAlert(req, req.params.id);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, existing: result.existing, task: result.task });
  });

  app.get("/api/dashboard/operations-daily", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const date = parseBusinessDateQuery(req.query.date);
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const branchId = rawBranchId ? getBranchOrDefault(rawBranchId, tenantId) : null;
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined), branchId, tenantId);
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
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const branchId = rawBranchId ? getBranchOrDefault(rawBranchId, tenantId) : null;
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined), branchId, tenantId);
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
      const tenantId = getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const branchId = rawBranchId ? getBranchOrDefault(rawBranchId, tenantId) : null;
      const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined), branchId, tenantId);
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
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const branchId = rawBranchId ? getBranchOrDefault(rawBranchId, tenantId) : null;
    const report = buildDailyOperationsReport(getBusinessDayWindowForDate(date || undefined), branchId, tenantId);
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
    const result = buildMainDashboardPayload(req);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json(result.data);
  });
}
