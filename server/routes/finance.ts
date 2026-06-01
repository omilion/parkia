import type { Express } from "express";
import { existsSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { ensureUpcomingReceivables, refreshOverduePayments } from "../billing";
import { db } from "../db";
import { likeValue, paginatedResponse, parsePagination, queryText } from "../pagination";
import { getSiiReadiness, issueInvoiceWithConfiguredProvider, syncInvoiceWithConfiguredProvider } from "../sii";
import { resolveStoredFile, storeDocumentFile, storePaymentReceipt } from "../storage";
import { dateStringSchema, optionalTextSchema, parseBody } from "../validation";
import { sendXlsxTable, type XlsxColumn } from "../xlsx";

const registerPaymentSchema = z.object({
  method: z.enum(["cash", "transfer", "card", "automatic"]),
  payment_date: dateStringSchema.optional(),
  reference: optionalTextSchema,
  note: z.string().trim().min(3).max(500),
  receipt: z.object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    dataBase64: z.string().trim().min(1),
  }).optional(),
});

const paymentStatusQuerySchema = z.enum(["pending", "paid", "overdue", "cancelled"]).optional();
const bankMovementExportStatuses = ["pending", "reconciled", "partial"] as const;
type BankMovementExportStatus = typeof bankMovementExportStatuses[number];

function parseBankMovementExportStatuses(value: unknown): BankMovementExportStatus[] | null {
  const rawValues = Array.isArray(value) ? value : value ? [value] : [];
  const statuses = rawValues
    .flatMap(status => String(status).split(","))
    .map(status => status.trim())
    .filter(Boolean)
    .flatMap(status => status === "attention" ? ["pending", "partial"] : [status]);

  if (statuses.some(status => !bankMovementExportStatuses.includes(status as BankMovementExportStatus))) {
    return null;
  }

  return Array.from(new Set(statuses)) as BankMovementExportStatus[];
}

const paymentAdjustmentSchema = z.object({
  type: z.enum(["discount", "waiver", "fee"]),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(3).max(500),
});

const reconcileMovementSchema = z.object({
  payment_id: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(500),
});

const allocateMovementSchema = z.object({
  payment_id: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  note: z.string().trim().min(3).max(500),
});

const allocationHistoryQuerySchema = z.object({
  payment_id: z.coerce.number().int().positive().optional(),
  bank_movement_id: z.coerce.number().int().positive().optional(),
});

const reverseAllocationSchema = z.object({
  note: z.string().trim().min(3).max(500),
});

const createCollectionActionSchema = z.object({
  channel: z.enum(["phone", "email", "whatsapp", "in_person", "other"]),
  note: z.string().trim().min(3).max(1000),
  next_action_at: dateStringSchema.optional().nullable(),
});

const completeCollectionActionSchema = z.object({
  note: optionalTextSchema,
});

const collectionQueueQuerySchema = z.object({
  status: z.enum(["open", "done", "all"]).optional(),
  due: z.enum(["overdue", "today", "upcoming", "actionable", "all"]).optional(),
});

const expenseReceiptSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  dataBase64: z.string().trim().min(1),
}).optional();

const expenseSchema = z.object({
  date: dateStringSchema,
  category: z.enum(["rent", "maintenance", "utilities", "payroll", "supplies", "taxes", "admin", "other"]),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  cost_center: z.string().trim().min(1).max(80).default("general"),
  supplier_name: z.string().trim().min(1).max(160),
  supplier_rut: optionalTextSchema,
  description: z.string().trim().min(1).max(500),
  amount_net: z.coerce.number().min(0).optional(),
  tax_amount: z.coerce.number().min(0).optional(),
  amount_total: z.coerce.number().positive(),
  document_type: z.enum(["invoice", "receipt", "ticket", "internal", "none"]).default("invoice"),
  document_number: optionalTextSchema,
  payment_method: z.enum(["cash", "transfer", "card", "automatic", "other"]).optional().nullable(),
  payment_status: z.enum(["pending", "paid", "overdue", "cancelled"]).default("pending"),
  paid_at: dateStringSchema.optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  bank_movement_id: z.coerce.number().int().positive().optional().nullable(),
  notes: optionalTextSchema,
  receipt: expenseReceiptSchema,
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

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

const budgetCategorySchema = z.enum(["rent", "maintenance", "utilities", "payroll", "supplies", "taxes", "admin", "other"]);
const expenseCategories = budgetCategorySchema.options;

const financialBudgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  category: budgetCategorySchema,
  planned_amount: z.coerce.number().min(0),
  notes: optionalTextSchema,
});

const importBankMovementsSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  dataBase64: z.string().trim().min(1),
});

const updateBankMovementSchema = z.object({
  date: dateStringSchema.optional(),
  description: optionalTextSchema,
  rut: optionalTextSchema,
  amount: z.coerce.number().positive().optional(),
  notes: optionalTextSchema,
});

const markBankMovementPartialSchema = z.object({
  note: z.string().trim().min(3).max(500),
});

const closeMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  accepted_pending_note: optionalTextSchema,
});

const reopenMonthSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const paymentRemainingSql = "CASE WHEN p.status IN ('paid', 'cancelled') THEN 0 ELSE MAX(p.amount - COALESCE(pa.allocated_amount, 0), 0) END";

function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: unknown[][]) {
  return rows.map(row => row.map(escapeCsv).join(",")).join("\n");
}

const paymentStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};

const bankMovementStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  reconciled: "Conciliado",
};

const paymentMethodLabels: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  automatic: "Automático",
  other: "Otro",
};

const expenseCategoryLabels: Record<string, string> = {
  rent: "Arriendo",
  maintenance: "Mantención",
  utilities: "Servicios",
  payroll: "Sueldos",
  supplies: "Insumos",
  taxes: "Impuestos",
  admin: "Administración",
  other: "Otros",
};

const documentTypeLabels: Record<string, string> = {
  invoice: "Factura",
  receipt: "Recibo",
  ticket: "Boleta",
  internal: "Interno",
  none: "Sin documento",
};

const operationalStatusLabels: Record<string, string> = {
  ok: "Listo",
  warning: "Con observaciones",
  critical: "Bloqueado",
};

const operationalCheckLabels: Record<string, string> = {
  "bank-pending": "Cartola bancaria pendiente",
  "bank-partial": "Cartola bancaria parcial",
  "open-receivables": "Cuentas por cobrar abiertas al cierre",
  "manual-payments-without-receipt": "Pagos manuales sin comprobante",
  "open-expenses": "Gastos abiertos al cierre",
  "paid-expenses-without-receipt": "Gastos pagados sin respaldo",
  "expenses-without-due-date": "Gastos sin vencimiento",
  "collection-actions-overdue": "Seguimientos de cobranza vencidos",
};

const monthlyMetricLabels: Record<string, string> = {
  month: "Mes",
  cut_off_date: "Fecha de corte",
  generated_at: "Generado el",
  billed_total: "Total facturado",
  collected_total: "Total recaudado",
  overdue_total: "Total en mora",
  paid_expenses_total: "Gastos pagados",
  accrued_expenses_total: "Gastos devengados",
  pending_expenses_total: "Gastos pendientes",
  cash_margin: "Margen de caja",
  accrued_margin: "Margen devengado",
  budget_planned_total: "Presupuesto planificado",
  budget_actual_total: "Presupuesto ejecutado",
  budget_variance_total: "Diferencia presupuestaria",
  budget_execution_percent: "Ejecución presupuestaria (%)",
  cash_flow_opening_balance: "Saldo inicial proyectado",
  cash_flow_overdue_recovery_rate: "Tasa de recuperación de morosidad (%)",
  cash_flow_expected_inflow_total: "Ingresos esperados",
  cash_flow_overdue_nominal_inflow_total: "Mora nominal proyectada",
  cash_flow_overdue_recoverable_inflow_total: "Mora recuperable proyectada",
  cash_flow_scheduled_outflow_total: "Egresos programados",
  cash_flow_budget_reserve: "Reserva presupuestaria",
  cash_flow_projected_closing_balance: "Saldo final proyectado",
  cash_flow_minimum_projected_balance: "Saldo mínimo proyectado",
  bank_movements_total: "Movimientos bancarios totales",
  bank_movements_reconciled: "Movimientos conciliados",
  bank_movements_pending: "Movimientos pendientes",
  bank_movements_partial: "Movimientos parciales",
  receivables_aging_total: "Total cuentas por cobrar vencidas",
  payables_aging_total: "Total gastos por pagar vencidos",
};

function financeLabel(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key;
}

function csvFromColumns<T extends Record<string, any>>(columns: readonly (readonly [string, string])[], rows: T[], translate?: (key: string, value: unknown) => unknown) {
  return [
    columns.map(([label]) => label).join(","),
    ...rows.map((row) => columns.map(([, key]) => escapeCsv(translate ? translate(key, row[key]) : row[key])).join(",")),
  ].join("\n");
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === ";") && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseBankDate(value: string) {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function parseBankAmount(value: string) {
  const text = value.replace(/[$\s]/g, "");
  if (!text) return null;

  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(text)
      ? text.replace(/\./g, "")
      : text.replace(/,/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function parseBankMovementsCsv(dataBase64: string) {
  const csv = Buffer.from(dataBase64, "base64").toString("utf8").replace(/^\uFEFF/, "");
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("El archivo no tiene movimientos para importar");

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const findIndex = (names: string[]) => headers.findIndex(header => names.includes(header));
  const dateIndex = findIndex(["date", "fecha", "fechamovimiento"]);
  const descriptionIndex = findIndex(["description", "descripcion", "glosa", "detalle", "movimiento"]);
  const rutIndex = findIndex(["rut", "run", "rutcliente", "rutpagador"]);
  const amountIndex = findIndex(["amount", "monto", "abono", "deposito", "cargoabono"]);

  if ([dateIndex, descriptionIndex, rutIndex, amountIndex].some(index => index < 0)) {
    throw new Error("El CSV debe incluir columnas fecha, descripción, rut y monto");
  }

  const rows: { date: string, description: string, rut: string, amount: number }[] = [];
  const skippedRows: { row: number, reason: string }[] = [];

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const cells = parseCsvLine(line);
    const date = parseBankDate(cells[dateIndex] || "");
    const description = (cells[descriptionIndex] || "").trim();
    const rut = (cells[rutIndex] || "").trim();
    const amount = parseBankAmount(cells[amountIndex] || "");

    if (!date) {
      skippedRows.push({ row: rowNumber, reason: "Fecha inválida" });
    } else if (!description) {
      skippedRows.push({ row: rowNumber, reason: "Descripción vacía" });
    } else if (!rut) {
      skippedRows.push({ row: rowNumber, reason: "RUT vacío" });
    } else if (!amount) {
      skippedRows.push({ row: rowNumber, reason: "Monto inválido" });
    } else {
      rows.push({ date, description, rut, amount });
    }
  });

  return { rows, skippedRows };
}

function normalizeRut(value: string | null | undefined) {
  return String(value || "").replace(/[.\-\s]/g, "").toUpperCase();
}

function scoreMovementSuggestion(movement: any, payment: any) {
  let score = 0;
  const reasons: string[] = [];
  const movementAmount = Number(movement.remaining_amount ?? movement.amount ?? 0);
  const paymentAmount = Number(payment.remaining_amount ?? payment.amount ?? 0);
  const amountDiff = Math.abs(movementAmount - paymentAmount);

  if (amountDiff === 0) {
    score += 60;
    reasons.push("Monto exacto");
  } else if (amountDiff <= Math.max(1000, movementAmount * 0.05)) {
    score += 20;
    reasons.push("Monto cercano");
  }

  if (normalizeRut(movement.rut) && normalizeRut(movement.rut) === normalizeRut(payment.client_rut)) {
    score += 40;
    reasons.push("RUT coincidente");
  }

  const clientTokens = String(payment.client_name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token: string) => token.length >= 4);
  const description = String(movement.description || "").toLowerCase();
  if (clientTokens.some((token: string) => description.includes(token))) {
    score += 10;
    reasons.push("Nombre aparece en glosa");
  }

  return { score: Math.min(score, 100), reasons };
}

function markPaymentAsPaid(input: {
  paymentId: string | number,
  method: "cash" | "transfer" | "card" | "automatic",
  paymentDate: string,
  reference: string | null | undefined,
  receiptFilePath?: string | null,
  receiptFileName?: string | null,
  receiptMimeType?: string | null,
}) {
  const existingPayment = db.prepare("SELECT id, amount, status FROM payments WHERE id = ?").get(input.paymentId) as { id: number, amount: number, status: string } | undefined;
  if (!existingPayment) throw new Error("Pago no encontrado");
  if (existingPayment.status === "paid") throw new Error("El pago ya fue registrado");
  if (existingPayment.status === "cancelled") throw new Error("El pago está cancelado");
  ensureFinanceDateOpen(input.paymentDate);
  const allocatedAmount = getPaymentAllocatedAmount(input.paymentId);
  const paidAmount = Math.max(Number(existingPayment.amount || 0) - allocatedAmount, 0);

  db.prepare(`
    UPDATE payments
    SET status = 'paid',
        method = ?,
        payment_date = ?,
        reference = ?,
        receipt_file_path = ?,
        receipt_file_name = ?,
        receipt_mime_type = ?
    WHERE id = ?
  `).run(
    input.method,
    input.paymentDate,
    input.reference || null,
    input.receiptFilePath || null,
    input.receiptFileName || null,
    input.receiptMimeType || null,
    input.paymentId
  );

  const payment = db.prepare("SELECT contract_id FROM payments WHERE id = ?").get(input.paymentId) as { contract_id: number };
  const contract = db.prepare("SELECT client_id, billing_document_type FROM contracts WHERE id = ?").get(payment.contract_id) as { client_id: number, billing_document_type: string };
  if (!contract) throw new Error("Contrato asociado no encontrado");

  const overdueCount = db.prepare(`
    SELECT COUNT(*) as count FROM payments p
    JOIN contracts c ON p.contract_id = c.id
    WHERE c.client_id = ? AND p.status = 'overdue'
  `).get(contract.client_id) as { count: number };

  if (overdueCount.count === 0) {
    db.prepare("UPDATE clients SET financial_status = 'up-to-date' WHERE id = ?").run(contract.client_id);
    db.prepare("UPDATE contracts SET status = 'active' WHERE client_id = ? AND status = 'suspended'").run(contract.client_id);
  }

  const lastFolio = db.prepare("SELECT MAX(folio) as last FROM invoices").get() as { last: number };
  const nextFolio = (lastFolio.last || 449) + 1;
  const paidPayment = db.prepare("SELECT amount FROM payments WHERE id = ?").get(input.paymentId) as { amount: number };
  const invoice = db.prepare(`
    INSERT INTO invoices (
      folio, type, client_id, amount, status_sii, payment_id, contract_id,
      provider, provider_mode, status_detail, updated_at
    )
    VALUES (?, ?, ?, ?, 'pending', ?, ?, 'local_mock', 'mock', 'Preparado para emisión SII', datetime('now'))
  `).run(nextFolio, contract.billing_document_type || "boleta", contract.client_id, paidPayment.amount, input.paymentId, payment.contract_id);

  db.prepare(`
    INSERT INTO sii_events (invoice_id, provider, event_type, status, response_json)
    VALUES (?, 'local_mock', 'prepared', 'pending', ?)
  `).run(invoice.lastInsertRowid, JSON.stringify({ message: "Documento preparado desde pago registrado" }));

  return {
    folio: nextFolio,
    invoiceId: invoice.lastInsertRowid,
    type: contract.billing_document_type || "boleta",
    contractId: payment.contract_id,
    clientId: contract.client_id,
    amount: paidPayment.amount,
    paidAmount,
    allocatedAmount,
  };
}

function getPaymentAllocatedAmount(paymentId: string | number) {
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE payment_id = ? AND reversed_at IS NULL").get(paymentId) as { total: number };
  return Number(row.total || 0);
}

function getMovementAllocatedAmount(movementId: string | number) {
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payment_allocations WHERE bank_movement_id = ? AND reversed_at IS NULL").get(movementId) as { total: number };
  return Number(row.total || 0);
}

function getExpenseByBankMovement(movementId: string | number) {
  return db.prepare(`
    SELECT id, supplier_name, amount_total, payment_status
    FROM expenses
    WHERE bank_movement_id = ?
      AND payment_status != 'cancelled'
    LIMIT 1
  `).get(movementId) as { id: number, supplier_name: string, amount_total: number, payment_status: string } | undefined;
}

function recalculatePaymentStatus(paymentId: string | number) {
  const payment = db.prepare(`
    SELECT p.*, c.client_id
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id
    WHERE p.id = ?
  `).get(paymentId) as any | undefined;
  if (!payment || payment.status === "cancelled") return null;

  const allocatedAmount = getPaymentAllocatedAmount(payment.id);
  if (allocatedAmount >= Number(payment.amount)) {
    return { paymentId: payment.id, status: payment.status, allocatedAmount, remainingAmount: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const status = payment.due_date < today ? "overdue" : "pending";
  db.prepare(`
    UPDATE payments
    SET status = ?,
        method = NULL,
        payment_date = NULL,
        reference = NULL,
        receipt_file_path = NULL,
        receipt_file_name = NULL,
        receipt_mime_type = NULL
    WHERE id = ?
  `).run(status, payment.id);

  if (status === "overdue") {
    db.prepare("UPDATE clients SET financial_status = 'overdue' WHERE id = ?").run(payment.client_id);
  }

  return {
    paymentId: payment.id,
    status,
    allocatedAmount,
    remainingAmount: Math.max(Number(payment.amount) - allocatedAmount, 0),
  };
}

function recalculateMovementStatus(movementId: string | number) {
  const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementId) as any | undefined;
  if (!movement) return null;

  const allocatedAmount = getMovementAllocatedAmount(movement.id);
  const status = allocatedAmount <= 0
    ? "pending"
    : allocatedAmount >= Number(movement.amount)
      ? "reconciled"
      : "partial";

  db.prepare("UPDATE bank_movements SET status = ? WHERE id = ?").run(status, movement.id);
  return {
    movementId: movement.id,
    status,
    allocatedAmount,
    remainingAmount: Math.max(Number(movement.amount) - allocatedAmount, 0),
  };
}

function refreshOverdueExpenses() {
  db.prepare(`
    UPDATE expenses
    SET payment_status = 'overdue'
    WHERE payment_status = 'pending'
      AND due_date IS NOT NULL
      AND due_date < date('now')
  `).run();
}

function refreshFinanceState() {
  ensureUpcomingReceivables();
  refreshOverduePayments();
  refreshOverdueExpenses();
}

function parseBranchIdQuery(value: unknown) {
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function branchFilterSql(column: string, branchId: number | null) {
  return branchId ? ` AND ${column} = ?` : "";
}

function branchParams(branchId: number | null) {
  return branchId ? [branchId] : [];
}

function getVisitorCollectedTotal(whereSql = "", params: unknown[] = []) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM visitor_tickets
    WHERE amount > 0
      AND payment_method IS NOT NULL
      AND paid_at IS NOT NULL
      ${whereSql}
  `).get(...params) as { total: number };
  return Number(row.total || 0);
}

function getMonthRange(month?: string) {
  const selectedMonth = month || new Date().toISOString().slice(0, 7);
  const start = `${selectedMonth}-01`;
  const nextMonth = new Date(`${start}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const end = nextMonth.toISOString().slice(0, 10);
  return { month: selectedMonth, start, end };
}

function reportMeta(input: { cutOffDate?: string, formulas: Record<string, string> }) {
  return {
    generatedAt: new Date().toISOString(),
    cutOffDate: input.cutOffDate || new Date().toISOString().slice(0, 10),
    formulas: input.formulas,
  };
}

function parseJsonSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getMonthlyClosure(month: string) {
  const closure = db.prepare(`
    SELECT mfc.*,
           closed_by.name as closed_by_name,
           reopened_by.name as reopened_by_name
    FROM monthly_finance_closures mfc
    LEFT JOIN staff closed_by ON closed_by.id = mfc.closed_by_staff_id
    LEFT JOIN staff reopened_by ON reopened_by.id = mfc.reopened_by_staff_id
    WHERE mfc.month = ?
  `).get(month) as any | undefined;
  if (!closure) return null;

  return {
    ...closure,
    monthly_snapshot: parseJsonSnapshot(closure.monthly_snapshot_json),
    operational_snapshot: parseJsonSnapshot(closure.operational_snapshot_json),
    monthly_snapshot_json: undefined,
    operational_snapshot_json: undefined,
  };
}

function getClosedMonthlyClosure(month: string) {
  const closure = getMonthlyClosure(month);
  return closure?.status === "closed" ? closure : null;
}

function ensureFinanceMonthOpen(month: string) {
  const closure = getClosedMonthlyClosure(month);
  if (closure) {
    throw new Error(`El mes ${month} está cerrado. Reabre el cierre mensual antes de modificar finanzas de ese período.`);
  }
}

function ensureFinanceDateOpen(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}/.test(date)) return;
  ensureFinanceMonthOpen(date.slice(0, 7));
}

function ensureFinanceDatesOpen(...dates: Array<string | null | undefined>) {
  for (const date of dates) ensureFinanceDateOpen(date);
}

function createMonthlyCloseNotificationTask(month: string, operationalClose: any, staffId: number | null) {
  if (Number(operationalClose?.summary?.pendingItems || 0) <= 0) return null;

  const existing = db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'monthly_finance_close'
      AND source_id = ?
      AND status IN ('open', 'in_progress')
    LIMIT 1
  `).get(month) as { id: number } | undefined;
  if (existing) return existing.id;

  const priority = Number(operationalClose?.summary?.criticalCount || 0) > 0 ? "critical" : "high";
  const dueDate = addDays(new Date().toISOString().slice(0, 10), 1);
  const result = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, status, source_type, source_id, due_date, created_by_staff_id
    )
    VALUES (?, ?, 'finance', ?, 'open', 'monthly_finance_close', ?, ?, ?)
  `).run(
    `Resolver pendientes del cierre ${month}`,
    `${operationalClose.summary.pendingItems} pendiente(s) aceptado(s) en cierre mensual por $${Number(operationalClose.summary.pendingAmount || 0).toLocaleString()}.`,
    priority,
    month,
    dueDate,
    staffId,
  );
  return Number(result.lastInsertRowid);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function buildAgingSummary(table: "payments" | "expenses", amountColumn: string, dateColumn: string, statusColumn: string, openStatuses: string[]) {
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN julianday('now') - julianday(${dateColumn}) <= 30 THEN '0-30'
        WHEN julianday('now') - julianday(${dateColumn}) <= 60 THEN '31-60'
        WHEN julianday('now') - julianday(${dateColumn}) <= 90 THEN '61-90'
        ELSE '90+'
      END as bucket,
      COUNT(*) as count,
      SUM(${amountColumn}) as total
    FROM ${table}
    WHERE ${statusColumn} IN (${openStatuses.map(() => "?").join(",")})
      AND ${dateColumn} IS NOT NULL
      AND ${dateColumn} < date('now')
    GROUP BY bucket
  `).all(...openStatuses) as { bucket: string, count: number, total: number }[];

  const buckets = ["0-30", "31-60", "61-90", "90+"].map(bucket => {
    const row = rows.find(item => item.bucket === bucket);
    return { bucket, count: row?.count || 0, total: row?.total || 0 };
  });
  return {
    buckets,
    total: buckets.reduce((sum, bucket) => sum + Number(bucket.total || 0), 0),
    count: buckets.reduce((sum, bucket) => sum + Number(bucket.count || 0), 0),
  };
}

function buildBudgetReport(month?: string) {
  const range = getMonthRange(month);
  const budgets = db.prepare(`
    SELECT category, planned_amount, notes
    FROM financial_budgets
    WHERE month = ?
  `).all(range.month) as { category: string, planned_amount: number, notes: string | null }[];

  const actuals = db.prepare(`
    SELECT category, COALESCE(SUM(amount_total), 0) as actual_amount, COUNT(*) as count
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
    GROUP BY category
  `).all(range.start, range.end) as { category: string, actual_amount: number, count: number }[];

  const categories = Array.from(new Set([
    ...expenseCategories,
    ...budgets.map(row => row.category),
    ...actuals.map(row => row.category),
  ]));

  const rows = categories.map(category => {
    const budget = budgets.find(row => row.category === category);
    const actual = actuals.find(row => row.category === category);
    const plannedAmount = Number(budget?.planned_amount || 0);
    const actualAmount = Number(actual?.actual_amount || 0);
    return {
      category,
      plannedAmount,
      actualAmount,
      variance: plannedAmount - actualAmount,
      executionPercent: plannedAmount > 0 ? Math.round((actualAmount / plannedAmount) * 100) : null,
      count: actual?.count || 0,
      notes: budget?.notes || null,
    };
  });

  const plannedTotal = rows.reduce((sum, row) => sum + row.plannedAmount, 0);
  const actualTotal = rows.reduce((sum, row) => sum + row.actualAmount, 0);
  return {
    ...range,
    meta: reportMeta({
      cutOffDate: addDays(range.end, -1),
      formulas: {
        plannedTotal: "SUM(financial_budgets.planned_amount) del mes",
        actualTotal: "SUM(expenses.amount_total) donde date pertenece al mes y payment_status != cancelled",
        varianceTotal: "plannedTotal - actualTotal",
        executionPercent: "ROUND(actualTotal / plannedTotal * 100)",
      },
    }),
    plannedTotal,
    actualTotal,
    varianceTotal: plannedTotal - actualTotal,
    executionPercent: plannedTotal > 0 ? Math.round((actualTotal / plannedTotal) * 100) : null,
    rows: rows.sort((a, b) => b.actualAmount - a.actualAmount || b.plannedAmount - a.plannedAmount),
  };
}

function buildCashFlowProjection(month?: string) {
  refreshFinanceState();
  const range = getMonthRange(month);
  const budgetReport = buildBudgetReport(range.month);
  const config = db.prepare("SELECT overdue_recovery_rate FROM system_config WHERE id = 1").get() as { overdue_recovery_rate: number | null } | undefined;
  const overdueRecoveryRate = Math.min(Math.max(Number(config?.overdue_recovery_rate ?? 60), 0), 100);

  const openingIncome = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payments
    WHERE status = 'paid'
      AND payment_date < ?
  `).get(range.start) as { total: number };
  const openingVisitorIncome = getVisitorCollectedTotal("AND paid_at < ?", [range.start]);
  const openingExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at < ?
  `).get(range.start) as { total: number };
  const openingBalance = Number(openingIncome.total || 0) + openingVisitorIncome - Number(openingExpenses.total || 0);

  const scheduledInflows = db.prepare(`
    SELECT due_date as date,
           COALESCE(SUM(amount), 0) as nominal_total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount * ? / 100.0 ELSE amount END), 0) as total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0) as overdue_nominal_total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount * ? / 100.0 ELSE 0 END), 0) as overdue_recoverable_total,
           COUNT(*) as count
    FROM payments
    WHERE status IN ('pending', 'overdue')
      AND due_date < ?
    GROUP BY due_date
  `).all(overdueRecoveryRate, overdueRecoveryRate, range.end) as {
    date: string,
    nominal_total: number,
    total: number,
    overdue_nominal_total: number,
    overdue_recoverable_total: number,
    count: number,
  }[];

  const scheduledOutflows = db.prepare(`
    SELECT due_date as date, COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status IN ('pending', 'overdue')
      AND due_date IS NOT NULL
      AND due_date < ?
    GROUP BY due_date
  `).all(range.end) as { date: string, total: number, count: number }[];

  const budgetReserve = Math.max(Number(budgetReport.plannedTotal || 0) - Number(budgetReport.actualTotal || 0), 0);

  const buckets: Array<{
    start: string,
    end: string,
    expectedInflow: number,
    expectedInflowCount: number,
    scheduledOutflow: number,
    scheduledOutflowCount: number,
    budgetReserve: number,
    overdueNominalInflow: number,
    overdueRecoverableInflow: number,
    netFlow: number,
    projectedBalance: number,
  }> = [];
  let cursor = range.start;
  let balance = openingBalance;

  while (cursor < range.end) {
    const bucketStart = cursor;
    const bucketEnd = addDays(bucketStart, 7) < range.end ? addDays(bucketStart, 7) : range.end;
    const isFirstBucket = buckets.length === 0;
    const isLastBucket = bucketEnd === range.end;
    const inBucket = (date: string) => isFirstBucket
      ? date < bucketEnd
      : date >= bucketStart && date < bucketEnd;

    const inflows = scheduledInflows.filter(row => inBucket(row.date));
    const outflows = scheduledOutflows.filter(row => inBucket(row.date));
    const expectedInflow = inflows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const overdueNominalInflow = inflows.reduce((sum, row) => sum + Number(row.overdue_nominal_total || 0), 0);
    const overdueRecoverableInflow = inflows.reduce((sum, row) => sum + Number(row.overdue_recoverable_total || 0), 0);
    const scheduledOutflow = outflows.reduce((sum, row) => sum + Number(row.total || 0), 0);
    const reserve = isLastBucket ? budgetReserve : 0;
    const netFlow = expectedInflow - scheduledOutflow - reserve;
    balance += netFlow;

    buckets.push({
      start: bucketStart,
      end: addDays(bucketEnd, -1),
      expectedInflow,
      expectedInflowCount: inflows.reduce((sum, row) => sum + Number(row.count || 0), 0),
      scheduledOutflow,
      scheduledOutflowCount: outflows.reduce((sum, row) => sum + Number(row.count || 0), 0),
      budgetReserve: reserve,
      overdueNominalInflow,
      overdueRecoverableInflow,
      netFlow,
      projectedBalance: balance,
    });
    cursor = bucketEnd;
  }

  const expectedInflowTotal = buckets.reduce((sum, bucket) => sum + bucket.expectedInflow, 0);
  const overdueNominalInflowTotal = buckets.reduce((sum, bucket) => sum + bucket.overdueNominalInflow, 0);
  const overdueRecoverableInflowTotal = buckets.reduce((sum, bucket) => sum + bucket.overdueRecoverableInflow, 0);
  const scheduledOutflowProjectedTotal = buckets.reduce((sum, bucket) => sum + bucket.scheduledOutflow, 0);
  return {
    ...range,
    meta: reportMeta({
      cutOffDate: addDays(range.end, -1),
      formulas: {
        openingBalance: "SUM(payments paid antes del mes + visitor_tickets pagados) - SUM(expenses paid antes del mes)",
        expectedInflowTotal: "SUM(payments pending/overdue hasta fin de mes, aplicando tasa de recuperacion a vencidos)",
        scheduledOutflowTotal: "SUM(expenses pending/overdue con vencimiento antes de fin de mes)",
        budgetReserve: "MAX(plannedTotal - actualTotal, 0)",
        projectedClosingBalance: "openingBalance + expectedInflowTotal - scheduledOutflowTotal - budgetReserve",
      },
    }),
    overdueRecoveryRate,
    openingBalance,
    expectedInflowTotal,
    overdueNominalInflowTotal,
    overdueRecoverableInflowTotal,
    scheduledOutflowTotal: scheduledOutflowProjectedTotal,
    budgetReserve,
    projectedNetFlow: expectedInflowTotal - scheduledOutflowProjectedTotal - budgetReserve,
    projectedClosingBalance: balance,
    minimumProjectedBalance: buckets.reduce((min, bucket) => Math.min(min, bucket.projectedBalance), openingBalance),
    buckets,
  };
}

function buildMonthlyClose(month?: string) {
  refreshOverdueExpenses();
  const range = getMonthRange(month);
  const budgetReport = buildBudgetReport(range.month);
  const cashFlowProjection = buildCashFlowProjection(range.month);

  const collected = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
  `).get(range.start, range.end) as { total: number, count: number };

  const billed = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE due_date >= ?
      AND due_date < ?
      AND status != 'cancelled'
  `).get(range.start, range.end) as { total: number, count: number };

  const overdue = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE due_date < ?
      AND status = 'overdue'
  `).get(range.end) as { total: number, count: number };

  const paidExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at >= ?
      AND paid_at < ?
  `).get(range.start, range.end) as { total: number, count: number };

  const accruedExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
  `).get(range.start, range.end) as { total: number, count: number };

  const pendingExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status IN ('pending', 'overdue')
      AND due_date < ?
  `).get(range.end) as { total: number, count: number };

  const bank = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'reconciled' THEN 1 ELSE 0 END) as reconciled,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
  `).get(range.start, range.end) as { total: number, reconciled: number, pending: number, partial: number };

  const expensesByCategory = db.prepare(`
    SELECT category, COUNT(*) as count, SUM(amount_total) as total
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
    GROUP BY category
    ORDER BY total DESC
  `).all(range.start, range.end);

  const collectionsByMethod = db.prepare(`
    SELECT COALESCE(method, 'unknown') as method, COUNT(*) as count, SUM(amount) as total
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
    GROUP BY COALESCE(method, 'unknown')
    ORDER BY total DESC
  `).all(range.start, range.end);

  return {
    ...range,
    meta: reportMeta({
      cutOffDate: addDays(range.end, -1),
      formulas: {
        billedTotal: "SUM(payments.amount) con due_date dentro del mes y status != cancelled",
        collectedTotal: "SUM(payments.amount) con status paid y payment_date dentro del mes",
        paidExpensesTotal: "SUM(expenses.amount_total) con payment_status paid y paid_at dentro del mes",
        accruedExpensesTotal: "SUM(expenses.amount_total) con date dentro del mes y payment_status != cancelled",
        cashMargin: "collectedTotal - paidExpensesTotal",
        accruedMargin: "billedTotal - accruedExpensesTotal",
      },
    }),
    billedTotal: billed.total || 0,
    billedCount: billed.count || 0,
    collectedTotal: collected.total || 0,
    collectedCount: collected.count || 0,
    overdueTotal: overdue.total || 0,
    overdueCount: overdue.count || 0,
    paidExpensesTotal: paidExpenses.total || 0,
    paidExpensesCount: paidExpenses.count || 0,
    accruedExpensesTotal: accruedExpenses.total || 0,
    accruedExpensesCount: accruedExpenses.count || 0,
    pendingExpensesTotal: pendingExpenses.total || 0,
    pendingExpensesCount: pendingExpenses.count || 0,
    cashMargin: Number(collected.total || 0) - Number(paidExpenses.total || 0),
    accruedMargin: Number(billed.total || 0) - Number(accruedExpenses.total || 0),
    bankMovementsTotal: bank.total || 0,
    bankMovementsReconciled: bank.reconciled || 0,
    bankMovementsPending: bank.pending || 0,
    bankMovementsPartial: bank.partial || 0,
    collectionsByMethod,
    expensesByCategory,
    budgetPlannedTotal: budgetReport.plannedTotal,
    budgetActualTotal: budgetReport.actualTotal,
    budgetVarianceTotal: budgetReport.varianceTotal,
    budgetExecutionPercent: budgetReport.executionPercent,
    budgetByCategory: budgetReport.rows,
    cashFlowProjection,
    receivablesAging: buildAgingSummary("payments", "amount", "due_date", "status", ["pending", "overdue"]),
    payablesAging: buildAgingSummary("expenses", "amount_total", "due_date", "payment_status", ["pending", "overdue"]),
  };
}

type OperationalCloseStatus = "ok" | "warning" | "critical";

type OperationalCloseCheck = {
  id: string;
  label: string;
  status: OperationalCloseStatus;
  count: number;
  amount: number;
  message: string;
};

function buildOperationalClose(month?: string) {
  refreshOverdueExpenses();
  const range = getMonthRange(month);
  const monthlyClose = buildMonthlyClose(range.month);
  const metric = (sql: string, ...params: unknown[]) => db.prepare(sql).get(...params) as { count: number, amount: number };
  const makeCheck = (
    id: string,
    label: string,
    row: { count: number, amount: number },
    nonZeroStatus: Exclude<OperationalCloseStatus, "ok">,
    okMessage: string,
    pendingMessage: (count: number, amount: number) => string,
  ): OperationalCloseCheck => {
    const count = Number(row.count || 0);
    const amount = Number(row.amount || 0);
    return {
      id,
      label,
      status: count > 0 ? nonZeroStatus : "ok",
      count,
      amount,
      message: count > 0 ? pendingMessage(count, amount) : okMessage,
    };
  };

  const bankPending = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
      AND status = 'pending'
  `, range.start, range.end);

  const bankPartial = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
      AND status = 'partial'
  `, range.start, range.end);

  const openReceivables = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE due_date < ?
      AND status IN ('pending', 'overdue')
  `, range.end);

  const openExpenses = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE due_date IS NOT NULL
      AND due_date < ?
      AND payment_status IN ('pending', 'overdue')
  `, range.end);

  const manualPaymentsWithoutReceipt = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
      AND method IN ('cash', 'card')
      AND (receipt_file_path IS NULL OR receipt_file_path = '')
  `, range.start, range.end);

  const paidExpensesWithoutReceipt = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at >= ?
      AND paid_at < ?
      AND document_type IN ('invoice', 'receipt', 'ticket')
      AND (receipt_file_path IS NULL OR receipt_file_path = '')
  `, range.start, range.end);

  const expensesWithoutDueDate = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status IN ('pending', 'overdue')
      AND due_date IS NULL
  `, range.start, range.end);

  const overdueCollectionActions = metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(p.amount), 0) as amount
    FROM collection_actions ca
    JOIN payments p ON p.id = ca.payment_id
    WHERE ca.status = 'open'
      AND ca.next_action_at IS NOT NULL
      AND ca.next_action_at < ?
  `, range.end);

  const checks = [
    makeCheck(
      "bank-pending",
      "Movimientos bancarios sin conciliar",
      bankPending,
      "critical",
      "No hay movimientos pendientes en la cartola del mes.",
      (count, amount) => `${count} movimiento(s) por $${amount.toLocaleString()} siguen sin match.`,
    ),
    makeCheck(
      "bank-partial",
      "Movimientos bancarios parciales",
      bankPartial,
      "warning",
      "No hay movimientos parcialmente aplicados.",
      (count, amount) => `${count} movimiento(s) por $${amount.toLocaleString()} tienen saldo por resolver.`,
    ),
    makeCheck(
      "open-receivables",
      "Cuentas por cobrar abiertas al cierre",
      openReceivables,
      "critical",
      "No quedan cobros vencidos o abiertos antes del cierre.",
      (count, amount) => `${count} cobro(s) por $${amount.toLocaleString()} siguen abiertos antes del cierre.`,
    ),
    makeCheck(
      "open-expenses",
      "Gastos vencidos o abiertos al cierre",
      openExpenses,
      "critical",
      "No quedan gastos vencidos o abiertos antes del cierre.",
      (count, amount) => `${count} gasto(s) por $${amount.toLocaleString()} siguen abiertos antes del cierre.`,
    ),
    makeCheck(
      "manual-payments-without-receipt",
      "Pagos manuales sin respaldo",
      manualPaymentsWithoutReceipt,
      "warning",
      "Los pagos manuales del mes tienen respaldo adjunto.",
      (count, amount) => `${count} pago(s) manual(es) por $${amount.toLocaleString()} no tienen comprobante.`,
    ),
    makeCheck(
      "paid-expenses-without-receipt",
      "Gastos pagados sin respaldo",
      paidExpensesWithoutReceipt,
      "warning",
      "Los gastos pagados del mes tienen respaldo adjunto.",
      (count, amount) => `${count} gasto(s) pagado(s) por $${amount.toLocaleString()} no tienen comprobante.`,
    ),
    makeCheck(
      "expenses-without-due-date",
      "Gastos abiertos sin vencimiento",
      expensesWithoutDueDate,
      "warning",
      "Los gastos abiertos del mes tienen fecha de vencimiento.",
      (count, amount) => `${count} gasto(s) por $${amount.toLocaleString()} no tienen vencimiento para seguimiento.`,
    ),
    makeCheck(
      "collection-actions-overdue",
      "Gestiones de cobranza abiertas",
      overdueCollectionActions,
      "warning",
      "No hay gestiones de cobranza abiertas antes del cierre.",
      (count, amount) => `${count} gestion(es) por $${amount.toLocaleString()} siguen abiertas antes del cierre.`,
    ),
  ];

  const status = checks.some(check => check.status === "critical")
    ? "critical"
    : checks.some(check => check.status === "warning")
      ? "warning"
      : "ok";

  return {
    ...range,
    generatedAt: new Date().toISOString(),
    meta: reportMeta({
      cutOffDate: addDays(range.end, -1),
      formulas: {
        pendingItems: "SUM(check.count) de controles operacionales del cierre",
        pendingAmount: "SUM(check.amount) de controles operacionales del cierre",
        status: "critical si existe control critico pendiente; warning si existe advertencia; ok si no hay pendientes",
      },
    }),
    status,
    checks,
    summary: {
      criticalCount: checks.filter(check => check.status === "critical").length,
      warningCount: checks.filter(check => check.status === "warning").length,
      pendingItems: checks.reduce((sum, check) => sum + check.count, 0),
      pendingAmount: checks.reduce((sum, check) => sum + check.amount, 0),
      cashMargin: monthlyClose.cashMargin,
      projectedClosingBalance: monthlyClose.cashFlowProjection.projectedClosingBalance,
      bankMovementsPending: monthlyClose.bankMovementsPending,
      bankMovementsPartial: monthlyClose.bankMovementsPartial,
    },
  };
}

export function registerFinanceRoutes(app: Express) {
  app.use("/api/finance", requireAnyRole(["admin", "finance"]));

  // Finance API
  app.get("/api/finance/summary", (req, res) => {
    refreshFinanceState();
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const branchFilter = branchFilterSql("branch_id", branchId);
    const totalPending = db.prepare(`SELECT SUM(amount) as total FROM payments WHERE status = 'pending'${branchFilter}`).get(...branchParams(branchId)) as { total: number };
    const totalCollected = db.prepare(`SELECT SUM(amount) as total FROM payments WHERE status = 'paid'${branchFilter}`).get(...branchParams(branchId)) as { total: number };
    const visitorCollected = getVisitorCollectedTotal(branchFilterSql("branch_id", branchId), branchParams(branchId));
    const totalOverdue = db.prepare(`SELECT SUM(amount) as total FROM payments WHERE status = 'overdue'${branchFilter}`).get(...branchParams(branchId)) as { total: number };
    const overdueClientsCount = db.prepare(`SELECT COUNT(DISTINCT c.client_id) as count FROM payments p JOIN contracts c ON p.contract_id = c.id WHERE p.status = 'overdue'${branchFilterSql("p.branch_id", branchId)}`).get(...branchParams(branchId)) as { count: number };
    const pendingExpenses = db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE payment_status = 'pending'${branchFilter}`).get(...branchParams(branchId)) as { total: number };
    const overdueExpenses = db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE payment_status = 'overdue'${branchFilter}`).get(...branchParams(branchId)) as { total: number };

    res.json({
      totalPending: totalPending.total || 0,
      totalCollected: Number(totalCollected.total || 0) + visitorCollected,
      totalOverdue: totalOverdue.total || 0,
      overdueClientsCount: overdueClientsCount.count || 0,
      pendingExpenses: pendingExpenses.total || 0,
      overdueExpenses: overdueExpenses.total || 0,
      projectedCashBalance: Number(totalCollected.total || 0) + visitorCollected - Number(pendingExpenses.total || 0) - Number(overdueExpenses.total || 0),
    });
  });

  app.get("/api/finance/expenses", (req, res) => {
    refreshOverdueExpenses();
    const query = expenseQuerySchema.safeParse({
      status: req.query.status || undefined,
      category: req.query.category || undefined,
      due: req.query.due || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de gastos inválidos" });

    const branchId = parseBranchIdQuery(req.query.branch_id);
    const conditions: string[] = [];
    const params: any[] = [];
    if (branchId) {
      conditions.push("e.branch_id = ?");
      params.push(branchId);
    }
    if (query.data.status && query.data.status !== "all") {
      conditions.push("e.payment_status = ?");
      params.push(query.data.status);
    }
    if (query.data.category && query.data.category !== "all") {
      conditions.push("e.category = ?");
      params.push(query.data.category);
    }
    if (query.data.due === "overdue") {
      conditions.push("e.due_date IS NOT NULL AND e.due_date < date('now')");
    } else if (query.data.due === "today") {
      conditions.push("e.due_date = date('now')");
    } else if (query.data.due === "upcoming") {
      conditions.push("e.due_date IS NOT NULL AND e.due_date > date('now')");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const total = Number((db.prepare(`
      SELECT COUNT(*) as count
      FROM expenses e
      ${where}
    `).get(...params) as { count: number }).count || 0);
    let listQuery = `
      SELECT e.*, approved_by.name as approved_by_name, b.name as branch_name, b.code as branch_code
      FROM expenses e
      LEFT JOIN staff approved_by ON approved_by.id = e.approved_by_staff_id
      LEFT JOIN branches b ON b.id = e.branch_id
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
    const listParams = [...params];
    if (pagination.requested) {
      listQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const expenses = db.prepare(listQuery).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(expenses, total, pagination) : expenses);
  });

  app.post("/api/finance/expenses", (req, res) => {
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;

    try {
      if (body.payment_status === "paid" || body.bank_movement_id) {
        return res.status(400).json({ error: "El gasto debe aprobarse antes de marcarse pagado o asociarse a cartola" });
      }
      ensureFinanceDatesOpen(body.date, body.paid_at || null, body.due_date || null);
      const storedReceipt = body.receipt
        ? storeDocumentFile({ ...body.receipt, folder: "expense-receipts" })
        : null;
      const amountNet = body.amount_net ?? Math.max(Number(body.amount_total) - Number(body.tax_amount || 0), 0);
      const taxAmount = body.tax_amount ?? Math.max(Number(body.amount_total) - amountNet, 0);
      const result = db.prepare(`
        INSERT INTO expenses (
          date, category, branch_id, cost_center, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
          document_type, document_number, payment_method, payment_status, paid_at, due_date, bank_movement_id,
          receipt_file_path, receipt_file_name, receipt_mime_type, notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        body.date,
        body.category,
        body.branch_id || null,
        body.cost_center,
        body.supplier_name,
        body.supplier_rut || null,
        body.description,
        amountNet,
        taxAmount,
        body.amount_total,
        body.document_type,
        body.document_number || null,
        body.payment_method || null,
        body.payment_status,
        body.paid_at || null,
        body.due_date || null,
        body.bank_movement_id || null,
        storedReceipt?.filePath || null,
        storedReceipt?.fileName || null,
        storedReceipt?.mimeType || null,
        body.notes || null,
      );

      recordAuditEvent(req, {
        action: "expense.created",
        entityType: "expense",
        entityId: result.lastInsertRowid,
        metadata: {
          category: body.category,
          cost_center: body.cost_center,
          supplier_name: body.supplier_name,
          branch_id: body.branch_id || null,
          amount_total: body.amount_total,
          payment_status: body.payment_status,
          receipt_file_path: storedReceipt?.filePath || null,
        },
      });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/expenses/:id", (req, res) => {
    const body = parseBody(expenseSchema, req.body, res);
    if (!body) return;

    const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as any | undefined;
    if (!expense) return res.status(404).json({ error: "Gasto no encontrado" });

    try {
      if ((body.payment_status === "paid" || body.bank_movement_id) && expense.approval_status !== "approved") {
        return res.status(400).json({ error: "El gasto debe estar aprobado antes de pagarse o asociarse a cartola" });
      }
      if (body.payment_status !== expense.payment_status && !body.notes?.trim()) {
        return res.status(400).json({ error: "Cambiar el estado de un gasto requiere nota operacional" });
      }
      const paidAt = body.paid_at || (body.payment_status === "paid" ? new Date().toISOString().slice(0, 10) : null);
      ensureFinanceDatesOpen(expense.date, expense.paid_at, expense.due_date, body.date, paidAt, body.due_date || null);
      const storedReceipt = body.receipt
        ? storeDocumentFile({ ...body.receipt, folder: "expense-receipts" })
        : null;
      const amountNet = body.amount_net ?? Math.max(Number(body.amount_total) - Number(body.tax_amount || 0), 0);
      const taxAmount = body.tax_amount ?? Math.max(Number(body.amount_total) - amountNet, 0);

      db.prepare(`
        UPDATE expenses
        SET date = ?, category = ?, branch_id = ?, cost_center = ?, supplier_name = ?, supplier_rut = ?, description = ?,
            amount_net = ?, tax_amount = ?, amount_total = ?, document_type = ?, document_number = ?,
            payment_method = ?, payment_status = ?, paid_at = ?, due_date = ?, bank_movement_id = ?,
            receipt_file_path = COALESCE(?, receipt_file_path),
            receipt_file_name = COALESCE(?, receipt_file_name),
            receipt_mime_type = COALESCE(?, receipt_mime_type),
            notes = ?
        WHERE id = ?
      `).run(
        body.date,
        body.category,
        body.branch_id || null,
        body.cost_center,
        body.supplier_name,
        body.supplier_rut || null,
        body.description,
        amountNet,
        taxAmount,
        body.amount_total,
        body.document_type,
        body.document_number || null,
        body.payment_method || null,
        body.payment_status,
        paidAt,
        body.due_date || null,
        body.bank_movement_id || null,
        storedReceipt?.filePath || null,
        storedReceipt?.fileName || null,
        storedReceipt?.mimeType || null,
        body.notes || null,
        req.params.id,
      );

      recordAuditEvent(req, {
        action: "expense.updated",
        entityType: "expense",
        entityId: req.params.id,
        metadata: { previous: expense, next_status: body.payment_status, amount_total: body.amount_total, cost_center: body.cost_center },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/expenses/:id/status", (req, res) => {
    const body = parseBody(expenseStatusSchema, req.body, res);
    if (!body) return;

    const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as any | undefined;
    if (!expense) return res.status(404).json({ error: "Gasto no encontrado" });
    if (body.payment_status === "paid" && expense.approval_status !== "approved") {
      return res.status(400).json({ error: "El gasto debe estar aprobado antes de pagarse" });
    }
    if (body.payment_status !== expense.payment_status && !body.notes?.trim()) {
      return res.status(400).json({ error: "Cambiar el estado de un gasto requiere nota operacional" });
    }

    try {
      const paidAt = body.paid_at || (body.payment_status === "paid" ? new Date().toISOString().slice(0, 10) : null);
      ensureFinanceDatesOpen(expense.date, expense.paid_at, expense.due_date, paidAt);
      db.prepare(`
        UPDATE expenses
        SET payment_status = ?,
            paid_at = ?,
            payment_method = COALESCE(?, payment_method),
            bank_movement_id = COALESCE(?, bank_movement_id),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(
        body.payment_status,
        paidAt,
        body.payment_method || null,
        body.bank_movement_id || null,
        body.notes || null,
        req.params.id,
      );

      recordAuditEvent(req, {
        action: "expense.status_updated",
        entityType: "expense",
        entityId: req.params.id,
        metadata: { previous_status: expense.payment_status, next_status: body.payment_status, note: body.notes || null },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/expenses/:id/approval", (req, res) => {
    const user = getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administracion puede aprobar o rechazar gastos" });
    const body = parseBody(expenseApprovalSchema, req.body, res);
    if (!body) return;

    const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as any | undefined;
    if (!expense) return res.status(404).json({ error: "Gasto no encontrado" });
    if (expense.payment_status === "paid") return res.status(400).json({ error: "No se puede cambiar aprobacion de un gasto pagado" });

    db.prepare(`
      UPDATE expenses
      SET approval_status = ?,
          approved_by_staff_id = ?,
          approved_at = CURRENT_TIMESTAMP,
          approval_note = ?
      WHERE id = ?
    `).run(body.approval_status, user.id, body.note, req.params.id);

    recordAuditEvent(req, {
      action: "expense.approval_updated",
      entityType: "expense",
      entityId: req.params.id,
      metadata: {
        previous_status: expense.approval_status || "pending",
        next_status: body.approval_status,
        note: body.note,
        cost_center: expense.cost_center || "general",
        amount_total: expense.amount_total,
      },
    });
    res.json({ success: true });
  });

  app.get("/api/finance/expenses/:id/receipt", (req, res) => {
    const expense = db.prepare(`
      SELECT receipt_file_path, receipt_file_name, receipt_mime_type
      FROM expenses
      WHERE id = ?
    `).get(req.params.id) as {
      receipt_file_path: string | null,
      receipt_file_name: string | null,
      receipt_mime_type: string | null,
    } | undefined;

    if (!expense) return res.status(404).json({ error: "Gasto no encontrado" });
    if (!expense.receipt_file_path) return res.status(404).json({ error: "Comprobante no encontrado" });

    try {
      const absolutePath = resolveStoredFile(expense.receipt_file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Archivo de comprobante no encontrado" });
      res.type(expense.receipt_mime_type || "application/octet-stream");
      res.download(absolutePath, expense.receipt_file_name || "comprobante-gasto");
    } catch {
      res.status(400).json({ error: "Ruta de comprobante inválida" });
    }
  });

  app.get("/api/finance/expenses/:id/bank-suggestions", (req, res) => {
    const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(req.params.id) as any | undefined;
    if (!expense) return res.status(404).json({ error: "Gasto no encontrado" });

    const movements = db.prepare(`
      SELECT bm.*,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
      FROM bank_movements bm
      LEFT JOIN (
        SELECT bank_movement_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY bank_movement_id
      ) pa ON pa.bank_movement_id = bm.id
      WHERE bm.status IN ('pending', 'partial')
      ORDER BY bm.date DESC, bm.id DESC
    `).all() as any[];

    const supplierTokens = String(expense.supplier_name || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token: string) => token.length >= 4);

    const suggestions = movements
      .filter(movement => !getExpenseByBankMovement(movement.id))
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

    res.json({ expense_id: expense.id, suggestions });
  });

  app.post("/api/finance/expenses/:id/reconcile-bank", (req, res) => {
    const body = parseBody(reconcileExpenseSchema, req.body, res);
    if (!body) return;

    const expenseId = req.params.id;
    try {
      const transaction = db.transaction(() => {
        const expense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(expenseId) as any | undefined;
        if (!expense) throw new Error("Gasto no encontrado");
        if (expense.payment_status === "cancelled") throw new Error("El gasto está anulado");
        if (expense.approval_status !== "approved") throw new Error("El gasto debe estar aprobado antes de conciliarse");
        if (expense.bank_movement_id) throw new Error("El gasto ya tiene movimiento bancario vinculado");

        const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(body.bank_movement_id) as any | undefined;
        if (!movement) throw new Error("Movimiento bancario no encontrado");
        if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
        if (getMovementAllocatedAmount(movement.id) > 0) throw new Error("El movimiento ya tiene abonos de ingresos asociados");
        if (getExpenseByBankMovement(movement.id)) throw new Error("El movimiento ya está asociado a otro gasto");
        if (Number(movement.amount) !== Number(expense.amount_total)) throw new Error("El monto del movimiento no coincide con el gasto");

        const paidAt = movement.date || new Date().toISOString().slice(0, 10);
        ensureFinanceDatesOpen(expense.date, expense.paid_at, expense.due_date, movement.date, paidAt);
        const nextNotes = body.note || expense.notes || `Conciliado con cartola bancaria #${movement.id}`;
        db.prepare(`
          UPDATE expenses
          SET payment_status = 'paid',
              paid_at = ?,
              payment_method = COALESCE(payment_method, 'transfer'),
              bank_movement_id = ?,
              notes = ?
          WHERE id = ?
        `).run(paidAt, movement.id, nextNotes, expense.id);

        db.prepare(`
          UPDATE bank_movements
          SET status = 'reconciled',
              notes = COALESCE(?, notes)
          WHERE id = ?
        `).run(body.note || `Gasto #${expense.id} - ${expense.supplier_name}`, movement.id);

        return {
          expenseId: Number(expense.id),
          bankMovementId: Number(movement.id),
          amount: Number(expense.amount_total),
          paidAt,
          note: body.note || null,
        };
      });

      const result = transaction();
      recordAuditEvent(req, {
        action: "expense.reconciled",
        entityType: "expense",
        entityId: expenseId,
        metadata: result,
      });
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/budgets", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    const range = getMonthRange(query.data.month);
    const budgets = db.prepare(`
      SELECT *
      FROM financial_budgets
      WHERE month = ?
      ORDER BY category ASC
    `).all(range.month);
    res.json({ month: range.month, budgets });
  });

  app.post("/api/finance/budgets", (req, res) => {
    const body = parseBody(financialBudgetSchema, req.body, res);
    if (!body) return;

    try {
      ensureFinanceMonthOpen(body.month);
      const result = db.prepare(`
        INSERT INTO financial_budgets (month, category, planned_amount, notes, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(month, category) DO UPDATE SET
          planned_amount = excluded.planned_amount,
          notes = excluded.notes,
          updated_at = CURRENT_TIMESTAMP
      `).run(body.month, body.category, body.planned_amount, body.notes || null);

      const budget = db.prepare(`
        SELECT *
        FROM financial_budgets
        WHERE month = ? AND category = ?
      `).get(body.month, body.category);

      recordAuditEvent(req, {
        action: "financial_budget.upserted",
        entityType: "financial_budget",
        entityId: `${body.month}:${body.category}`,
        metadata: {
          month: body.month,
          category: body.category,
          planned_amount: body.planned_amount,
          notes: body.notes || null,
          changed_rows: result.changes,
        },
      });
      res.json({ success: true, budget });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/finance/budgets/:month/:category", (req, res) => {
    const params = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      category: budgetCategorySchema,
    }).safeParse(req.params);
    if (!params.success) return res.status(400).json({ error: "Presupuesto invÃ¡lido" });

    const existing = db.prepare(`
      SELECT *
      FROM financial_budgets
      WHERE month = ? AND category = ?
    `).get(params.data.month, params.data.category) as any | undefined;
    if (!existing) return res.status(404).json({ error: "Presupuesto no encontrado" });
    try {
      ensureFinanceMonthOpen(params.data.month);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    db.prepare("DELETE FROM financial_budgets WHERE month = ? AND category = ?").run(params.data.month, params.data.category);
    recordAuditEvent(req, {
      action: "financial_budget.deleted",
      entityType: "financial_budget",
      entityId: `${params.data.month}:${params.data.category}`,
      metadata: existing,
    });
    res.json({ success: true });
  });

  app.get("/api/finance/payments", (req, res) => {
    refreshFinanceState();
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const month = queryText(req.query.month);
    const monthField = queryText(req.query.monthField) || "any";
    const review = queryText(req.query.review);
    const cutOffDate = queryText(req.query.cutOffDate) || new Date().toISOString().slice(0, 10);
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (branchId) {
      where += " AND p.branch_id = ?";
      params.push(branchId);
    }
    if (status && status !== "all") {
      where += " AND p.status = ?";
      params.push(status);
    }
    if (search) {
      const like = likeValue(search);
      where += `
        AND (
          cl.name LIKE ? OR cl.rut LIKE ? OR CAST(p.id AS TEXT) LIKE ? OR CAST(c.id AS TEXT) LIKE ?
          OR COALESCE(p.due_date, '') LIKE ? OR COALESCE(p.payment_date, '') LIKE ? OR COALESCE(p.reference, '') LIKE ?
        )
      `;
      params.push(like, like, like, like, like, like, like);
    }
    if (month) {
      if (monthField === "due") {
        where += " AND COALESCE(p.due_date, '') LIKE ?";
        params.push(`${month}%`);
      } else if (monthField === "paid") {
        where += " AND COALESCE(p.payment_date, '') LIKE ?";
        params.push(`${month}%`);
      } else {
        where += " AND (COALESCE(p.due_date, '') LIKE ? OR COALESCE(p.payment_date, '') LIKE ?)";
        params.push(`${month}%`, `${month}%`);
      }
    }
    if (review === "open-to-close") {
      where += " AND p.due_date < ? AND p.status IN ('pending', 'overdue')";
      params.push(cutOffDate);
    } else if (review === "manual-without-receipt") {
      where += " AND p.status = 'paid' AND p.method IN ('cash', 'card') AND p.receipt_file_path IS NULL";
    }

    const fromSql = `
      FROM payments p
      JOIN contracts c ON p.contract_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) pa ON pa.payment_id = p.id
      LEFT JOIN (
        SELECT payment_id,
               SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_actions_count,
               MIN(CASE WHEN status = 'open' THEN next_action_at ELSE NULL END) as next_action_at,
               (
                 SELECT note
                 FROM collection_actions latest
                 WHERE latest.payment_id = collection_actions.payment_id
                 ORDER BY latest.created_at DESC, latest.id DESC
                 LIMIT 1
               ) as latest_note
        FROM collection_actions
        GROUP BY payment_id
      ) ca ON ca.payment_id = p.id
      ${where}
    `;
    const total = Number((db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...params) as { count: number }).count || 0);
    let listQuery = `
      SELECT p.*,
             cl.name as client_name,
             cl.rut as client_rut,
             c.id as contract_id_display,
             b.name as branch_name,
             b.code as branch_code,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             ${paymentRemainingSql} as remaining_amount,
             COALESCE(ca.open_actions_count, 0) as open_collection_actions_count,
             ca.next_action_at as next_collection_action_at,
             ca.latest_note as latest_collection_note
      ${fromSql}
      ORDER BY p.due_date DESC
    `;
    const listParams = [...params];
    if (pagination.requested) {
      listQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const payments = db.prepare(listQuery).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(payments, total, pagination) : payments);
  });

  app.get("/api/finance/payments/:id/detail", (req, res) => {
    refreshFinanceState();
    const payment = db.prepare(`
      SELECT p.*,
             cl.id as client_id,
             cl.name as client_name,
             cl.rut as client_rut,
             cl.email as client_email,
             cl.phone as client_phone,
             c.id as contract_id_display,
             c.start_date as contract_start_date,
             c.end_date as contract_end_date,
             c.monthly_fee,
             s.name as space_name,
             b.name as branch_name,
             b.code as branch_code,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             ${paymentRemainingSql} as remaining_amount
      FROM payments p
      JOIN contracts c ON p.contract_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN spaces s ON s.id = c.space_id
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) pa ON pa.payment_id = p.id
      WHERE p.id = ?
    `).get(req.params.id) as any | undefined;
    if (!payment) return res.status(404).json({ error: "Cuenta por cobrar no encontrada" });

    const adjustments = db.prepare(`
      SELECT a.*, s.name as staff_name, s.email as staff_email
      FROM payment_adjustments a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.payment_id = ?
      ORDER BY a.created_at DESC, a.id DESC
    `).all(req.params.id);

    const allocations = db.prepare(`
      SELECT pa.*, bm.date as movement_date, bm.description as movement_description, bm.rut as movement_rut, bm.amount as movement_amount
      FROM payment_allocations pa
      JOIN bank_movements bm ON bm.id = pa.bank_movement_id
      WHERE pa.payment_id = ?
      ORDER BY pa.created_at DESC, pa.id DESC
    `).all(req.params.id);

    const collectionActions = db.prepare(`
      SELECT ca.*, s.name as staff_name, s.email as staff_email
      FROM collection_actions ca
      LEFT JOIN staff s ON s.id = ca.staff_id
      WHERE ca.payment_id = ?
      ORDER BY ca.created_at DESC, ca.id DESC
    `).all(req.params.id);

    const invoices = db.prepare(`
      SELECT i.*
      FROM invoices i
      WHERE i.client_id = ? AND i.amount = ?
      ORDER BY i.date DESC, i.id DESC
      LIMIT 10
    `).all(payment.client_id, payment.amount);

    res.json({
      payment,
      adjustments,
      allocations,
      collectionActions,
      invoices,
      meta: reportMeta({
        cutOffDate: new Date().toISOString().slice(0, 10),
        formulas: {
          allocated_amount: "SUM(payment_allocations.amount) donde reversed_at IS NULL",
          remaining_amount: "0 si status paid/cancelled; si no, MAX(payment.amount - allocated_amount, 0)",
          status: "paid/cancelled manual o pendiente/vencido segun due_date y saldo",
        },
      }),
    });
  });

  app.post("/api/finance/payments/:id/adjustments", (req, res) => {
    const body = parseBody(paymentAdjustmentSchema, req.body, res);
    if (!body) return;
    const user = getCurrentUser(req);
    if (user?.role !== "admin") {
      return res.status(403).json({ error: "Solo administracion puede ajustar montos de cuentas por cobrar" });
    }

    try {
      const transaction = db.transaction(() => {
        const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id) as any | undefined;
        if (!payment) throw new Error("Cuenta por cobrar no encontrada");
        if (payment.status === "paid") throw new Error("No se puede ajustar una cuenta por cobrar pagada");
        if (payment.status === "cancelled") throw new Error("No se puede ajustar una cuenta por cobrar cancelada");
        ensureFinanceDateOpen(payment.due_date);

        const previousAmount = Number(payment.amount || 0);
        const signedAmount = body.type === "fee" ? Number(body.amount) : -Number(body.amount);
        const newAmount = Math.max(previousAmount + signedAmount, 0);
        const allocatedAmount = getPaymentAllocatedAmount(payment.id);
        if (newAmount < allocatedAmount) throw new Error("El ajuste no puede dejar el monto menor a los abonos ya aplicados");

        const today = new Date().toISOString().slice(0, 10);
        const nextStatus = newAmount === 0
          ? "cancelled"
          : allocatedAmount >= newAmount
            ? "paid"
            : payment.due_date < today ? "overdue" : "pending";

        db.prepare("UPDATE payments SET amount = ?, status = ? WHERE id = ?").run(newAmount, nextStatus, payment.id);
        const adjustment = db.prepare(`
          INSERT INTO payment_adjustments (payment_id, staff_id, type, amount, previous_amount, new_amount, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(payment.id, user?.id || null, body.type, body.amount, previousAmount, newAmount, body.reason);

        return {
          id: Number(adjustment.lastInsertRowid),
          paymentId: Number(payment.id),
          type: body.type,
          amount: Number(body.amount),
          previousAmount,
          newAmount,
          status: nextStatus,
          reason: body.reason,
        };
      });

      const result = transaction();
      recordAuditEvent(req, {
        action: "payment.adjusted",
        entityType: "payment",
        entityId: req.params.id,
        metadata: result,
      });
      res.json({ success: true, adjustment: result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/payments/:id/collection-actions", (req, res) => {
    const payment = db.prepare("SELECT id FROM payments WHERE id = ?").get(req.params.id);
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });

    const actions = db.prepare(`
      SELECT ca.*, s.name as staff_name, s.email as staff_email
      FROM collection_actions ca
      LEFT JOIN staff s ON s.id = ca.staff_id
      WHERE ca.payment_id = ?
      ORDER BY CASE ca.status WHEN 'open' THEN 0 ELSE 1 END, ca.created_at DESC, ca.id DESC
    `).all(req.params.id);
    res.json(actions);
  });

  app.post("/api/finance/payments/:id/collection-actions", (req, res) => {
    const body = parseBody(createCollectionActionSchema, req.body, res);
    if (!body) return;

    const payment = db.prepare("SELECT id, status FROM payments WHERE id = ?").get(req.params.id) as { id: number, status: string } | undefined;
    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });
    if (payment.status === "paid" || payment.status === "cancelled") {
      return res.status(400).json({ error: "Solo se puede gestionar cobranza de pagos pendientes o atrasados" });
    }

    const user = getCurrentUser(req);
    const result = db.prepare(`
      INSERT INTO collection_actions (payment_id, staff_id, channel, note, next_action_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(payment.id, user?.id || null, body.channel, body.note, body.next_action_at || null);

    recordAuditEvent(req, {
      action: "collection_action.created",
      entityType: "payment",
      entityId: payment.id,
      metadata: {
        collection_action_id: result.lastInsertRowid,
        channel: body.channel,
        next_action_at: body.next_action_at || null,
      },
    });
    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.get("/api/finance/collection-actions", (req, res) => {
    const query = collectionQueueQuerySchema.safeParse({
      status: req.query.status || undefined,
      due: req.query.due || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de cobranza inválidos" });

    const status = query.data.status || "open";
    const due = query.data.due || "all";
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (branchId) {
      conditions.push("p.branch_id = ?");
      params.push(branchId);
    }

    if (status !== "all") {
      conditions.push("ca.status = ?");
      params.push(status);
    }
    if (due === "overdue") {
      conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at < date('now')");
    } else if (due === "today") {
      conditions.push("ca.next_action_at = date('now')");
    } else if (due === "actionable") {
      conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at <= date('now')");
    } else if (due === "upcoming") {
      conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at > date('now')");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const actions = db.prepare(`
      SELECT ca.*,
             s.name as staff_name,
             s.email as staff_email,
             p.amount as payment_amount,
             p.branch_id,
             b.name as branch_name,
             b.code as branch_code,
             p.due_date as payment_due_date,
             p.status as payment_status,
             ${paymentRemainingSql} as payment_remaining_amount,
             c.id as contract_id_display,
             cl.name as client_name,
             cl.rut as client_rut,
             cl.email as client_email,
             cl.phone as client_phone
      FROM collection_actions ca
      JOIN payments p ON p.id = ca.payment_id
      JOIN contracts c ON c.id = p.contract_id
      JOIN clients cl ON cl.id = c.client_id
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN staff s ON s.id = ca.staff_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) pa ON pa.payment_id = p.id
      ${where}
      ORDER BY
        CASE
          WHEN ca.status = 'open' AND ca.next_action_at IS NOT NULL AND ca.next_action_at < date('now') THEN 0
          WHEN ca.status = 'open' AND ca.next_action_at = date('now') THEN 1
          WHEN ca.status = 'open' THEN 2
          ELSE 3
        END,
        ca.next_action_at ASC,
        ca.created_at DESC,
        ca.id DESC
    `).all(...params);

    res.json(actions);
  });

  app.post("/api/finance/collection-actions/:id/complete", (req, res) => {
    const body = parseBody(completeCollectionActionSchema, req.body, res);
    if (!body) return;

    const action = db.prepare("SELECT * FROM collection_actions WHERE id = ?").get(req.params.id) as any | undefined;
    if (!action) return res.status(404).json({ error: "Gestión de cobranza no encontrada" });
    if (action.status === "done") return res.status(400).json({ error: "La gestión ya está cerrada" });

    db.prepare(`
      UPDATE collection_actions
      SET status = 'done',
          completed_at = CURRENT_TIMESTAMP,
          completed_note = ?
      WHERE id = ?
    `).run(body.note || null, req.params.id);

    recordAuditEvent(req, {
      action: "collection_action.completed",
      entityType: "collection_action",
      entityId: req.params.id,
      metadata: {
        payment_id: action.payment_id,
        note: body.note || null,
      },
    });
    res.json({ success: true });
  });

  app.get("/api/finance/payment-allocations", (req, res) => {
    const query = allocationHistoryQuerySchema.safeParse({
      payment_id: req.query.payment_id,
      bank_movement_id: req.query.bank_movement_id,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de historial inválidos" });

    const conditions: string[] = [];
    const params: Array<number> = [];
    if (query.data.payment_id) {
      conditions.push("pa.payment_id = ?");
      params.push(query.data.payment_id);
    }
    if (query.data.bank_movement_id) {
      conditions.push("pa.bank_movement_id = ?");
      params.push(query.data.bank_movement_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const allocations = db.prepare(`
      SELECT pa.*,
             p.amount as payment_amount,
             p.due_date as payment_due_date,
             p.status as payment_status,
             cl.name as client_name,
             cl.rut as client_rut,
             c.id as contract_id_display,
             bm.date as movement_date,
             bm.description as movement_description,
             bm.rut as movement_rut,
             bm.amount as movement_amount,
             bm.status as movement_status
      FROM payment_allocations pa
      JOIN payments p ON pa.payment_id = p.id
      JOIN contracts c ON p.contract_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      JOIN bank_movements bm ON pa.bank_movement_id = bm.id
      ${where}
      ORDER BY pa.created_at DESC, pa.id DESC
    `).all(...params);

    res.json(allocations);
  });

  app.post("/api/finance/payment-allocations/:id/reverse", (req, res) => {
    const user = getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede reversar abonos" });

    const body = parseBody(reverseAllocationSchema, req.body, res);
    if (!body) return;

    const allocationId = req.params.id;
    try {
      const transaction = db.transaction(() => {
        const allocation = db.prepare(`
          SELECT pa.*, p.amount as payment_amount, p.payment_date as payment_date, bm.amount as movement_amount, bm.date as movement_date
          FROM payment_allocations pa
          JOIN payments p ON p.id = pa.payment_id
          JOIN bank_movements bm ON bm.id = pa.bank_movement_id
          WHERE pa.id = ?
        `).get(allocationId) as any | undefined;
        if (!allocation) throw new Error("Abono no encontrado");
        if (allocation.reversed_at) throw new Error("El abono ya fue reversado");
        ensureFinanceDatesOpen(allocation.payment_date, allocation.movement_date);

        db.prepare(`
          UPDATE payment_allocations
          SET reversed_at = CURRENT_TIMESTAMP,
              reversed_note = ?
          WHERE id = ?
        `).run(body.note, allocationId);

        const payment = recalculatePaymentStatus(allocation.payment_id);
        const movement = recalculateMovementStatus(allocation.bank_movement_id);

        return {
          allocationId: Number(allocation.id),
          paymentId: Number(allocation.payment_id),
          bankMovementId: Number(allocation.bank_movement_id),
          amount: Number(allocation.amount),
          note: body.note,
          payment,
          movement,
        };
      });

      const result = transaction();
      recordAuditEvent(req, {
        action: "payment_allocation.reversed",
        entityType: "payment_allocation",
        entityId: allocationId,
        metadata: result,
      });
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/reports/collections", (req, res) => {
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const byMethod = db.prepare(`
      SELECT COALESCE(method, 'unknown') as method, COUNT(*) as count, SUM(amount) as total
      FROM (
        SELECT method, amount
        FROM payments
        WHERE status = 'paid'
          ${branchFilterSql("branch_id", branchId)}
        UNION ALL
        SELECT payment_method as method, amount
        FROM visitor_tickets
        WHERE amount > 0
          AND payment_method IS NOT NULL
          AND paid_at IS NOT NULL
          ${branchFilterSql("branch_id", branchId)}
      )
      GROUP BY COALESCE(method, 'unknown')
      ORDER BY total DESC
    `).all(...branchParams(branchId), ...branchParams(branchId));

    const daily = db.prepare(`
      SELECT date, COUNT(*) as count, SUM(amount) as total
      FROM (
        SELECT substr(payment_date, 1, 10) as date, amount
        FROM payments
        WHERE status = 'paid' AND payment_date IS NOT NULL
          ${branchFilterSql("branch_id", branchId)}
        UNION ALL
        SELECT substr(paid_at, 1, 10) as date, amount
        FROM visitor_tickets
        WHERE amount > 0
          AND payment_method IS NOT NULL
          AND paid_at IS NOT NULL
          ${branchFilterSql("branch_id", branchId)}
      )
      GROUP BY date
      ORDER BY date DESC
      LIMIT 30
    `).all(...branchParams(branchId), ...branchParams(branchId));

    const totals = db.prepare(`
      SELECT COUNT(*) as count, SUM(amount) as total
      FROM (
        SELECT amount
        FROM payments
        WHERE status = 'paid'
          ${branchFilterSql("branch_id", branchId)}
        UNION ALL
        SELECT amount
        FROM visitor_tickets
        WHERE amount > 0
          AND payment_method IS NOT NULL
          AND paid_at IS NOT NULL
          ${branchFilterSql("branch_id", branchId)}
      )
    `).get(...branchParams(branchId), ...branchParams(branchId)) as { count: number, total: number | null };

    res.json({
      meta: reportMeta({
        formulas: {
          totalCollected: "SUM(payments.amount donde status = paid + visitor_tickets.amount pagados)",
          paidPaymentsCount: "COUNT(payments paid + visitor_tickets pagados)",
          byMethod: "GROUP BY metodo de pagos contractuales y tickets de visita",
        },
      }),
      totalCollected: totals.total || 0,
      paidPaymentsCount: totals.count || 0,
      byMethod,
      daily,
    });
  });

  app.get("/api/finance/reports/delinquency", (req, res) => {
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const rows = db.prepare(`
      SELECT cl.id as client_id,
             cl.name as client_name,
             cl.rut as client_rut,
             COUNT(p.id) as overdue_count,
             SUM(p.amount) as overdue_total,
             MIN(p.due_date) as oldest_due_date
      FROM payments p
      JOIN contracts c ON p.contract_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      WHERE p.status = 'overdue'
        ${branchFilterSql("p.branch_id", branchId)}
      GROUP BY cl.id, cl.name, cl.rut
      ORDER BY overdue_total DESC
    `).all(...branchParams(branchId));

    const total = rows.reduce((sum: number, row: any) => sum + Number(row.overdue_total || 0), 0);
    res.json({
      meta: reportMeta({
        formulas: {
          totalOverdue: "SUM(payments.amount) donde status = overdue",
          clientsCount: "COUNT(DISTINCT client_id) con pagos vencidos",
          oldest_due_date: "MIN(payments.due_date) por cliente",
        },
      }),
      totalOverdue: total,
      clientsCount: rows.length,
      rows,
    });
  });

  app.get("/api/finance/reports/profitability", (req, res) => {
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const collected = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'paid'${branchFilterSql("branch_id", branchId)}`).get(...branchParams(branchId)) as { total: number };
    const visitorCollected = getVisitorCollectedTotal(branchFilterSql("branch_id", branchId), branchParams(branchId));
    const paidExpenses = db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE payment_status = 'paid'${branchFilterSql("branch_id", branchId)}`).get(...branchParams(branchId)) as { total: number };
    const pendingExpenses = db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE payment_status IN ('pending', 'overdue')${branchFilterSql("branch_id", branchId)}`).get(...branchParams(branchId)) as { total: number };
    const byCategory = db.prepare(`
      SELECT category, COUNT(*) as count, SUM(amount_total) as total
      FROM expenses
      WHERE payment_status != 'cancelled'
        ${branchFilterSql("branch_id", branchId)}
      GROUP BY category
      ORDER BY total DESC
    `).all(...branchParams(branchId));

    res.json({
      meta: reportMeta({
        formulas: {
          totalCollected: "SUM(payments.amount donde status = paid + visitor_tickets.amount pagados)",
          totalPaidExpenses: "SUM(expenses.amount_total) donde payment_status = paid",
          totalPendingExpenses: "SUM(expenses.amount_total) donde payment_status IN pending/overdue",
          netMargin: "totalCollected - totalPaidExpenses",
          byCategory: "SUM(expenses.amount_total) GROUP BY category donde payment_status != cancelled",
        },
      }),
      totalCollected: Number(collected.total || 0) + visitorCollected,
      totalPaidExpenses: paidExpenses.total || 0,
      totalPendingExpenses: pendingExpenses.total || 0,
      netMargin: Number(collected.total || 0) + visitorCollected - Number(paidExpenses.total || 0),
      byCategory,
    });
  });

  app.get("/api/finance/reports/budget", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(buildBudgetReport(query.data.month));
  });

  app.get("/api/finance/reports/cash-flow", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes invÃ¡lido" });
    res.json(buildCashFlowProjection(query.data.month));
  });

  app.get("/api/finance/reports/monthly-close", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(buildMonthlyClose(query.data.month));
  });

  app.get("/api/finance/reports/operational-close", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    res.json(buildOperationalClose(query.data.month));
  });

  app.get("/api/finance/monthly-closures", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });

    if (query.data.month) {
      return res.json({ closure: getMonthlyClosure(query.data.month) });
    }

    const closures = db.prepare(`
      SELECT mfc.id, mfc.month, mfc.status, mfc.closed_at, mfc.accepted_pending_note,
             mfc.reopened_at, mfc.reopened_reason, closed_by.name as closed_by_name,
             reopened_by.name as reopened_by_name
      FROM monthly_finance_closures mfc
      LEFT JOIN staff closed_by ON closed_by.id = mfc.closed_by_staff_id
      LEFT JOIN staff reopened_by ON reopened_by.id = mfc.reopened_by_staff_id
      ORDER BY mfc.month DESC
      LIMIT 24
    `).all();
    res.json({ closures });
  });

  app.post("/api/finance/monthly-closures", (req, res) => {
    const user = getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede cerrar meses financieros" });

    const body = parseBody(closeMonthSchema, req.body, res);
    if (!body) return;

    const existing = getMonthlyClosure(body.month);
    if (existing?.status === "closed") return res.status(400).json({ error: `El mes ${body.month} ya está cerrado` });

    const monthlyClose = buildMonthlyClose(body.month);
    const operationalClose = buildOperationalClose(body.month);
    if (Number(operationalClose.summary.pendingItems || 0) > 0 && !body.accepted_pending_note) {
      return res.status(400).json({ error: "Debes dejar una nota para aceptar pendientes en el cierre" });
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO monthly_finance_closures (
          month, status, closed_by_staff_id, closed_at, accepted_pending_note,
          monthly_snapshot_json, operational_snapshot_json, reopened_by_staff_id,
          reopened_at, reopened_reason, updated_at
        )
        VALUES (?, 'closed', ?, CURRENT_TIMESTAMP, ?, ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT(month) DO UPDATE SET
          status = 'closed',
          closed_by_staff_id = excluded.closed_by_staff_id,
          closed_at = CURRENT_TIMESTAMP,
          accepted_pending_note = excluded.accepted_pending_note,
          monthly_snapshot_json = excluded.monthly_snapshot_json,
          operational_snapshot_json = excluded.operational_snapshot_json,
          reopened_by_staff_id = NULL,
          reopened_at = NULL,
          reopened_reason = NULL,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        body.month,
        user.id,
        body.accepted_pending_note || null,
        JSON.stringify(monthlyClose),
        JSON.stringify(operationalClose),
      );

      return createMonthlyCloseNotificationTask(body.month, operationalClose, user.id);
    });

    const notificationTaskId = transaction();
    recordAuditEvent(req, {
      action: "finance_month.closed",
      entityType: "monthly_finance_closure",
      entityId: body.month,
      metadata: {
        month: body.month,
        accepted_pending_note: body.accepted_pending_note || null,
        operational_status: operationalClose.status,
        pending_items: operationalClose.summary.pendingItems,
        pending_amount: operationalClose.summary.pendingAmount,
        notification_task_id: notificationTaskId,
      },
    });

    res.json({ success: true, closure: getMonthlyClosure(body.month), notificationTaskId });
  });

  app.post("/api/finance/monthly-closures/:month/reopen", (req, res) => {
    const user = getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede reabrir meses financieros" });

    const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(req.params.month);
    if (!month.success) return res.status(400).json({ error: "Mes inválido" });
    const body = parseBody(reopenMonthSchema, req.body, res);
    if (!body) return;

    const closure = getMonthlyClosure(month.data);
    if (!closure || closure.status !== "closed") return res.status(400).json({ error: `El mes ${month.data} no está cerrado` });

    db.prepare(`
      UPDATE monthly_finance_closures
      SET status = 'reopened',
          reopened_by_staff_id = ?,
          reopened_at = CURRENT_TIMESTAMP,
          reopened_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE month = ?
    `).run(user.id, body.reason, month.data);

    const taskResult = db.prepare(`
      INSERT INTO operational_tasks (
        title, description, category, priority, status, source_type, source_id, due_date, created_by_staff_id
      )
      VALUES (?, ?, 'finance', 'high', 'open', 'monthly_finance_reopen', ?, ?, ?)
    `).run(
      `Revisar mes reabierto ${month.data}`,
      `El cierre financiero ${month.data} fue reabierto. Motivo: ${body.reason}`,
      month.data,
      addDays(new Date().toISOString().slice(0, 10), 1),
      user.id,
    );

    recordAuditEvent(req, {
      action: "finance_month.reopened",
      entityType: "monthly_finance_closure",
      entityId: month.data,
      metadata: {
        month: month.data,
        reason: body.reason,
        notification_task_id: Number(taskResult.lastInsertRowid),
      },
    });

    res.json({ success: true, closure: getMonthlyClosure(month.data), notificationTaskId: Number(taskResult.lastInsertRowid) });
  });

  app.get("/api/finance/export/operational-close.csv", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const close = buildOperationalClose(query.data.month);
    const rows = [
      ["Ítem", "Estado", "Cantidad", "Monto", "Mensaje"],
      ["Mes", financeLabel(operationalStatusLabels, close.status), "", "", close.month],
      ["Fecha de corte", financeLabel(operationalStatusLabels, close.status), "", "", close.meta.cutOffDate],
      ["Generado el", financeLabel(operationalStatusLabels, close.status), "", "", close.generatedAt],
      ["Controles críticos", financeLabel(operationalStatusLabels, close.status), close.summary.criticalCount, "", ""],
      ["Controles con observación", financeLabel(operationalStatusLabels, close.status), close.summary.warningCount, "", ""],
      ["Pendientes totales", financeLabel(operationalStatusLabels, close.status), close.summary.pendingItems, close.summary.pendingAmount, ""],
      ...close.checks.map(check => [
        financeLabel(operationalCheckLabels, check.id),
        financeLabel(operationalStatusLabels, check.status),
        check.count,
        check.amount,
        check.message,
      ]),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="checklist-operacional-${close.month}.csv"`);
    res.send(toCsv(rows));
  });

  app.get("/api/finance/export/operational-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const close = buildOperationalClose(query.data.month);
      const rows = [
        { item: "Mes", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.month },
        { item: "Fecha de corte", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.meta.cutOffDate },
        { item: "Generado el", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.generatedAt },
        { item: "Controles cr\u00edticos", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.criticalCount, amount: "", message: "" },
        { item: "Controles con observaci\u00f3n", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.warningCount, amount: "", message: "" },
        { item: "Pendientes totales", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.pendingItems, amount: close.summary.pendingAmount, message: "" },
        ...close.checks.map((check) => ({
          item: financeLabel(operationalCheckLabels, check.id),
          status: financeLabel(operationalStatusLabels, check.status),
          count: check.count,
          amount: check.amount,
          message: check.message,
        })),
      ];
      await sendXlsxTable(res, {
        filename: `checklist-operacional-${close.month}.xlsx`,
        sheetName: "Checklist operacional",
        columns: [
          { header: "\u00cdtem", width: 34, value: row => row.item },
          { header: "Estado", width: 20, value: row => row.status },
          { header: "Cantidad", width: 14, numFmt: "#,##0", value: row => row.count },
          { header: "Monto", width: 16, numFmt: "$#,##0", value: row => row.amount },
          { header: "Mensaje", width: 64, value: row => row.message },
        ],
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/monthly-close.csv", (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });
    const close = buildMonthlyClose(query.data.month);
    const baseRows = [
      ["month", close.month],
      ["cut_off_date", close.meta.cutOffDate],
      ["generated_at", close.meta.generatedAt],
      ["billed_total", close.billedTotal],
      ["collected_total", close.collectedTotal],
      ["overdue_total", close.overdueTotal],
      ["paid_expenses_total", close.paidExpensesTotal],
      ["accrued_expenses_total", close.accruedExpensesTotal],
      ["pending_expenses_total", close.pendingExpensesTotal],
      ["cash_margin", close.cashMargin],
      ["accrued_margin", close.accruedMargin],
      ["budget_planned_total", close.budgetPlannedTotal],
      ["budget_actual_total", close.budgetActualTotal],
      ["budget_variance_total", close.budgetVarianceTotal],
      ["budget_execution_percent", close.budgetExecutionPercent],
      ["cash_flow_opening_balance", close.cashFlowProjection.openingBalance],
      ["cash_flow_overdue_recovery_rate", close.cashFlowProjection.overdueRecoveryRate],
      ["cash_flow_expected_inflow_total", close.cashFlowProjection.expectedInflowTotal],
      ["cash_flow_overdue_nominal_inflow_total", close.cashFlowProjection.overdueNominalInflowTotal],
      ["cash_flow_overdue_recoverable_inflow_total", close.cashFlowProjection.overdueRecoverableInflowTotal],
      ["cash_flow_scheduled_outflow_total", close.cashFlowProjection.scheduledOutflowTotal],
      ["cash_flow_budget_reserve", close.cashFlowProjection.budgetReserve],
      ["cash_flow_projected_closing_balance", close.cashFlowProjection.projectedClosingBalance],
      ["cash_flow_minimum_projected_balance", close.cashFlowProjection.minimumProjectedBalance],
      ["bank_movements_total", close.bankMovementsTotal],
      ["bank_movements_reconciled", close.bankMovementsReconciled],
      ["bank_movements_pending", close.bankMovementsPending],
      ["bank_movements_partial", close.bankMovementsPartial],
      ["receivables_aging_total", close.receivablesAging.total],
      ["payables_aging_total", close.payablesAging.total],
    ];
    const rows = [
      ["Métrica", "Valor"],
      ...baseRows.map(([metric, value]) => [financeLabel(monthlyMetricLabels, metric), value]),
      ...close.budgetByCategory.map((row: any) => [`Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} planificado`, row.plannedAmount]),
      ...close.budgetByCategory.map((row: any) => [`Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} ejecutado`, row.actualAmount]),
      ...close.cashFlowProjection.buckets.map((bucket: any) => [`Flujo ${bucket.start} a ${bucket.end}`, bucket.projectedBalance]),
      ...close.receivablesAging.buckets.map((bucket: any) => [`Cuentas por cobrar ${bucket.bucket} días`, bucket.total]),
      ...close.payablesAging.buckets.map((bucket: any) => [`Gastos por pagar ${bucket.bucket} días`, bucket.total]),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cierre-mensual-${close.month}.csv"`);
    res.send(toCsv(rows));
  });

  app.get("/api/finance/export/monthly-close.xlsx", async (req, res, next) => {
    try {
      const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
      if (!query.success) return res.status(400).json({ error: "Mes inv\u00e1lido" });
      const close = buildMonthlyClose(query.data.month);
      const baseRows = [
        ["month", close.month],
        ["cut_off_date", close.meta.cutOffDate],
        ["generated_at", close.meta.generatedAt],
        ["billed_total", close.billedTotal],
        ["collected_total", close.collectedTotal],
        ["overdue_total", close.overdueTotal],
        ["paid_expenses_total", close.paidExpensesTotal],
        ["accrued_expenses_total", close.accruedExpensesTotal],
        ["pending_expenses_total", close.pendingExpensesTotal],
        ["cash_margin", close.cashMargin],
        ["accrued_margin", close.accruedMargin],
        ["budget_planned_total", close.budgetPlannedTotal],
        ["budget_actual_total", close.budgetActualTotal],
        ["budget_variance_total", close.budgetVarianceTotal],
        ["budget_execution_percent", close.budgetExecutionPercent],
        ["cash_flow_opening_balance", close.cashFlowProjection.openingBalance],
        ["cash_flow_overdue_recovery_rate", close.cashFlowProjection.overdueRecoveryRate],
        ["cash_flow_expected_inflow_total", close.cashFlowProjection.expectedInflowTotal],
        ["cash_flow_overdue_nominal_inflow_total", close.cashFlowProjection.overdueNominalInflowTotal],
        ["cash_flow_overdue_recoverable_inflow_total", close.cashFlowProjection.overdueRecoverableInflowTotal],
        ["cash_flow_scheduled_outflow_total", close.cashFlowProjection.scheduledOutflowTotal],
        ["cash_flow_budget_reserve", close.cashFlowProjection.budgetReserve],
        ["cash_flow_projected_closing_balance", close.cashFlowProjection.projectedClosingBalance],
        ["cash_flow_minimum_projected_balance", close.cashFlowProjection.minimumProjectedBalance],
        ["bank_movements_total", close.bankMovementsTotal],
        ["bank_movements_reconciled", close.bankMovementsReconciled],
        ["bank_movements_pending", close.bankMovementsPending],
        ["bank_movements_partial", close.bankMovementsPartial],
        ["receivables_aging_total", close.receivablesAging.total],
        ["payables_aging_total", close.payablesAging.total],
      ];
      const rows = [
        ...baseRows.map(([metric, value]) => ({ metric: financeLabel(monthlyMetricLabels, metric), value })),
        ...close.budgetByCategory.map((row: any) => ({ metric: `Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} planificado`, value: row.plannedAmount })),
        ...close.budgetByCategory.map((row: any) => ({ metric: `Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} ejecutado`, value: row.actualAmount })),
        ...close.cashFlowProjection.buckets.map((bucket: any) => ({ metric: `Flujo ${bucket.start} a ${bucket.end}`, value: bucket.projectedBalance })),
        ...close.receivablesAging.buckets.map((bucket: any) => ({ metric: `Cuentas por cobrar ${bucket.bucket} d\u00edas`, value: bucket.total })),
        ...close.payablesAging.buckets.map((bucket: any) => ({ metric: `Gastos por pagar ${bucket.bucket} d\u00edas`, value: bucket.total })),
      ];
      await sendXlsxTable(res, {
        filename: `cierre-mensual-${close.month}.xlsx`,
        sheetName: "Cierre mensual",
        columns: [
          { header: "M\u00e9trica", width: 48, value: row => row.metric },
          { header: "Valor", width: 22, numFmt: "$#,##0", value: row => row.value },
        ],
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/expenses.csv", (req, res) => {
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const rows = db.prepare(`
      SELECT id, date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
             document_type, document_number, payment_method, payment_status, paid_at, due_date, notes
      FROM expenses
      WHERE 1=1
        ${branchFilterSql("branch_id", branchId)}
      ORDER BY date DESC, id DESC
    `).all(...branchParams(branchId));

    const columns = [
      ["ID", "id"],
      ["Fecha", "date"],
      ["Categoría", "category"],
      ["Proveedor", "supplier_name"],
      ["RUT proveedor", "supplier_rut"],
      ["Descripción", "description"],
      ["Monto neto", "amount_net"],
      ["Impuesto", "tax_amount"],
      ["Monto total", "amount_total"],
      ["Tipo documento", "document_type"],
      ["Número documento", "document_number"],
      ["Método de pago", "payment_method"],
      ["Estado de pago", "payment_status"],
      ["Fecha de pago", "paid_at"],
      ["Fecha de vencimiento", "due_date"],
      ["Notas", "notes"],
    ] as const;
    const lines = [
      columns.map(([label]) => label).join(","),
      ...rows.map((row: any) => columns.map(([, key]) => {
        if (key === "category") return escapeCsv(financeLabel(expenseCategoryLabels, row[key]));
        if (key === "document_type") return escapeCsv(financeLabel(documentTypeLabels, row[key]));
        if (key === "payment_method") return escapeCsv(financeLabel(paymentMethodLabels, row[key]));
        if (key === "payment_status") return escapeCsv(financeLabel(paymentStatusLabels, row[key]));
        return escapeCsv(row[key]);
      }).join(",")),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"gastos.csv\"");
    res.send(lines.join("\n"));
  });

  app.get("/api/finance/export/expenses.xlsx", async (req, res, next) => {
    try {
      const branchId = parseBranchIdQuery(req.query.branch_id);
      const rows = db.prepare(`
        SELECT id, date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
               document_type, document_number, payment_method, payment_status, paid_at, due_date, notes
        FROM expenses
        WHERE 1=1
          ${branchFilterSql("branch_id", branchId)}
        ORDER BY date DESC, id DESC
      `).all(...branchParams(branchId));
      const columns: XlsxColumn<any>[] = [
        { header: "ID", width: 10, numFmt: "0", value: row => row.id },
        { header: "Fecha", width: 14, value: row => row.date },
        { header: "Categor\u00eda", width: 18, value: row => financeLabel(expenseCategoryLabels, row.category) },
        { header: "Proveedor", width: 28, value: row => row.supplier_name },
        { header: "RUT proveedor", width: 18, value: row => row.supplier_rut },
        { header: "Descripci\u00f3n", width: 42, value: row => row.description },
        { header: "Monto neto", width: 16, numFmt: "$#,##0", value: row => row.amount_net },
        { header: "Impuesto", width: 14, numFmt: "$#,##0", value: row => row.tax_amount },
        { header: "Monto total", width: 16, numFmt: "$#,##0", value: row => row.amount_total },
        { header: "Tipo documento", width: 20, value: row => financeLabel(documentTypeLabels, row.document_type) },
        { header: "N\u00famero documento", width: 20, value: row => row.document_number },
        { header: "M\u00e9todo de pago", width: 20, value: row => financeLabel(paymentMethodLabels, row.payment_method) },
        { header: "Estado de pago", width: 18, value: row => financeLabel(paymentStatusLabels, row.payment_status) },
        { header: "Fecha de pago", width: 16, value: row => row.paid_at },
        { header: "Fecha de vencimiento", width: 20, value: row => row.due_date },
        { header: "Notas", width: 44, value: row => row.notes },
      ];
      await sendXlsxTable(res, { filename: "gastos.xlsx", sheetName: "Gastos", columns, rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/payments.csv", (req, res) => {
    const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
    if (!status.success) return res.status(400).json({ error: "Estado inválido" });

    const branchId = parseBranchIdQuery(req.query.branch_id);
    const rows = status.data
      ? db.prepare(`
          SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
          FROM payments p
          JOIN contracts c ON p.contract_id = c.id
          JOIN clients cl ON c.client_id = cl.id
          WHERE p.status = ?
            ${branchFilterSql("p.branch_id", branchId)}
          ORDER BY p.due_date DESC
        `).all(status.data, ...branchParams(branchId))
      : db.prepare(`
          SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
          FROM payments p
          JOIN contracts c ON p.contract_id = c.id
          JOIN clients cl ON c.client_id = cl.id
          WHERE 1=1
            ${branchFilterSql("p.branch_id", branchId)}
          ORDER BY p.due_date DESC
        `).all(...branchParams(branchId));

    const columns = [
      ["ID", "id"],
      ["Cliente", "client_name"],
      ["Contrato", "contract_id"],
      ["Monto", "amount"],
      ["Fecha de vencimiento", "due_date"],
      ["Fecha de pago", "payment_date"],
      ["Estado", "status"],
      ["Método", "method"],
      ["Referencia", "reference"],
    ] as const;
    const lines = [
      columns.map(([label]) => label).join(","),
      ...rows.map((row: any) => columns.map(([, key]) => {
        if (key === "status") return escapeCsv(financeLabel(paymentStatusLabels, row[key]));
        if (key === "method") return escapeCsv(financeLabel(paymentMethodLabels, row[key]));
        return escapeCsv(row[key]);
      }).join(",")),
    ];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cuentas-por-cobrar.csv\"");
    res.send(lines.join("\n"));
  });

  app.get("/api/finance/export/payments.xlsx", async (req, res, next) => {
    try {
      const status = paymentStatusQuerySchema.safeParse(req.query.status || undefined);
      if (!status.success) return res.status(400).json({ error: "Estado inv\u00e1lido" });
      const branchId = parseBranchIdQuery(req.query.branch_id);

      const rows = status.data
        ? db.prepare(`
            SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
            FROM payments p
            JOIN contracts c ON p.contract_id = c.id
            JOIN clients cl ON c.client_id = cl.id
            WHERE p.status = ?
              ${branchFilterSql("p.branch_id", branchId)}
            ORDER BY p.due_date DESC
          `).all(status.data, ...branchParams(branchId))
        : db.prepare(`
            SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
            FROM payments p
            JOIN contracts c ON p.contract_id = c.id
            JOIN clients cl ON c.client_id = cl.id
            WHERE 1=1
              ${branchFilterSql("p.branch_id", branchId)}
            ORDER BY p.due_date DESC
          `).all(...branchParams(branchId));

      const columns: XlsxColumn<any>[] = [
        { header: "ID", width: 10, numFmt: "0", value: row => row.id },
        { header: "Cliente", width: 30, value: row => row.client_name },
        { header: "Contrato", width: 12, numFmt: "0", value: row => row.contract_id },
        { header: "Monto", width: 16, numFmt: "$#,##0", value: row => row.amount },
        { header: "Fecha de vencimiento", width: 20, value: row => row.due_date },
        { header: "Fecha de pago", width: 16, value: row => row.payment_date },
        { header: "Estado", width: 16, value: row => financeLabel(paymentStatusLabels, row.status) },
        { header: "M\u00e9todo", width: 18, value: row => financeLabel(paymentMethodLabels, row.method) },
        { header: "Referencia", width: 34, value: row => row.reference },
      ];
      const suffix = status.data ? `-${status.data}` : "";
      await sendXlsxTable(res, {
        filename: `cuentas-por-cobrar${suffix}.xlsx`,
        sheetName: "Cuentas por cobrar",
        columns,
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/export/bank-movements.csv", (req, res) => {
    const statuses = parseBankMovementExportStatuses(req.query.status);
    if (!statuses) return res.status(400).json({ error: "Estado inválido" });

    const rows = statuses.length
      ? db.prepare(`
          SELECT id, date, description, rut, amount, status, notes
          FROM bank_movements
          WHERE status IN (${statuses.map(() => "?").join(", ")})
          ORDER BY date DESC, id DESC
        `).all(...statuses)
      : db.prepare(`
          SELECT id, date, description, rut, amount, status, notes
          FROM bank_movements
          ORDER BY date DESC, id DESC
        `).all();

    const columns = [
      ["ID", "id"],
      ["Fecha", "date"],
      ["Glosa", "description"],
      ["RUT", "rut"],
      ["Monto", "amount"],
      ["Estado", "status"],
      ["Notas", "notes"],
    ] as const;
    const lines = [
      columns.map(([label]) => label).join(","),
      ...rows.map((row: any) => columns.map(([, key]) => {
        if (key === "status") return escapeCsv(financeLabel(bankMovementStatusLabels, row[key]));
        return escapeCsv(row[key]);
      }).join(",")),
    ];

    const suffix = statuses.length ? `-${statuses.join("-")}` : "";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cartola-bancaria${suffix}.csv"`);
    res.send(lines.join("\n"));
  });

  app.get("/api/finance/export/bank-movements.xlsx", async (req, res, next) => {
    try {
      const statuses = parseBankMovementExportStatuses(req.query.status);
      if (!statuses) return res.status(400).json({ error: "Estado inv\u00e1lido" });

      const rows = statuses.length
        ? db.prepare(`
            SELECT id, date, description, rut, amount, status, notes
            FROM bank_movements
            WHERE status IN (${statuses.map(() => "?").join(", ")})
            ORDER BY date DESC, id DESC
          `).all(...statuses)
        : db.prepare(`
            SELECT id, date, description, rut, amount, status, notes
            FROM bank_movements
            ORDER BY date DESC, id DESC
          `).all();

      const columns: XlsxColumn<any>[] = [
        { header: "ID", width: 10, numFmt: "0", value: row => row.id },
        { header: "Fecha", width: 14, value: row => row.date },
        { header: "Glosa", width: 42, value: row => row.description },
        { header: "RUT", width: 18, value: row => row.rut },
        { header: "Monto", width: 16, numFmt: "$#,##0", value: row => row.amount },
        { header: "Estado", width: 16, value: row => financeLabel(bankMovementStatusLabels, row.status) },
        { header: "Notas", width: 44, value: row => row.notes },
      ];
      const suffix = statuses.length ? `-${statuses.join("-")}` : "";
      await sendXlsxTable(res, {
        filename: `cartola-bancaria${suffix}.xlsx`,
        sheetName: "Cartola bancaria",
        columns,
        rows,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/finance/payments/:id/receipt", (req, res) => {
    const payment = db.prepare(`
      SELECT receipt_file_path, receipt_file_name, receipt_mime_type
      FROM payments
      WHERE id = ?
    `).get(req.params.id) as {
      receipt_file_path: string | null,
      receipt_file_name: string | null,
      receipt_mime_type: string | null,
    } | undefined;

    if (!payment) return res.status(404).json({ error: "Pago no encontrado" });
    if (!payment.receipt_file_path) return res.status(404).json({ error: "Comprobante no encontrado" });

    try {
      const absolutePath = resolveStoredFile(payment.receipt_file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Archivo de comprobante no encontrado" });
      res.type(payment.receipt_mime_type || "application/octet-stream");
      res.download(absolutePath, payment.receipt_file_name || "comprobante");
    } catch {
      res.status(400).json({ error: "Ruta de comprobante inválida" });
    }
  });

  app.post("/api/finance/payments/:id/register", (req, res) => {
    const body = parseBody(registerPaymentSchema, req.body, res);
    if (!body) return;

    const { method, payment_date, reference, note, receipt } = body;
    const paymentId = req.params.id;

    const transaction = db.transaction(() => {
      const storedReceipt = receipt ? storePaymentReceipt(receipt) : null;
      const result = markPaymentAsPaid({
        paymentId,
        method,
        paymentDate: payment_date || new Date().toISOString(),
        reference,
        receiptFilePath: storedReceipt?.filePath || null,
        receiptFileName: storedReceipt?.fileName || null,
        receiptMimeType: storedReceipt?.mimeType || null,
      });

      return {
        ...result,
        receiptFilePath: storedReceipt?.filePath || null,
      };
    });

    try {
      const result = transaction();
      recordAuditEvent(req, {
        action: "payment.registered",
        entityType: "payment",
        entityId: paymentId,
        metadata: {
          folio: result.folio,
          method,
          reference,
          note,
          receipt_file_path: result.receiptFilePath,
          contract_id: result.contractId,
          client_id: result.clientId,
          amount: result.amount,
          paid_amount: result.paidAmount,
          allocated_amount: result.allocatedAmount,
        },
      });
      res.json({ success: true, folio: result.folio, paidAmount: result.paidAmount, allocatedAmount: result.allocatedAmount, amount: result.amount });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/bank-movements", (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const month = queryText(req.query.month);
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (status === "attention") {
      where += " AND bm.status IN ('pending', 'partial')";
    } else if (status && status !== "all") {
      where += " AND bm.status = ?";
      params.push(status);
    }
    if (month) {
      where += " AND bm.date LIKE ?";
      params.push(`${month}%`);
    }
    if (search) {
      const like = likeValue(search);
      where += " AND (bm.description LIKE ? OR bm.rut LIKE ? OR COALESCE(bm.notes, '') LIKE ? OR bm.date LIKE ? OR CAST(bm.amount AS TEXT) LIKE ?)";
      params.push(like, like, like, like, like);
    }

    const fromSql = `
      FROM bank_movements bm
      LEFT JOIN (
        SELECT bank_movement_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY bank_movement_id
      ) pa ON pa.bank_movement_id = bm.id
      ${where}
    `;
    const total = Number((db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...params) as { count: number }).count || 0);
    let listQuery = `
      SELECT bm.*,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
      ${fromSql}
      ORDER BY bm.date DESC
    `;
    const listParams = [...params];
    if (pagination.requested) {
      listQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const movements = db.prepare(listQuery).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(movements, total, pagination) : movements);
  });

  app.get("/api/finance/bank-movements/:id/suggestions", (req, res) => {
    const movement = db.prepare(`
      SELECT bm.*,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
      FROM bank_movements bm
      LEFT JOIN (
        SELECT bank_movement_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY bank_movement_id
      ) pa ON pa.bank_movement_id = bm.id
      WHERE bm.id = ?
    `).get(req.params.id) as any | undefined;
    if (!movement) return res.status(404).json({ error: "Movimiento bancario no encontrado" });

    const payments = db.prepare(`
      SELECT p.*,
             cl.name as client_name,
             cl.rut as client_rut,
             c.id as contract_id_display,
             COALESCE(pa.allocated_amount, 0) as allocated_amount,
             ${paymentRemainingSql} as remaining_amount
      FROM payments p
      JOIN contracts c ON p.contract_id = c.id
      JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) pa ON pa.payment_id = p.id
      WHERE p.status IN ('pending', 'overdue')
    `).all() as any[];

    const suggestions = payments
      .map(payment => {
        const scored = scoreMovementSuggestion(movement, payment);
        return {
          payment_id: payment.id,
          payment,
          score: scored.score,
          reasons: scored.reasons,
        };
      })
      .filter(suggestion => suggestion.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.payment.due_date > b.payment.due_date) - Number(a.payment.due_date < b.payment.due_date))
      .slice(0, 8);

    res.json({ movement_id: movement.id, suggestions });
  });

  app.post("/api/finance/bank-movements/import", (req, res) => {
    const body = parseBody(importBankMovementsSchema, req.body, res);
    if (!body) return;

    try {
      const parsed = parseBankMovementsCsv(body.dataBase64);
      let imported = 0;
      let duplicated = 0;

      const transaction = db.transaction(() => {
        const insertMovement = db.prepare(`
          INSERT INTO bank_movements (date, description, rut, amount, status, notes)
          VALUES (?, ?, ?, ?, 'pending', ?)
        `);
        const findDuplicate = db.prepare(`
          SELECT id FROM bank_movements
          WHERE date = ? AND description = ? AND rut = ? AND amount = ?
          LIMIT 1
        `);

        for (const movement of parsed.rows) {
          ensureFinanceDateOpen(movement.date);
          const duplicate = findDuplicate.get(movement.date, movement.description, movement.rut, movement.amount);
          if (duplicate) {
            duplicated++;
          } else {
            insertMovement.run(movement.date, movement.description, movement.rut, movement.amount, "Importado desde cartola bancaria");
            imported++;
          }
        }
      });

      transaction();

      recordAuditEvent(req, {
        action: "bank_movements.imported",
        entityType: "bank_movement",
        entityId: body.fileName,
        metadata: {
          file_name: body.fileName,
          imported,
          duplicated,
          skipped: parsed.skippedRows.length,
        },
      });

      res.json({
        success: true,
        imported,
        duplicated,
        skipped: parsed.skippedRows.length,
        skippedRows: parsed.skippedRows,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/bank-movements/:id", (req, res) => {
    const body = parseBody(updateBankMovementSchema, req.body, res);
    if (!body) return;

    const movementId = req.params.id;

    try {
      const transaction = db.transaction(() => {
        const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementId) as any | undefined;
        if (!movement) throw new Error("Movimiento bancario no encontrado");
        if (movement.status === "reconciled") throw new Error("No se puede editar un movimiento conciliado");

        const next = {
          date: body.date ?? movement.date,
          description: body.description ?? movement.description,
          rut: body.rut ?? movement.rut,
          amount: body.amount ?? movement.amount,
          notes: body.notes ?? movement.notes,
        };
        ensureFinanceDatesOpen(movement.date, next.date);

        db.prepare(`
          UPDATE bank_movements
          SET date = ?, description = ?, rut = ?, amount = ?, notes = ?
          WHERE id = ?
        `).run(next.date, next.description, next.rut, next.amount, next.notes, movementId);

        return { previous: movement, next };
      });

      const result = transaction();
      recordAuditEvent(req, {
        action: "bank_movement.updated",
        entityType: "bank_movement",
        entityId: movementId,
        metadata: result,
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/mark-partial", (req, res) => {
    const body = parseBody(markBankMovementPartialSchema, req.body, res);
    if (!body) return;

    const movementId = req.params.id;

    try {
      const transaction = db.transaction(() => {
        const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementId) as any | undefined;
        if (!movement) throw new Error("Movimiento bancario no encontrado");
        if (movement.status === "reconciled") throw new Error("No se puede marcar parcial un movimiento conciliado");
        ensureFinanceDateOpen(movement.date);

        db.prepare(`
          UPDATE bank_movements
          SET status = 'partial', notes = ?
          WHERE id = ?
        `).run(body.note, movementId);

        return movement;
      });

      const previous = transaction();
      recordAuditEvent(req, {
        action: "bank_movement.marked_partial",
        entityType: "bank_movement",
        entityId: movementId,
        metadata: {
          previous_status: previous.status,
          note: body.note,
        },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/allocate", (req, res) => {
    const body = parseBody(allocateMovementSchema, req.body, res);
    if (!body) return;

    const movementId = req.params.id;

    try {
      const transaction = db.transaction(() => {
        const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementId) as any | undefined;
        if (!movement) throw new Error("Movimiento bancario no encontrado");
        if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
        ensureFinanceDateOpen(movement.date);

        const payment = db.prepare(`
          SELECT p.*, c.client_id
          FROM payments p
          JOIN contracts c ON p.contract_id = c.id
          WHERE p.id = ?
        `).get(body.payment_id) as any | undefined;
        if (!payment) throw new Error("Pago no encontrado");
        if (payment.status === "paid") throw new Error("El pago ya fue registrado");
        if (payment.status === "cancelled") throw new Error("El pago está cancelado");

        const allocatedToMovement = getMovementAllocatedAmount(movementId);
        const allocatedToPayment = getPaymentAllocatedAmount(payment.id);
        const movementRemaining = Number(movement.amount) - allocatedToMovement;
        const paymentRemaining = Number(payment.amount) - allocatedToPayment;

        if (body.amount > movementRemaining) throw new Error("El abono supera el saldo disponible del movimiento");
        if (body.amount > paymentRemaining) throw new Error("El abono supera el saldo pendiente del pago");

        db.prepare(`
          INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note)
          VALUES (?, ?, ?, ?)
        `).run(payment.id, movementId, body.amount, body.note || null);

        const nextMovementRemaining = movementRemaining - body.amount;
        const nextPaymentRemaining = paymentRemaining - body.amount;
        const movementStatus = nextMovementRemaining <= 0 ? "reconciled" : "partial";
        db.prepare(`
          UPDATE bank_movements
          SET status = ?, notes = COALESCE(?, notes)
          WHERE id = ?
        `).run(movementStatus, body.note || null, movementId);

        let folio: number | null = null;
        if (nextPaymentRemaining <= 0) {
          const paid = markPaymentAsPaid({
            paymentId: payment.id,
            method: "transfer",
            paymentDate: movement.date,
            reference: `Abonos cartola bancaria #${movement.id}`,
          });
          folio = paid.folio;
        }

        return {
          movementId,
          paymentId: payment.id,
          amount: body.amount,
          note: body.note,
          movementStatus,
          paymentFullyPaid: nextPaymentRemaining <= 0,
          movementRemaining: Math.max(nextMovementRemaining, 0),
          paymentRemaining: Math.max(nextPaymentRemaining, 0),
          folio,
        };
      });

      const result = transaction();
      recordAuditEvent(req, {
        action: "bank_movement.allocated",
        entityType: "bank_movement",
        entityId: movementId,
        metadata: result,
      });
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/reconcile", (req, res) => {
    const body = parseBody(reconcileMovementSchema, req.body, res);
    if (!body) return;

    const movementId = req.params.id;

    const transaction = db.transaction(() => {
        const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementId) as any | undefined;
        if (!movement) throw new Error("Movimiento bancario no encontrado");
        if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
        ensureFinanceDateOpen(movement.date);

      const payment = db.prepare("SELECT id, amount, status FROM payments WHERE id = ?").get(body.payment_id) as {
        id: number,
        amount: number,
        status: string,
      } | undefined;
      if (!payment) throw new Error("Pago no encontrado");
      if (payment.status === "paid") throw new Error("El pago ya fue registrado");
      if (payment.status === "cancelled") throw new Error("El pago está cancelado");

      const movementRemaining = Number(movement.amount) - getMovementAllocatedAmount(movement.id);
      const paymentRemaining = Number(payment.amount) - getPaymentAllocatedAmount(payment.id);
      if (movementRemaining <= 0) throw new Error("El movimiento no tiene saldo disponible");
      if (paymentRemaining <= 0) throw new Error("El pago no tiene saldo pendiente");
      if (movementRemaining !== paymentRemaining) throw new Error("El saldo del movimiento no coincide con el saldo pendiente del pago");

      db.prepare(`
        INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note)
        VALUES (?, ?, ?, ?)
      `).run(payment.id, movement.id, movementRemaining, body.note || null);

      const reference = body.note
        ? `Cartola bancaria #${movement.id} - ${body.note}`
        : `Cartola bancaria #${movement.id}`;
      const result = markPaymentAsPaid({
        paymentId: payment.id,
        method: "transfer",
        paymentDate: movement.date,
        reference,
      });

      db.prepare("UPDATE bank_movements SET status = 'reconciled' WHERE id = ?").run(movement.id);

      return {
        ...result,
        movement,
        paymentId: payment.id,
        reference,
        allocatedAmount: movementRemaining,
      };
    });

    try {
      const result = transaction();
      recordAuditEvent(req, {
        action: "bank_movement.reconciled",
        entityType: "bank_movement",
        entityId: movementId,
        metadata: {
          payment_id: result.paymentId,
          folio: result.folio,
          amount: result.amount,
          client_id: result.clientId,
          contract_id: result.contractId,
          note: body.note,
          reference: result.reference,
          allocated_amount: result.allocatedAmount,
        },
      });
      res.json({ success: true, folio: result.folio });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/sync-bank", (req, res) => {
    // No external bank provider is configured in this system. This endpoint only
    // auto-reconciles bank movements that were previously imported by CSV.
    const movements = db.prepare("SELECT * FROM bank_movements WHERE status = 'pending'").all() as any[];
    let autoConciliated = 0;

    const transaction = db.transaction(() => {
      const unmatched: number[] = [];
      for (const move of movements) {
        ensureFinanceDateOpen(move.date);
        // Try to find a match
        const match = db.prepare(`
          SELECT p.id,
                 con.client_id,
                 ${paymentRemainingSql} as remaining_amount
          FROM payments p 
          JOIN contracts con ON p.contract_id = con.id 
          JOIN clients c ON con.client_id = c.id 
          LEFT JOIN (
            SELECT payment_id, SUM(amount) as allocated_amount
            FROM payment_allocations
            WHERE reversed_at IS NULL
            GROUP BY payment_id
          ) pa ON pa.payment_id = p.id
          WHERE c.rut = ?
            AND ${paymentRemainingSql} = ?
            AND p.status IN ('pending', 'overdue')
          LIMIT 1
        `).get(move.rut, move.amount) as { id: number, client_id: number, remaining_amount: number } | undefined;

        if (match) {
          db.prepare(`
            INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note)
            VALUES (?, ?, ?, ?)
          `).run(match.id, move.id, move.amount, "Conciliación automática");
          markPaymentAsPaid({
            paymentId: match.id,
            method: "transfer",
            paymentDate: move.date,
            reference: `Cartola bancaria #${move.id}`,
          });
          db.prepare("UPDATE bank_movements SET status = 'reconciled' WHERE id = ?").run(move.id);
          autoConciliated++;
        } else {
          db.prepare(`
            UPDATE bank_movements
            SET notes = COALESCE(NULLIF(notes, ''), 'Sin coincidencia automática. Revisar manualmente.')
            WHERE id = ?
          `).run(move.id);
          unmatched.push(move.id);
        }
      }
      return { autoConciliated, unmatched };
    });

    const result = transaction();
    recordAuditEvent(req, {
      action: "bank_movements.imported_auto_reconciled",
      entityType: "bank_movement",
      entityId: null,
      metadata: {
        mode: "imported_movements_only",
        provider_connected: false,
        total: movements.length,
        reconciled: result.autoConciliated,
        unmatched: result.unmatched.length,
      },
    });
    res.json({
      success: true,
      mode: "imported_movements_only",
      provider_connected: false,
      message: "Conciliacion automatica ejecutada sobre movimientos importados; no se contacto un banco externo.",
      count: result.autoConciliated,
      unmatched: result.unmatched.length,
      total: movements.length,
    });
  });

  app.get("/api/finance/invoices/readiness", (req, res) => {
    res.json(getSiiReadiness());
  });

  app.post("/api/finance/invoices/:id/issue", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    try {
      const user = getCurrentUser(req);
      const result = issueInvoiceWithConfiguredProvider(invoiceId, user?.id);
      recordAuditEvent(req, {
        action: "sii.invoice_issued",
        entityType: "invoice",
        entityId: String(invoiceId),
        metadata: result,
      });
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "No se pudo emitir el documento tributario" });
    }
  });

  app.post("/api/finance/invoices/:id/sync", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    try {
      const user = getCurrentUser(req);
      const result = syncInvoiceWithConfiguredProvider(invoiceId, user?.id);
      recordAuditEvent(req, {
        action: "sii.invoice_synced",
        entityType: "invoice",
        entityId: String(invoiceId),
        metadata: result,
      });
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "No se pudo sincronizar el documento tributario" });
    }
  });

  app.get("/api/finance/invoices/:id/pdf", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    const invoice = db.prepare("SELECT folio, pdf_content FROM invoices WHERE id = ?").get(invoiceId) as { folio: number, pdf_content: string | null } | undefined;
    if (!invoice?.pdf_content) return res.status(404).json({ error: "PDF no disponible. Emite el documento primero." });

    const user = getCurrentUser(req);
    db.prepare(`
      INSERT INTO sii_events (invoice_id, staff_id, provider, event_type, status, response_json)
      VALUES (?, ?, 'local_mock', 'downloaded', 'accepted', ?)
    `).run(invoiceId, user?.id || null, JSON.stringify({ format: "pdf" }));

    res.setHeader("Content-Disposition", `attachment; filename="dte-${invoice.folio}.pdf"`);
    res.type("application/pdf").send(Buffer.from(invoice.pdf_content, "base64"));
  });

  app.get("/api/finance/invoices/:id/xml", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    const invoice = db.prepare("SELECT folio, xml_content FROM invoices WHERE id = ?").get(invoiceId) as { folio: number, xml_content: string | null } | undefined;
    if (!invoice?.xml_content) return res.status(404).json({ error: "XML no disponible. Emite el documento primero." });

    const user = getCurrentUser(req);
    db.prepare(`
      INSERT INTO sii_events (invoice_id, staff_id, provider, event_type, status, response_json)
      VALUES (?, ?, 'local_mock', 'downloaded', 'accepted', ?)
    `).run(invoiceId, user?.id || null, JSON.stringify({ format: "xml" }));

    res.setHeader("Content-Disposition", `attachment; filename="dte-${invoice.folio}.xml"`);
    res.type("application/xml").send(invoice.xml_content);
  });

  app.get("/api/finance/invoices", (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const status = queryText(req.query.status);
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (status && status !== "all") {
      where += " AND i.status_sii = ?";
      params.push(status);
    }
    const fromSql = `
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      ${where}
    `;
    const total = Number((db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...params) as { count: number }).count || 0);
    let listQuery = `
      SELECT i.*, c.name as client_name, c.rut as client_rut, c.billing_contact_email
      ${fromSql}
      ORDER BY i.date DESC
    `;
    const listParams = [...params];
    if (pagination.requested) {
      listQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const invoices = db.prepare(listQuery).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(invoices, total, pagination) : invoices);
  });
}
