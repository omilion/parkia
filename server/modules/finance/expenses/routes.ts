import type { Express } from "express";
import { budgetFieldsSchema, expenseFieldsSchema, expenseReceiptSchema } from "../../../../shared/schemas/finance";
import { z } from "zod";
import { getCurrentUser } from "../../../auth/sessions";
import { paginatedResponse, parsePagination } from "../../../pagination";
import { getTenantIdFromRequest } from "../../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../../validation";
import { budgetCategorySchema, monthQuerySchema, parseBranchIdQuery } from "../shared";
import {
  approveOrRejectExpense,
  changeExpenseStatus,
  createExpense,
  deleteBudget,
  getExpenseBankSuggestions,
  listBudgets,
  listExpenses,
  reconcileExpenseWithBank,
  resolveExpenseReceiptDownload,
  updateExpense,
  upsertBudget,
} from "./service";

const expenseSchema = expenseFieldsSchema.extend({
  bank_movement_id: z.coerce.number().int().positive().optional().nullable(),
  receipt: expenseReceiptSchema.optional(),
});

const expenseApprovalSchema = z.object({
  approval_status: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(3).max(500),
});

const expenseStatusSchema = z.object({
  payment_status: z.enum(["pending", "paid", "overdue", "cancelled"]),
  paid_at: dateStringSchema.optional().nullable(),
  payment_method: z.enum(["cash", "transfer", "card", "automatic", "other"]).optional().nullable(),
  bank_movement_id: z.coerce.number().int().positive().optional().nullable(),
  notes: optionalTextSchema,
});

const reconcileExpenseSchema = z.object({
  bank_movement_id: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(500),
});

const expenseQuerySchema = z.object({
  status: z.enum(["pending", "paid", "overdue", "cancelled", "all"]).optional(),
  category: z.enum(["rent", "maintenance", "utilities", "payroll", "supplies", "taxes", "admin", "other", "all"]).optional(),
  due: z.enum(["overdue", "today", "upcoming", "all"]).optional(),
});

const financialBudgetSchema = budgetFieldsSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

export function registerExpensesRoutes(app: Express) {
  app.get("/api/finance/expenses", async (req, res) => {
    const query = expenseQuerySchema.safeParse({
      status: req.query.status || undefined,
      category: req.query.category || undefined,
      due: req.query.due || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de gastos inválidos" });

    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);

    const { expenses, total } = await listExpenses({
      tenantId,
      rawBranchId,
      status: query.data.status,
      category: query.data.category,
      due: query.data.due,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(expenses, total, pagination) : expenses);
  });

  app.post("/api/finance/expenses", async (req, res) => {
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await createExpense(req, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, id: result.id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/expenses/:id", async (req, res) => {
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await updateExpense(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/expenses/:id/status", async (req, res) => {
    const body = parseBody(expenseStatusSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await changeExpenseStatus(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/expenses/:id/approval", async (req, res) => {
    const user = await getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administracion puede aprobar o rechazar gastos" });
    const body = parseBody(expenseApprovalSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await approveOrRejectExpense(req, req.params.id, tenantId, user.id, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.get("/api/finance/expenses/:id/receipt", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const result = await resolveExpenseReceiptDownload(req.params.id, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.type(result.mimeType);
    res.download(result.absolutePath, result.fileName);
  });

  app.get("/api/finance/expenses/:id/bank-suggestions", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const result = await getExpenseBankSuggestions(req.params.id, tenantId);
    if (!result) return res.status(404).json({ error: "Gasto no encontrado" });
    res.json(result);
  });

  app.post("/api/finance/expenses/:id/reconcile-bank", async (req, res) => {
    const body = parseBody(reconcileExpenseSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await reconcileExpenseWithBank(req, req.params.id, tenantId, body);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/budgets", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    const tenantId = await getTenantIdFromRequest(req);
    res.json(await listBudgets(query.data.month, tenantId));
  });

  app.post("/api/finance/budgets", async (req, res) => {
    const body = parseBody(financialBudgetSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const budget = await upsertBudget(req, tenantId, body);
      res.json({ success: true, budget });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/finance/budgets/:month/:category", async (req, res) => {
    const params = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      category: budgetCategorySchema,
    }).safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: "Presupuesto invÃ¡lido" });

    const tenantId = await getTenantIdFromRequest(req);
    const result = await deleteBudget(req, params.data.month, params.data.category, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });
}

