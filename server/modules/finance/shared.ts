import { z } from "zod";
import { db } from "../../db";
import { runJobNow } from "../../platform/jobs";
import { localDate } from "../../platform/timezone";

export const paymentRemainingSql = "CASE WHEN p.status IN ('paid', 'cancelled') THEN 0 ELSE MAX(p.amount - COALESCE(pa.allocated_amount, 0), 0) END";

export const budgetCategorySchema = z.enum(["rent", "maintenance", "utilities", "payroll", "supplies", "taxes", "admin", "other"]);
export const expenseCategories = budgetCategorySchema.options;

export const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const paymentStatusQuerySchema = z.enum(["pending", "paid", "overdue", "cancelled"]).optional();
export const bankMovementExportStatuses = ["pending", "reconciled", "partial"] as const;
export type BankMovementExportStatus = typeof bankMovementExportStatuses[number];

export function parseBankMovementExportStatuses(value: unknown): BankMovementExportStatus[] | null {
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

export function escapeCsv(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: unknown[][]) {
  return rows.map(row => row.map(escapeCsv).join(",")).join("\n");
}

export const paymentStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};

export const bankMovementStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  partial: "Parcial",
  reconciled: "Conciliado",
};

export const paymentMethodLabels: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  automatic: "Automático",
  other: "Otro",
};

export const expenseCategoryLabels: Record<string, string> = {
  rent: "Arriendo",
  maintenance: "Mantención",
  utilities: "Servicios",
  payroll: "Sueldos",
  supplies: "Insumos",
  taxes: "Impuestos",
  admin: "Administración",
  other: "Otros",
};

export const documentTypeLabels: Record<string, string> = {
  invoice: "Factura",
  receipt: "Recibo",
  ticket: "Boleta",
  internal: "Interno",
  none: "Sin documento",
};

export const operationalStatusLabels: Record<string, string> = {
  ok: "Listo",
  warning: "Con observaciones",
  critical: "Bloqueado",
};

export const operationalCheckLabels: Record<string, string> = {
  "bank-pending": "Cartola bancaria pendiente",
  "bank-partial": "Cartola bancaria parcial",
  "open-receivables": "Cuentas por cobrar abiertas al cierre",
  "manual-payments-without-receipt": "Pagos manuales sin comprobante",
  "open-expenses": "Gastos abiertos al cierre",
  "paid-expenses-without-receipt": "Gastos pagados sin respaldo",
  "expenses-without-due-date": "Gastos sin vencimiento",
  "collection-actions-overdue": "Seguimientos de cobranza vencidos",
};

export const monthlyMetricLabels: Record<string, string> = {
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

export function financeLabel(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key;
}

export function normalizeRut(value: string | null | undefined) {
  return String(value || "").replace(/[.\-\s]/g, "").toUpperCase();
}

export function parseBranchIdQuery(value: unknown) {
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

export function branchFilterSql(column: string, branchId: number | null) {
  return branchId ? ` AND ${column} = ?` : "";
}

export function branchParams(branchId: number | null) {
  return branchId ? [branchId] : [];
}

export function getVisitorCollectedTotal(whereSql = "", params: unknown[] = []) {
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

export function getMonthRange(month?: string) {
  const selectedMonth = month || new Date().toISOString().slice(0, 7);
  const start = `${selectedMonth}-01`;
  const nextMonth = new Date(`${start}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const end = nextMonth.toISOString().slice(0, 10);
  return { month: selectedMonth, start, end };
}

export function reportMeta(input: { cutOffDate?: string; formulas: Record<string, string> }) {
  return {
    generatedAt: new Date().toISOString(),
    cutOffDate: input.cutOffDate || new Date().toISOString().slice(0, 10),
    formulas: input.formulas,
  };
}

export function parseJsonSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getMonthlyClosure(month: string, tenantId?: number | null) {
  const params: Array<string | number> = [month];
  let tenantWhere = "";
  if (tenantId) {
    tenantWhere = "AND mfc.tenant_id = ?";
    params.push(tenantId);
  }
  const closure = db.prepare(`
    SELECT mfc.*,
           closed_by.name as closed_by_name,
           reopened_by.name as reopened_by_name
    FROM monthly_finance_closures mfc
    LEFT JOIN staff closed_by ON closed_by.id = mfc.closed_by_staff_id
    LEFT JOIN staff reopened_by ON reopened_by.id = mfc.reopened_by_staff_id
    WHERE mfc.month = ?
      ${tenantWhere}
  `).get(...params) as any | undefined;
  if (!closure) return null;

  return {
    ...closure,
    monthly_snapshot: parseJsonSnapshot(closure.monthly_snapshot_json),
    operational_snapshot: parseJsonSnapshot(closure.operational_snapshot_json),
    monthly_snapshot_json: undefined,
    operational_snapshot_json: undefined,
  };
}

export function getClosedMonthlyClosure(month: string, tenantId?: number | null) {
  const closure = getMonthlyClosure(month, tenantId);
  return closure?.status === "closed" ? closure : null;
}

export function ensureFinanceMonthOpen(month: string, tenantId?: number | null) {
  const closure = getClosedMonthlyClosure(month, tenantId);
  if (closure) {
    throw new Error(`El mes ${month} está cerrado. Reabre el cierre mensual antes de modificar finanzas de ese período.`);
  }
}

export function ensureFinanceDateOpen(date: string | null | undefined, tenantId?: number | null) {
  if (!date || !/^\d{4}-\d{2}/.test(date)) return;
  ensureFinanceMonthOpen(date.slice(0, 7), tenantId);
}

export function ensureFinanceDatesOpen(dates: Array<string | null | undefined>, tenantId?: number | null) {
  for (const date of dates) ensureFinanceDateOpen(date, tenantId);
}

export function getPaymentAllocatedAmount(paymentId: string | number, tenantId?: number | null) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payment_allocations
    WHERE payment_id = ?
      AND reversed_at IS NULL
      ${tenantId ? "AND tenant_id = ?" : ""}
  `).get(...(tenantId ? [paymentId, tenantId] : [paymentId])) as { total: number };
  return Number(row.total || 0);
}

export function getMovementAllocatedAmount(movementId: string | number, tenantId?: number | null) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payment_allocations
    WHERE bank_movement_id = ?
      AND reversed_at IS NULL
      ${tenantId ? "AND tenant_id = ?" : ""}
  `).get(...(tenantId ? [movementId, tenantId] : [movementId])) as { total: number };
  return Number(row.total || 0);
}

export function getExpenseByBankMovement(movementId: string | number, tenantId?: number | null) {
  return db.prepare(`
    SELECT id, supplier_name, amount_total, payment_status
    FROM expenses
    WHERE bank_movement_id = ?
      AND payment_status != 'cancelled'
      ${tenantId ? "AND tenant_id = ?" : ""}
    LIMIT 1
  `).get(...(tenantId ? [movementId, tenantId] : [movementId])) as { id: number; supplier_name: string; amount_total: number; payment_status: string } | undefined;
}

export function markPaymentAsPaid(input: {
  paymentId: string | number;
  method: "cash" | "transfer" | "card" | "automatic";
  paymentDate: string;
  reference: string | null | undefined;
  receiptFilePath?: string | null;
  receiptFileName?: string | null;
  receiptMimeType?: string | null;
}) {
  const existingPayment = db.prepare("SELECT id, amount, status, tenant_id FROM payments WHERE id = ?").get(input.paymentId) as { id: number; amount: number; status: string; tenant_id: number | null } | undefined;
  if (!existingPayment) throw new Error("Pago no encontrado");
  const tenantId = existingPayment.tenant_id || null;
  if (existingPayment.status === "paid") throw new Error("El pago ya fue registrado");
  if (existingPayment.status === "cancelled") throw new Error("El pago está cancelado");
  ensureFinanceDateOpen(input.paymentDate, tenantId);
  const allocatedAmount = getPaymentAllocatedAmount(input.paymentId, tenantId);
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
      ${tenantId ? "AND tenant_id = ?" : ""}
  `).run(
    input.method,
    input.paymentDate,
    input.reference || null,
    input.receiptFilePath || null,
    input.receiptFileName || null,
    input.receiptMimeType || null,
    ...(tenantId ? [input.paymentId, tenantId] : [input.paymentId])
  );

  const payment = db.prepare(`SELECT contract_id FROM payments WHERE id = ? ${tenantId ? "AND tenant_id = ?" : ""}`).get(...(tenantId ? [input.paymentId, tenantId] : [input.paymentId])) as { contract_id: number };
  const contract = db.prepare(`SELECT client_id, billing_document_type FROM contracts WHERE id = ? ${tenantId ? "AND tenant_id = ?" : ""}`).get(...(tenantId ? [payment.contract_id, tenantId] : [payment.contract_id])) as { client_id: number; billing_document_type: string };
  if (!contract) throw new Error("Contrato asociado no encontrado");

  const overdueCount = db.prepare(`
    SELECT COUNT(*) as count FROM payments p
    JOIN contracts c ON p.contract_id = c.id
    WHERE c.client_id = ? AND p.status = 'overdue'
      ${tenantId ? "AND p.tenant_id = ?" : ""}
  `).get(...(tenantId ? [contract.client_id, tenantId] : [contract.client_id])) as { count: number };

  if (overdueCount.count === 0) {
    db.prepare(`UPDATE clients SET financial_status = 'up-to-date' WHERE id = ? ${tenantId ? "AND tenant_id = ?" : ""}`).run(...(tenantId ? [contract.client_id, tenantId] : [contract.client_id]));
    db.prepare(`UPDATE contracts SET status = 'active' WHERE client_id = ? AND status = 'suspended' ${tenantId ? "AND tenant_id = ?" : ""}`).run(...(tenantId ? [contract.client_id, tenantId] : [contract.client_id]));
  }

  const lastFolio = db.prepare(`SELECT MAX(folio) as last FROM invoices ${tenantId ? "WHERE tenant_id = ?" : ""}`).get(...(tenantId ? [tenantId] : [])) as { last: number };
  const nextFolio = (lastFolio.last || 449) + 1;
  const paidPayment = db.prepare(`SELECT amount FROM payments WHERE id = ? ${tenantId ? "AND tenant_id = ?" : ""}`).get(...(tenantId ? [input.paymentId, tenantId] : [input.paymentId])) as { amount: number };
  const invoice = db.prepare(`
    INSERT INTO invoices (
      folio, type, client_id, amount, status_sii, payment_id, contract_id,
      provider, provider_mode, status_detail, updated_at, tenant_id
    )
    VALUES (?, ?, ?, ?, 'pending', ?, ?, 'local_mock', 'mock', 'Preparado para emisión SII', datetime('now'), ?)
  `).run(nextFolio, contract.billing_document_type || "boleta", contract.client_id, paidPayment.amount, input.paymentId, payment.contract_id, tenantId);

  db.prepare(`
    INSERT INTO sii_events (invoice_id, provider, event_type, status, response_json, tenant_id)
    VALUES (?, 'local_mock', 'prepared', 'pending', ?, ?)
  `).run(invoice.lastInsertRowid, JSON.stringify({ message: "Documento preparado desde pago registrado" }), tenantId);

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

export function recalculatePaymentStatus(paymentId: string | number, tenantId?: number | null) {
  const payment = db.prepare(`
    SELECT p.*, c.client_id
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id AND c.tenant_id = p.tenant_id
    WHERE p.id = ?
      ${tenantId ? "AND p.tenant_id = ?" : ""}
  `).get(...(tenantId ? [paymentId, tenantId] : [paymentId])) as any | undefined;
  if (!payment || payment.status === "cancelled") return null;

  const scopedTenantId = tenantId || payment.tenant_id || null;
  const allocatedAmount = getPaymentAllocatedAmount(payment.id, scopedTenantId);
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
      ${scopedTenantId ? "AND tenant_id = ?" : ""}
  `).run(...(scopedTenantId ? [status, payment.id, scopedTenantId] : [status, payment.id]));

  if (status === "overdue") {
    db.prepare(`UPDATE clients SET financial_status = 'overdue' WHERE id = ? ${scopedTenantId ? "AND tenant_id = ?" : ""}`)
      .run(...(scopedTenantId ? [payment.client_id, scopedTenantId] : [payment.client_id]));
  }

  return {
    paymentId: payment.id,
    status,
    allocatedAmount,
    remainingAmount: Math.max(Number(payment.amount) - allocatedAmount, 0),
  };
}

export function recalculateMovementStatus(movementId: string | number, tenantId?: number | null) {
  const movement = db.prepare(`SELECT * FROM bank_movements WHERE id = ? ${tenantId ? "AND tenant_id = ?" : ""}`)
    .get(...(tenantId ? [movementId, tenantId] : [movementId])) as any | undefined;
  if (!movement) return null;

  const scopedTenantId = tenantId || movement.tenant_id || null;
  const allocatedAmount = getMovementAllocatedAmount(movement.id, scopedTenantId);
  const status = allocatedAmount <= 0
    ? "pending"
    : allocatedAmount >= Number(movement.amount)
      ? "reconciled"
      : "partial";

  db.prepare(`UPDATE bank_movements SET status = ? WHERE id = ? ${scopedTenantId ? "AND tenant_id = ?" : ""}`)
    .run(...(scopedTenantId ? [status, movement.id, scopedTenantId] : [status, movement.id]));
  return {
    movementId: movement.id,
    status,
    allocatedAmount,
    remainingAmount: Math.max(Number(movement.amount) - allocatedAmount, 0),
  };
}

export function refreshOverdueExpenses() {
  const today = localDate();
  db.prepare(`
    UPDATE expenses
    SET payment_status = 'overdue'
    WHERE payment_status = 'pending'
      AND due_date IS NOT NULL
      AND due_date < ?
  `).run(today);
}

export function refreshFinanceState() {
  if (process.env.NODE_ENV === "test") {
    void runJobNow("receivables.generate");
    void runJobNow("payments.refresh-overdue");
    return;
  }
  refreshOverdueExpenses();
}
