import { getBranchOrDefault } from "../../../branches";
import type { XlsxColumn } from "../../../xlsx";
import {
  bankMovementStatusLabels,
  documentTypeLabels,
  escapeCsv,
  expenseCategoryLabels,
  financeLabel,
  monthlyMetricLabels,
  operationalCheckLabels,
  operationalStatusLabels,
  paymentMethodLabels,
  paymentStatusLabels,
  refreshFinanceState,
  reportMeta,
  toCsv,
  type BankMovementExportStatus,
} from "../shared";
import {
  buildBudgetReport,
  buildCashFlowProjection,
  buildMonthlyClose,
  buildOperationalClose,
  getCollectionsReportFromDb,
  getDelinquencyReportFromDb,
  getFinanceSummaryFromDb,
  getProfitabilityReportFromDb,
  listBankMovementsForExportFromDb,
  listExpensesForExportFromDb,
  listPaymentsForExportFromDb,
} from "./repo";

export { buildBudgetReport, buildCashFlowProjection, buildMonthlyClose, buildOperationalClose };

export async function getFinanceSummary(tenantId: number, rawBranchId: number | null) {
  await refreshFinanceState();
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  return await getFinanceSummaryFromDb(tenantId, branchId);
}

export async function getCollectionsReport(tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const data = await getCollectionsReportFromDb(tenantId, branchId);
  return {
    meta: reportMeta({
      formulas: {
        totalCollected: "SUM(payments.amount donde status = paid + visitor_tickets.amount pagados)",
        paidPaymentsCount: "COUNT(payments paid + visitor_tickets pagados)",
        byMethod: "GROUP BY metodo de pagos contractuales y tickets de visita",
      },
    }),
    ...data,
  };
}

export async function getDelinquencyReport(tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await getDelinquencyReportFromDb(tenantId, branchId);
  const total = rows.reduce((sum: number, row: any) => sum + Number(row.overdue_total || 0), 0);
  return {
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
  };
}

export async function getProfitabilityReport(tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const data = await getProfitabilityReportFromDb(tenantId, branchId);
  return {
    meta: reportMeta({
      formulas: {
        totalCollected: "SUM(payments.amount donde status = paid + visitor_tickets.amount pagados)",
        totalPaidExpenses: "SUM(expenses.amount_total) donde payment_status = paid",
        totalPendingExpenses: "SUM(expenses.amount_total) donde payment_status IN pending/overdue",
        netMargin: "totalCollected - totalPaidExpenses",
        byCategory: "SUM(expenses.amount_total) GROUP BY category donde payment_status != cancelled",
      },
    }),
    ...data,
  };
}

export async function buildOperationalCloseCsvExport(month: string | undefined, tenantId: number) {
  const close = await buildOperationalClose(month, tenantId);
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
  return {
    filename: `checklist-operacional-${close.month}.csv`,
    csv: toCsv(rows),
  };
}

export async function buildOperationalCloseXlsxExport(month: string | undefined, tenantId: number) {
  const close = await buildOperationalClose(month, tenantId);
  const rows = [
    { item: "Mes", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.month },
    { item: "Fecha de corte", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.meta.cutOffDate },
    { item: "Generado el", status: financeLabel(operationalStatusLabels, close.status), count: "", amount: "", message: close.generatedAt },
    { item: "Controles cr\u00edticos", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.criticalCount, amount: "", message: "" },
    { item: "Controles con observaci\u00f3n", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.warningCount, amount: "", message: "" },
    { item: "Pendientes totales", status: financeLabel(operationalStatusLabels, close.status), count: close.summary.pendingItems, amount: close.summary.pendingAmount, message: "" },
    ...close.checks.map(check => ({
      item: financeLabel(operationalCheckLabels, check.id),
      status: financeLabel(operationalStatusLabels, check.status),
      count: check.count,
      amount: check.amount,
      message: check.message,
    })),
  ];
  const columns: XlsxColumn<any>[] = [
    { header: "\u00cdtem", width: 34, value: row => row.item },
    { header: "Estado", width: 20, value: row => row.status },
    { header: "Cantidad", width: 14, numFmt: "#,##0", value: row => row.count },
    { header: "Monto", width: 16, numFmt: "$#,##0", value: row => row.amount },
    { header: "Mensaje", width: 64, value: row => row.message },
  ];
  return {
    filename: `checklist-operacional-${close.month}.xlsx`,
    sheetName: "Checklist operacional",
    columns,
    rows,
  };
}

function monthlyCloseBaseRows(close: any) {
  return [
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
}

export async function buildMonthlyCloseCsvExport(month: string | undefined, tenantId: number) {
  const close = await buildMonthlyClose(month, tenantId);
  const baseRows = monthlyCloseBaseRows(close);
  const rows = [
    ["Métrica", "Valor"],
    ...baseRows.map(([metric, value]) => [financeLabel(monthlyMetricLabels, metric), value]),
    ...close.budgetByCategory.map((row: any) => [`Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} planificado`, row.plannedAmount]),
    ...close.budgetByCategory.map((row: any) => [`Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} ejecutado`, row.actualAmount]),
    ...close.cashFlowProjection.buckets.map((bucket: any) => [`Flujo ${bucket.start} a ${bucket.end}`, bucket.projectedBalance]),
    ...close.receivablesAging.buckets.map((bucket: any) => [`Cuentas por cobrar ${bucket.bucket} días`, bucket.total]),
    ...close.payablesAging.buckets.map((bucket: any) => [`Gastos por pagar ${bucket.bucket} días`, bucket.total]),
  ];
  return {
    filename: `cierre-mensual-${close.month}.csv`,
    csv: toCsv(rows),
  };
}

export async function buildMonthlyCloseXlsxExport(month: string | undefined, tenantId: number) {
  const close = await buildMonthlyClose(month, tenantId);
  const baseRows = monthlyCloseBaseRows(close);
  const rows = [
    ...baseRows.map(([metric, value]) => ({ metric: financeLabel(monthlyMetricLabels, metric), value })),
    ...close.budgetByCategory.map((row: any) => ({ metric: `Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} planificado`, value: row.plannedAmount })),
    ...close.budgetByCategory.map((row: any) => ({ metric: `Presupuesto ${financeLabel(expenseCategoryLabels, row.category)} ejecutado`, value: row.actualAmount })),
    ...close.cashFlowProjection.buckets.map((bucket: any) => ({ metric: `Flujo ${bucket.start} a ${bucket.end}`, value: bucket.projectedBalance })),
    ...close.receivablesAging.buckets.map((bucket: any) => ({ metric: `Cuentas por cobrar ${bucket.bucket} d\u00edas`, value: bucket.total })),
    ...close.payablesAging.buckets.map((bucket: any) => ({ metric: `Gastos por pagar ${bucket.bucket} d\u00edas`, value: bucket.total })),
  ];
  const columns: XlsxColumn<any>[] = [
    { header: "M\u00e9trica", width: 48, value: row => row.metric },
    { header: "Valor", width: 22, numFmt: "$#,##0", value: row => row.value },
  ];
  return {
    filename: `cierre-mensual-${close.month}.xlsx`,
    sheetName: "Cierre mensual",
    columns,
    rows,
  };
}

export async function buildExpensesCsvExport(tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listExpensesForExportFromDb(tenantId, branchId);
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
  return lines.join("\n");
}

export async function buildExpensesXlsxExport(tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listExpensesForExportFromDb(tenantId, branchId);
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
  return { filename: "gastos.xlsx", sheetName: "Gastos", columns, rows };
}

export async function buildPaymentsCsvExport(tenantId: number, rawBranchId: number | null, status?: string) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listPaymentsForExportFromDb(tenantId, branchId, status);
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
  return lines.join("\n");
}

export async function buildPaymentsXlsxExport(tenantId: number, rawBranchId: number | null, status?: string) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listPaymentsForExportFromDb(tenantId, branchId, status);
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
  const suffix = status ? `-${status}` : "";
  return {
    filename: `cuentas-por-cobrar${suffix}.xlsx`,
    sheetName: "Cuentas por cobrar",
    columns,
    rows,
  };
}

export async function buildBankMovementsCsvExport(
  tenantId: number,
  rawBranchId: number | null,
  statuses: BankMovementExportStatus[]
) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listBankMovementsForExportFromDb(tenantId, branchId, statuses);
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
  return {
    filename: `cartola-bancaria${suffix}.csv`,
    csv: lines.join("\n"),
  };
}

export async function buildBankMovementsXlsxExport(
  tenantId: number,
  rawBranchId: number | null,
  statuses: BankMovementExportStatus[]
) {
  const branchId = rawBranchId ? await getBranchOrDefault(rawBranchId, tenantId) : null;
  const rows = await listBankMovementsForExportFromDb(tenantId, branchId, statuses);
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
  return {
    filename: `cartola-bancaria${suffix}.xlsx`,
    sheetName: "Cartola bancaria",
    columns,
    rows,
  };
}

