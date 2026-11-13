import type { Request } from "express";
import { existsSync } from "fs";
import { recordAuditEvent } from "../../../audit";
import { getBranchOrDefault } from "../../../branches";
import type { PaginationParams } from "../../../pagination";
import { resolveStoredFile, storeDocumentFile } from "../../../storage";
import { todayLocal } from "../../../../shared/dates";
import {
  ensureFinanceDatesOpen,
  ensureFinanceMonthOpen,
  getExpenseByBankMovement,
  getMonthRange,
  normalizeRut,
  refreshOverdueExpenses,
} from "../shared";
import {
  deleteBudgetInDb,
  findBudgetInDb,
  findExpenseByIdInDb,
  getExpenseReceiptMetadataFromDb,
  insertExpenseInDb,
  listBudgetsByMonthFromDb,
  listExpensesFromDb,
  listOpenBankMovementsForExpenseSuggestionsFromDb,
  reconcileExpenseWithBankInDb,
  updateExpenseApprovalInDb,
  updateExpenseInDb,
  updateExpenseStatusInDb,
  upsertBudgetInDb,
} from "./repo";

export async function listExpenses(params: {
  tenantId: number;
  rawBranchId: number | null;
  status?: string;
  category?: string;
  due?: string;
  pagination: PaginationParams;
}) {
  await refreshOverdueExpenses();
  const branchId = params.rawBranchId ? await getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return await listExpensesFromDb({
    ...params,
    branchId,
  });
}

export async function createExpense(
  req: Request,
  tenantId: number,
  body: {
    date?: string;
    category?: string;
    branch_id?: number | null;
    cost_center?: string;
    supplier_name?: string;
    supplier_rut?: string | null;
    description?: string;
    amount_net?: number;
    tax_amount?: number;
    amount_total?: number;
    document_type?: string;
    document_number?: string | null;
    payment_method?: string | null;
    payment_status?: string;
    paid_at?: string | null;
    due_date?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
    receipt?: {
      fileName?: string;
      mimeType?: "application/pdf" | "image/jpeg" | "image/png";
      dataBase64?: string;
    };
  }
): Promise<{ ok: true; id: number | bigint } | { ok: false; status: number; error: string }> {
  const branchId = body.branch_id ? await getBranchOrDefault(body.branch_id, tenantId) : null;
  if (body.payment_status === "paid" || body.bank_movement_id) {
    return { ok: false, status: 400, error: "El gasto debe aprobarse antes de marcarse pagado o asociarse a cartola" };
  }
  await ensureFinanceDatesOpen([body.date, body.paid_at || null, body.due_date || null], tenantId);
  const storedReceipt = body.receipt
    ? storeDocumentFile({
        fileName: body.receipt.fileName || "receipt",
        mimeType: body.receipt.mimeType || "application/pdf",
        dataBase64: body.receipt.dataBase64 || "",
        folder: "expense-receipts",
        tenantId,
      })
    : null;
  const amountNet = body.amount_net ?? Math.max(Number(body.amount_total) - Number(body.tax_amount || 0), 0);
  const taxAmount = body.tax_amount ?? Math.max(Number(body.amount_total) - amountNet, 0);
  const id = await insertExpenseInDb(tenantId, branchId, body, amountNet, taxAmount, storedReceipt);

  await recordAuditEvent(req, {
    action: "expense.created",
    entityType: "expense",
    entityId: id,
    metadata: {
      category: body.category,
      cost_center: body.cost_center,
      supplier_name: body.supplier_name,
      branch_id: branchId,
      amount_total: body.amount_total,
      payment_status: body.payment_status,
      receipt_file_path: storedReceipt?.filePath || null,
    },
  });
  return { ok: true, id };
}

export async function updateExpense(
  req: Request,
  expenseId: string,
  tenantId: number,
  body: {
    date?: string;
    category?: string;
    branch_id?: number | null;
    cost_center?: string;
    supplier_name?: string;
    supplier_rut?: string | null;
    description?: string;
    amount_net?: number;
    tax_amount?: number;
    amount_total?: number;
    document_type?: string;
    document_number?: string | null;
    payment_method?: string | null;
    payment_status?: string;
    paid_at?: string | null;
    due_date?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
    receipt?: {
      fileName?: string;
      mimeType?: "application/pdf" | "image/jpeg" | "image/png";
      dataBase64?: string;
    };
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const expense = await findExpenseByIdInDb(expenseId, tenantId);
  if (!expense) return { ok: false, status: 404, error: "Gasto no encontrado" };

  if ((body.payment_status === "paid" || body.bank_movement_id) && expense.approval_status !== "approved") {
    return { ok: false, status: 400, error: "El gasto debe estar aprobado antes de pagarse o asociarse a cartola" };
  }
  if (body.payment_status !== expense.payment_status && !body.notes?.trim()) {
    return { ok: false, status: 400, error: "Cambiar el estado de un gasto requiere nota operacional" };
  }

  const branchId = body.branch_id ? await getBranchOrDefault(body.branch_id, tenantId) : null;
  const paidAt = body.paid_at || (body.payment_status === "paid" ? todayLocal() : null);
  await ensureFinanceDatesOpen([expense.date, expense.paid_at, expense.due_date, body.date, paidAt, body.due_date || null], tenantId);
  const storedReceipt = body.receipt
    ? storeDocumentFile({
        fileName: body.receipt.fileName || "receipt",
        mimeType: body.receipt.mimeType || "application/pdf",
        dataBase64: body.receipt.dataBase64 || "",
        folder: "expense-receipts",
        tenantId,
      })
    : null;
  const amountNet = body.amount_net ?? Math.max(Number(body.amount_total) - Number(body.tax_amount || 0), 0);
  const taxAmount = body.tax_amount ?? Math.max(Number(body.amount_total) - amountNet, 0);

  await updateExpenseInDb(expenseId, tenantId, branchId, body, amountNet, taxAmount, paidAt, storedReceipt);

  await recordAuditEvent(req, {
    action: "expense.updated",
    entityType: "expense",
    entityId: expenseId,
    metadata: { previous: expense, next_status: body.payment_status, amount_total: body.amount_total, cost_center: body.cost_center },
  });
  return { ok: true };
}

export async function changeExpenseStatus(
  req: Request,
  expenseId: string,
  tenantId: number,
  body: {
    payment_status?: string;
    paid_at?: string | null;
    payment_method?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const expense = await findExpenseByIdInDb(expenseId, tenantId);
  if (!expense) return { ok: false, status: 404, error: "Gasto no encontrado" };
  if (body.payment_status === "paid" && expense.approval_status !== "approved") {
    return { ok: false, status: 400, error: "El gasto debe estar aprobado antes de pagarse" };
  }
  if (body.payment_status !== expense.payment_status && !body.notes?.trim()) {
    return { ok: false, status: 400, error: "Cambiar el estado de un gasto requiere nota operacional" };
  }

  const paidAt = body.paid_at || (body.payment_status === "paid" ? todayLocal() : null);
  await ensureFinanceDatesOpen([expense.date, expense.paid_at, expense.due_date, paidAt], tenantId);
  await updateExpenseStatusInDb(expenseId, tenantId, body, paidAt);

  await recordAuditEvent(req, {
    action: "expense.status_updated",
    entityType: "expense",
    entityId: expenseId,
    metadata: { previous_status: expense.payment_status, next_status: body.payment_status, note: body.notes || null },
  });
  return { ok: true };
}

export async function approveOrRejectExpense(
  req: Request,
  expenseId: string,
  tenantId: number,
  staffId: number,
  body: { approval_status?: "approved" | "rejected"; note?: string }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const expense = await findExpenseByIdInDb(expenseId, tenantId);
  if (!expense) return { ok: false, status: 404, error: "Gasto no encontrado" };
  if (expense.payment_status === "paid") return { ok: false, status: 400, error: "No se puede cambiar aprobacion de un gasto pagado" };

  await updateExpenseApprovalInDb(expenseId, tenantId, staffId, body.approval_status || "approved", body.note || "");

  await recordAuditEvent(req, {
    action: "expense.approval_updated",
    entityType: "expense",
    entityId: expenseId,
    metadata: {
      previous_status: expense.approval_status || "pending",
      next_status: body.approval_status,
      note: body.note,
      cost_center: expense.cost_center || "general",
      amount_total: expense.amount_total,
    },
  });
  return { ok: true };
}

export async function resolveExpenseReceiptDownload(
  expenseId: string,
  tenantId: number
): Promise<{ ok: true; absolutePath: string; fileName: string; mimeType: string } | { ok: false; status: number; error: string }> {
  const expense = await getExpenseReceiptMetadataFromDb(expenseId, tenantId);
  if (!expense) return { ok: false, status: 404, error: "Gasto no encontrado" };
  if (!expense.receipt_file_path) return { ok: false, status: 404, error: "Comprobante no encontrado" };

  try {
    const absolutePath = resolveStoredFile(expense.receipt_file_path);
    if (!existsSync(absolutePath)) return { ok: false, status: 404, error: "Archivo de comprobante no encontrado" };
    return {
      ok: true,
      absolutePath,
      fileName: expense.receipt_file_name || "comprobante-gasto",
      mimeType: expense.receipt_mime_type || "application/octet-stream",
    };
  } catch {
    return { ok: false, status: 400, error: "Ruta de comprobante inválida" };
  }
}

export async function getExpenseBankSuggestions(expenseId: string, tenantId: number) {
  const expense = await findExpenseByIdInDb(expenseId, tenantId);
  if (!expense) return null;

  const movements = await listOpenBankMovementsForExpenseSuggestionsFromDb(tenantId);
  const supplierTokens = String(expense.supplier_name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token: string) => token.length >= 4);

  const unlinkedMovements: typeof movements = [];
  for (const movement of movements) if (!await getExpenseByBankMovement(movement.id, tenantId)) unlinkedMovements.push(movement);
  const suggestions = unlinkedMovements
    .map(movement => {
      let score = 0;
      const reasons: string[] = [];
      const remaining = Number(movement.remaining_amount ?? movement.amount ?? 0);
      const amountDiff = Math.abs(remaining - Number(expense.amount_total || 0));
      if (amountDiff === 0) {
        score += 70;
        reasons.push("Monto exacto");
      } else if (amountDiff <= Math.max(1000, Number(expense.amount_total || 0) * 0.05)) {
        score += 25;
        reasons.push("Monto cercano");
      }
      const description = String(movement.description || "").toLowerCase();
      if (supplierTokens.some((token: string) => description.includes(token))) {
        score += 20;
        reasons.push("Proveedor en glosa");
      }
      if (normalizeRut(movement.rut) && normalizeRut(movement.rut) === normalizeRut(expense.supplier_rut)) {
        score += 20;
        reasons.push("RUT proveedor");
      }
      return { bank_movement_id: movement.id, movement, score: Math.min(score, 100), reasons };
    })
    .filter(suggestion => suggestion.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return { expense_id: expense.id, suggestions };
}

export async function reconcileExpenseWithBank(
  req: Request,
  expenseId: string,
  tenantId: number,
  body: { bank_movement_id?: number; note?: string }
) {
  const result = await reconcileExpenseWithBankInDb(expenseId, tenantId, Number(body.bank_movement_id), body.note || "");
  await recordAuditEvent(req, {
    action: "expense.reconciled",
    entityType: "expense",
    entityId: expenseId,
    metadata: result,
  });
  return result;
}

export async function listBudgets(month: string | undefined, tenantId: number) {
  const range = getMonthRange(month);
  const budgets = await listBudgetsByMonthFromDb(range.month, tenantId);
  return { month: range.month, budgets };
}

export async function upsertBudget(
  req: Request,
  tenantId: number,
  body: { month?: string; category?: string; planned_amount?: number; notes?: string | null }
) {
  await ensureFinanceMonthOpen(body.month || "", tenantId);
  const { budget, changes } = await upsertBudgetInDb(tenantId, body);
  await recordAuditEvent(req, {
    action: "financial_budget.upserted",
    entityType: "financial_budget",
    entityId: `${body.month}:${body.category}`,
    metadata: {
      month: body.month,
      category: body.category,
      planned_amount: body.planned_amount,
      notes: body.notes || null,
      changed_rows: changes,
    },
  });
  return budget;
}

export async function deleteBudget(
  req: Request,
  month: string,
  category: string,
  tenantId: number
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await findBudgetInDb(month, category, tenantId);
  if (!existing) return { ok: false, status: 404, error: "Presupuesto no encontrado" };
  try {
    await ensureFinanceMonthOpen(month, tenantId);
  } catch (e: any) {
    return { ok: false, status: 400, error: e.message };
  }

  await deleteBudgetInDb(month, category, tenantId);
  await recordAuditEvent(req, {
    action: "financial_budget.deleted",
    entityType: "financial_budget",
    entityId: `${month}:${category}`,
    metadata: existing,
  });
  return { ok: true };
}
