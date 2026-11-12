import { db } from "../../../db";
import type { PaginationParams } from "../../../pagination";
import {
  ensureFinanceDatesOpen,
  getExpenseByBankMovement,
  getMovementAllocatedAmount,
} from "../shared";

export function listExpensesFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status?: string;
  category?: string;
  due?: string;
  pagination: PaginationParams;
}) {
  const { tenantId, branchId, status, category, due, pagination } = params;
  const conditions: string[] = ["e.tenant_id = ?"];
  const sqlParams: any[] = [tenantId];
  if (branchId) {
    conditions.push("e.branch_id = ?");
    sqlParams.push(branchId);
  }
  if (status && status !== "all") {
    conditions.push("e.payment_status = ?");
    sqlParams.push(status);
  }
  if (category && category !== "all") {
    conditions.push("e.category = ?");
    sqlParams.push(category);
  }
  if (due === "overdue") {
    conditions.push("e.due_date IS NOT NULL AND e.due_date < date('now')");
  } else if (due === "today") {
    conditions.push("e.due_date = date('now')");
  } else if (due === "upcoming") {
    conditions.push("e.due_date IS NOT NULL AND e.due_date > date('now')");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = Number((db.prepare(`
    SELECT COUNT(*) as count
    FROM expenses e
    ${where}
  `).get(...sqlParams) as { count: number }).count || 0);
  let listQuery = `
    SELECT e.*, approved_by.name as approved_by_name, b.name as branch_name, b.code as branch_code
    FROM expenses e
    LEFT JOIN staff approved_by ON approved_by.id = e.approved_by_staff_id
    LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
    ${where}
    ORDER BY
      CASE
        WHEN e.payment_status = 'overdue' THEN 0
        WHEN e.payment_status = 'pending' AND e.due_date = date('now') THEN 1
        WHEN e.payment_status = 'pending' THEN 2
        ELSE 3
      END,
      e.due_date ASC,
      e.date DESC,
      e.id DESC
  `;
  const listParams = [...sqlParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const expenses = db.prepare(listQuery).all(...listParams);
  return { expenses, total };
}

export function insertExpenseInDb(
  tenantId: number,
  branchId: number | null,
  body: {
    date?: string;
    category?: string;
    cost_center?: string;
    supplier_name?: string;
    supplier_rut?: string | null;
    description?: string;
    amount_total?: number;
    document_type?: string;
    document_number?: string | null;
    payment_method?: string | null;
    payment_status?: string;
    paid_at?: string | null;
    due_date?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
  },
  amountNet: number,
  taxAmount: number,
  storedReceipt: { filePath: string; fileName: string; mimeType: string } | null
) {
  const result = db.prepare(`
    INSERT INTO expenses (
      date, category, branch_id, cost_center, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
      document_type, document_number, payment_method, payment_status, paid_at, due_date, bank_movement_id,
      receipt_file_path, receipt_file_name, receipt_mime_type, notes, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.date,
    body.category,
    branchId,
    body.cost_center ?? "general",
    body.supplier_name,
    body.supplier_rut || null,
    body.description,
    amountNet,
    taxAmount,
    body.amount_total,
    body.document_type ?? "invoice",
    body.document_number || null,
    body.payment_method || null,
    body.payment_status ?? "pending",
    body.paid_at || null,
    body.due_date || null,
    body.bank_movement_id || null,
    storedReceipt?.filePath || null,
    storedReceipt?.fileName || null,
    storedReceipt?.mimeType || null,
    body.notes || null,
    tenantId
  );
  return result.lastInsertRowid;
}

export function findExpenseByIdInDb(expenseId: string | number, tenantId: number) {
  return db.prepare("SELECT * FROM expenses WHERE id = ? AND tenant_id = ?").get(expenseId, tenantId) as any | undefined;
}

export function updateExpenseInDb(
  expenseId: string | number,
  tenantId: number,
  branchId: number | null,
  body: {
    date?: string;
    category?: string;
    cost_center?: string;
    supplier_name?: string;
    supplier_rut?: string | null;
    description?: string;
    amount_total?: number;
    document_type?: string;
    document_number?: string | null;
    payment_method?: string | null;
    payment_status?: string;
    due_date?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
  },
  amountNet: number,
  taxAmount: number,
  paidAt: string | null,
  storedReceipt: { filePath: string; fileName: string; mimeType: string } | null
) {
  db.prepare(`
    UPDATE expenses
    SET date = ?, category = ?, branch_id = ?, cost_center = ?, supplier_name = ?, supplier_rut = ?, description = ?,
        amount_net = ?, tax_amount = ?, amount_total = ?, document_type = ?, document_number = ?,
        payment_method = ?, payment_status = ?, paid_at = ?, due_date = ?, bank_movement_id = ?,
        receipt_file_path = COALESCE(?, receipt_file_path),
        receipt_file_name = COALESCE(?, receipt_file_name),
        receipt_mime_type = COALESCE(?, receipt_mime_type),
        notes = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    body.date,
    body.category,
    branchId,
    body.cost_center ?? "general",
    body.supplier_name,
    body.supplier_rut || null,
    body.description,
    amountNet,
    taxAmount,
    body.amount_total,
    body.document_type ?? "invoice",
    body.document_number || null,
    body.payment_method || null,
    body.payment_status ?? "pending",
    paidAt,
    body.due_date || null,
    body.bank_movement_id || null,
    storedReceipt?.filePath || null,
    storedReceipt?.fileName || null,
    storedReceipt?.mimeType || null,
    body.notes || null,
    expenseId,
    tenantId
  );
}

export function updateExpenseStatusInDb(
  expenseId: string | number,
  tenantId: number,
  body: {
    payment_status?: string;
    payment_method?: string | null;
    bank_movement_id?: number | null;
    notes?: string | null;
  },
  paidAt: string | null
) {
  db.prepare(`
    UPDATE expenses
    SET payment_status = ?,
        paid_at = ?,
        payment_method = COALESCE(?, payment_method),
        bank_movement_id = COALESCE(?, bank_movement_id),
        notes = COALESCE(?, notes)
    WHERE id = ? AND tenant_id = ?
  `).run(
    body.payment_status,
    paidAt,
    body.payment_method || null,
    body.bank_movement_id || null,
    body.notes || null,
    expenseId,
    tenantId
  );
}

export function updateExpenseApprovalInDb(
  expenseId: string | number,
  tenantId: number,
  staffId: number,
  approvalStatus: string,
  note: string
) {
  db.prepare(`
    UPDATE expenses
    SET approval_status = ?,
        approved_by_staff_id = ?,
        approved_at = CURRENT_TIMESTAMP,
        approval_note = ?
    WHERE id = ? AND tenant_id = ?
  `).run(approvalStatus, staffId, note, expenseId, tenantId);
}

export function getExpenseReceiptMetadataFromDb(expenseId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT receipt_file_path, receipt_file_name, receipt_mime_type
    FROM expenses
    WHERE id = ? AND tenant_id = ?
  `).get(expenseId, tenantId) as {
    receipt_file_path: string | null;
    receipt_file_name: string | null;
    receipt_mime_type: string | null;
  } | undefined;
}

export function listOpenBankMovementsForExpenseSuggestionsFromDb(tenantId: number) {
  return db.prepare(`
    SELECT bm.*,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
    FROM bank_movements bm
    LEFT JOIN (
      SELECT bank_movement_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY bank_movement_id
    ) pa ON pa.bank_movement_id = bm.id
    WHERE bm.tenant_id = ?
      AND bm.status IN ('pending', 'partial')
    ORDER BY bm.date DESC, bm.id DESC
  `).all(tenantId, tenantId) as any[];
}

export function reconcileExpenseWithBankInDb(
  expenseId: string | number,
  tenantId: number,
  bankMovementId: number,
  note: string
) {
  const transaction = db.transaction(() => {
    const expense = db.prepare("SELECT * FROM expenses WHERE id = ? AND tenant_id = ?").get(expenseId, tenantId) as any | undefined;
    if (!expense) throw new Error("Gasto no encontrado");
    if (expense.payment_status === "cancelled") throw new Error("El gasto está anulado");
    if (expense.approval_status !== "approved") throw new Error("El gasto debe estar aprobado antes de conciliarse");
    if (expense.bank_movement_id) throw new Error("El gasto ya tiene movimiento bancario vinculado");

    const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ? AND tenant_id = ?").get(bankMovementId, tenantId) as any | undefined;
    if (!movement) throw new Error("Movimiento bancario no encontrado");
    if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
    if (getMovementAllocatedAmount(movement.id, tenantId) > 0) throw new Error("El movimiento ya tiene abonos de ingresos asociados");
    if (getExpenseByBankMovement(movement.id, tenantId)) throw new Error("El movimiento ya está asociado a otro gasto");
    if (Number(movement.amount) !== Number(expense.amount_total)) throw new Error("El monto del movimiento no coincide con el gasto");

    const paidAt = movement.date || new Date().toISOString().slice(0, 10);
    ensureFinanceDatesOpen([expense.date, expense.paid_at, expense.due_date, movement.date, paidAt], tenantId);
    const nextNotes = note || expense.notes || `Conciliado con cartola bancaria #${movement.id}`;
    db.prepare(`
      UPDATE expenses
      SET payment_status = 'paid',
          paid_at = ?,
          payment_method = COALESCE(payment_method, 'transfer'),
          bank_movement_id = ?,
          notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(paidAt, movement.id, nextNotes, expense.id, tenantId);

    db.prepare(`
      UPDATE bank_movements
      SET status = 'reconciled',
          notes = COALESCE(?, notes)
      WHERE id = ? AND tenant_id = ?
    `).run(note || `Gasto #${expense.id} - ${expense.supplier_name}`, movement.id, tenantId);

    return {
      expenseId: Number(expense.id),
      bankMovementId: Number(movement.id),
      amount: Number(expense.amount_total),
      paidAt,
      note: note || null,
    };
  });

  return transaction();
}

export function listBudgetsByMonthFromDb(month: string, tenantId: number) {
  return db.prepare(`
    SELECT *
    FROM financial_budgets
    WHERE month = ? AND tenant_id = ?
    ORDER BY category ASC
  `).all(month, tenantId);
}

export function upsertBudgetInDb(
  tenantId: number,
  body: { month?: string; category?: string; planned_amount?: number; notes?: string | null }
) {
  const result = db.prepare(`
    INSERT INTO financial_budgets (month, category, planned_amount, notes, updated_at, tenant_id)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(tenant_id, month, category) DO UPDATE SET
      planned_amount = excluded.planned_amount,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `).run(body.month, body.category, body.planned_amount, body.notes || null, tenantId);

  const budget = db.prepare(`
    SELECT *
    FROM financial_budgets
    WHERE month = ? AND category = ? AND tenant_id = ?
  `).get(body.month, body.category, tenantId);

  return { budget, changes: result.changes };
}

export function findBudgetInDb(month: string, category: string, tenantId: number) {
  return db.prepare(`
    SELECT *
    FROM financial_budgets
    WHERE month = ? AND category = ? AND tenant_id = ?
  `).get(month, category, tenantId) as any | undefined;
}

export function deleteBudgetInDb(month: string, category: string, tenantId: number) {
  db.prepare("DELETE FROM financial_budgets WHERE month = ? AND category = ? AND tenant_id = ?").run(month, category, tenantId);
}

