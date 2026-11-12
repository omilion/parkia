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
  app.get("/api/finance/summary", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(await getFinanceSummary(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/collections", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(await getCollectionsReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/delinquency", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(await getDelinquencyReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/profitability", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    res.json(await getProfitabilityReport(tenantId, rawBranchId));
  });

  app.get("/api/finance/reports/budget", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(await buildBudgetReport(query.data.month, await getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/cash-flow", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(await buildCashFlowProjection(query.data.month, await getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/monthly-close", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(await buildMonthlyClose(query.data.month, await getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/reports/operational-close", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(await buildOperationalClose(query.data.month, await getTenantIdFromRequest(req)));
  });

  app.get("/api/finance/export/operational-close.csv", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const exported = await buildOperationalCloseCsvExport(query.data.month, await getTenantIdFromRequest(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/operational-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const exported = await buildOperationalCloseXlsxExport(query.data.month, await getTenantIdFromRequest(req));
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/monthly-close.csv", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const exported = await buildMonthlyCloseCsvExport(query.data.month, await getTenantIdFromRequest(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/monthly-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const exported = await buildMonthlyCloseXlsxExport(query.data.month, await getTenantIdFromRequest(req));
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/expenses.csv", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const csv = await buildExpensesCsvExport(tenantId, rawBranchId);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"gastos.csv\"");
    res.send(csv);
  });

  app.get("/api/finance/export/expenses.xlsx", async (req, res, next) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = await buildExpensesXlsxExport(tenantId, rawBranchId);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/payments.csv", async (req, res) => {
    const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
    if (!status.success) return res.status(400).json({ error: "Estado inválido" });

    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const csv = await buildPaymentsCsvExport(tenantId, rawBranchId, status.data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cuentas-por-cobrar.csv\"");
    res.send(csv);
  });

  app.get("/api/finance/export/payments.xlsx", async (req, res, next) => {
    try {
      const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
      if (!status.success) return res.status(400).json({ error: "Estado inv\u00e1lido" });
      const tenantId = await getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = await buildPaymentsXlsxExport(tenantId, rawBranchId, status.data);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/bank-movements.csv", async (req, res) => {
    const statuses = parseBankMovementExportStatuses(req.query.status);
    if (!statuses) return res.status(400).json({ error: "Estado inválido" });

    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const exported = await buildBankMovementsCsvExport(tenantId, rawBranchId, statuses);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exported.filename}"`);
    res.send(exported.csv);
  });

  app.get("/api/finance/export/bank-movements.xlsx", async (req, res, next) => {
    try {
      const statuses = parseBankMovementExportStatuses(req.query.status);
      if (!statuses) return res.status(400).json({ error: "Estado inv\u00e1lido" });

      const tenantId = await getTenantIdFromRequest(req);
      const rawBranchId = parseBranchIdQuery(req.query.branch_id);
      const exported = await buildBankMovementsXlsxExport(tenantId, rawBranchId, statuses);
      await sendXlsxTable(res, exported);
    } catch (error) {
      next(error);
    }
  });
}

