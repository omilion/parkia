import type { Express } from "express";
import { getTenantIdFromRequest } from "../../../tenant";
import { sendXlsxTable } from "../../../xlsx";
import {
  monthQuerySchema,
  parseBankMovementExportStatuses,
  parseBranchIdQuery,
  paymentStatusQuerySchema,
} from "../shared";
import {
  buildBankMovementsCsvExport,
  buildBankMovementsXlsxExport,
  buildBudgetReport,
  buildCashFlowProjection,
  buildExpensesCsvExport,
  buildExpensesXlsxExport,
  buildMonthlyClose,
  buildMonthlyCloseCsvExport,
  buildMonthlyCloseXlsxExport,
  buildOperationalClose,
  buildOperationalCloseCsvExport,
  buildOperationalCloseXlsxExport,
  buildPaymentsCsvExport,
  buildPaymentsXlsxExport,
  getCollectionsReport,
  getDelinquencyReport,
  getFinanceSummary,
  getProfitabilityReport,
} from "./service";

export function registerReportsRoutes(app: Express) {
  app.get("/api/finance/summary", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(getFinanceSummary(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/collections", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(getCollectionsReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/delinquency", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(getDelinquencyReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/profitability", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(getProfitabilityReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/budget", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(buildBudgetReport(query.data.month, getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/cash-flow", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(buildCashFlowProjection(query.data.month, getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/monthly-close", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(buildMonthlyClose(query.data.month, getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/operational-close", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(buildOperationalClose(query.data.month, getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/export/operational-close.csv", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const exported = buildOperationalCloseCsvExport(query.data.month, getTenantIdFromRequest(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/operational-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const exported = buildOperationalCloseXlsxExport(query.data.month, getTenantIdFromRequest(req));
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/monthly-close.csv", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const exported = buildMonthlyCloseCsvExport(query.data.month, getTenantIdFromRequest(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/monthly-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const exported = buildMonthlyCloseXlsxExport(query.data.month, getTenantIdFromRequest(req));
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/expenses.csv", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const csv = buildExpensesCsvExport(tenantId, rawBranchId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"gastos.csv\"");
    res.send(csv);
  });

  app.get("/api/finance/export/expenses.xlsx", async (req, res, next) => {
    try {
      const tenantId = getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = buildExpensesXlsxExport(tenantId, rawBranchId);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/payments.csv", (req, res) => {
    const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
    if (!status.success) return res.status(400).json({ error: "Estado inválido" });

    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const csv = buildPaymentsCsvExport(tenantId, rawBranchId, status.data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cuentas-por-cobrar.csv\"");
    res.send(csv);
  });

  app.get("/api/finance/export/payments.xlsx", async (req, res, next) => {
    try {
      const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
      if (!status.success) return res.status(400).json({ error: "Estado inv\u00e1lido" });
      const tenantId = getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = buildPaymentsXlsxExport(tenantId, rawBranchId, status.data);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/bank-movements.csv", (req, res) => {
    const statuses = parseBankMovementExportStatuses(req.query.status);
    if (!statuses) return res.status(400).json({ error: "Estado inválido" });

    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const exported = buildBankMovementsCsvExport(tenantId, rawBranchId, statuses);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/bank-movements.xlsx", async (req, res, next) => {
    try {
      const statuses = parseBankMovementExportStatuses(req.query.status);
      if (!statuses) return res.status(400).json({ error: "Estado inv\u00e1lido" });

      const tenantId = getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = buildBankMovementsXlsxExport(tenantId, rawBranchId, statuses);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });
}

