import { db } from "../../../db";
import { getTenantSettings } from "../../../tenantSettings";
import {
  addDays,
  branchFilterSql,
  branchParams,
  expenseCategories,
  getMonthRange,
  getVisitorCollectedTotal,
  refreshFinanceState,
  refreshOverdueExpenses,
  reportMeta,
  type BankMovementExportStatus,
} from "../shared";

export async function buildAgingSummary(
  table: "payments" | "expenses",
  amountColumn: string,
  dateColumn: string,
  statusColumn: string,
  openStatuses: string[],
  tenantId?: number | null
) {
  const params: Array<string | number> = [...openStatuses];
  const tenantWhere = tenantId ? "AND tenant_id = ?" : "";
  if (tenantId) params.push(tenantId);
  const rows = await db.prepare(`
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
      ${tenantWhere}
    GROUP BY bucket
  `).all(...params) as { bucket: string; count: number; total: number }[];

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

export async function buildBudgetReport(month?: string, tenantId?: number | null) {
  const range = getMonthRange(month);
  const budgetParams: Array<string | number> = [range.month];
  const actualParams: Array<string | number> = [range.start, range.end];
  const budgetTenantWhere = tenantId ? "AND tenant_id = ?" : "";
  const actualTenantWhere = tenantId ? "AND tenant_id = ?" : "";
  if (tenantId) {
    budgetParams.push(tenantId);
    actualParams.push(tenantId);
  }
  const budgets = await db.prepare(`
    SELECT category, planned_amount, notes
    FROM financial_budgets
    WHERE month = ?
      ${budgetTenantWhere}
  `).all(...budgetParams) as { category: string; planned_amount: number; notes: string | null }[];

  const actuals = await db.prepare(`
    SELECT category, COALESCE(SUM(amount_total), 0) as actual_amount, COUNT(*) as count
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
      ${actualTenantWhere}
    GROUP BY category
  `).all(...actualParams) as { category: string; actual_amount: number; count: number }[];

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

export async function buildCashFlowProjection(month?: string, tenantId?: number | null) {
  await refreshFinanceState();
  const range = getMonthRange(month);
  const budgetReport = await buildBudgetReport(range.month, tenantId);
  const config = tenantId ? await getTenantSettings(tenantId) : undefined;
  const overdueRecoveryRate = Math.min(Math.max(Number(config?.overdue_recovery_rate ?? 60), 0), 100);
  const tenantWhere = tenantId ? "AND tenant_id = ?" : "";

  const openingIncome = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM payments
    WHERE status = 'paid'
      AND payment_date < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, tenantId] : [range.start])) as { total: number };
  const openingVisitorIncome = tenantId
    ? await getVisitorCollectedTotal("AND tenant_id = ? AND paid_at < ?", [tenantId, range.start])
    : await getVisitorCollectedTotal("AND paid_at < ?", [range.start]);
  const openingExpenses = await db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, tenantId] : [range.start])) as { total: number };
  const openingBalance = Number(openingIncome.total || 0) + openingVisitorIncome - Number(openingExpenses.total || 0);

  const scheduledInflows = await db.prepare(`
    SELECT due_date as date,
           COALESCE(SUM(amount), 0) as nominal_total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount * ? / 100.0 ELSE amount END), 0) as total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0) as overdue_nominal_total,
           COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount * ? / 100.0 ELSE 0 END), 0) as overdue_recoverable_total,
           COUNT(*) as count
    FROM payments
    WHERE status IN ('pending', 'overdue')
      AND due_date < ?
      ${tenantWhere}
    GROUP BY due_date
  `).all(...(tenantId ? [overdueRecoveryRate, overdueRecoveryRate, range.end, tenantId] : [overdueRecoveryRate, overdueRecoveryRate, range.end])) as {
    date: string;
    nominal_total: number;
    total: number;
    overdue_nominal_total: number;
    overdue_recoverable_total: number;
    count: number;
  }[];

  const scheduledOutflows = await db.prepare(`
    SELECT due_date as date, COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status IN ('pending', 'overdue')
      AND due_date IS NOT NULL
      AND due_date < ?
      ${tenantWhere}
    GROUP BY due_date
  `).all(...(tenantId ? [range.end, tenantId] : [range.end])) as { date: string; total: number; count: number }[];

  const budgetReserve = Math.max(Number(budgetReport.plannedTotal || 0) - Number(budgetReport.actualTotal || 0), 0);

  const buckets: Array<{
    start: string;
    end: string;
    expectedInflow: number;
    expectedInflowCount: number;
    scheduledOutflow: number;
    scheduledOutflowCount: number;
    budgetReserve: number;
    overdueNominalInflow: number;
    overdueRecoverableInflow: number;
    netFlow: number;
    projectedBalance: number;
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

export async function buildMonthlyClose(month?: string, tenantId?: number | null) {
  await refreshOverdueExpenses();
  const range = getMonthRange(month);
  const budgetReport = await buildBudgetReport(range.month, tenantId);
  const cashFlowProjection = await buildCashFlowProjection(range.month, tenantId);
  const tenantWhere = tenantId ? "AND tenant_id = ?" : "";

  const collected = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end])) as { total: number; count: number };

  const billed = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE due_date >= ?
      AND due_date < ?
      AND status != 'cancelled'
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end])) as { total: number; count: number };

  const overdue = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM payments
    WHERE due_date < ?
      AND status = 'overdue'
      ${tenantWhere}
  `).get(...(tenantId ? [range.end, tenantId] : [range.end])) as { total: number; count: number };

  const paidExpenses = await db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at >= ?
      AND paid_at < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end])) as { total: number; count: number };

  const accruedExpenses = await db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end])) as { total: number; count: number };

  const pendingExpenses = await db.prepare(`
    SELECT COALESCE(SUM(amount_total), 0) as total, COUNT(*) as count
    FROM expenses
    WHERE payment_status IN ('pending', 'overdue')
      AND due_date < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.end, tenantId] : [range.end])) as { total: number; count: number };

  const bank = await db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'reconciled' THEN 1 ELSE 0 END) as reconciled,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
      ${tenantWhere}
  `).get(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end])) as { total: number; reconciled: number; pending: number; partial: number };

  const expensesByCategory = await db.prepare(`
    SELECT category, COUNT(*) as count, SUM(amount_total) as total
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status != 'cancelled'
      ${tenantWhere}
    GROUP BY category
    ORDER BY total DESC
  `).all(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end]));

  const collectionsByMethod = await db.prepare(`
    SELECT COALESCE(method, 'unknown') as method, COUNT(*) as count, SUM(amount) as total
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
      ${tenantWhere}
    GROUP BY COALESCE(method, 'unknown')
    ORDER BY total DESC
  `).all(...(tenantId ? [range.start, range.end, tenantId] : [range.start, range.end]));

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
    receivablesAging: await buildAgingSummary("payments", "amount", "due_date", "status", ["pending", "overdue"], tenantId),
    payablesAging: await buildAgingSummary("expenses", "amount_total", "due_date", "payment_status", ["pending", "overdue"], tenantId),
  };
}

export type OperationalCloseStatus = "ok" | "warning" | "critical";

export type OperationalCloseCheck = {
  id: string;
  label: string;
  status: OperationalCloseStatus;
  count: number;
  amount: number;
  message: string;
};

export async function buildOperationalClose(month?: string, tenantId?: number | null) {
  await refreshOverdueExpenses();
  const range = getMonthRange(month);
  const monthlyClose = await buildMonthlyClose(range.month, tenantId);
  const metric = async (sql: string, ...params: unknown[]) => await db.prepare(sql).get(...params) as { count: number; amount: number };
  const tenantWhere = tenantId ? "AND tenant_id = ?" : "";
  const withTenant = (...params: unknown[]) => tenantId ? [...params, tenantId] : params;
  const makeCheck = (
    id: string,
    label: string,
    row: { count: number; amount: number },
    nonZeroStatus: Exclude<OperationalCloseStatus, "ok">,
    okMessage: string,
    pendingMessage: (count: number, amount: number) => string
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

  const bankPending = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
      AND status = 'pending'
      ${tenantWhere}
  `, ...withTenant(range.start, range.end));

  const bankPartial = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM bank_movements
    WHERE date >= ?
      AND date < ?
      AND status = 'partial'
      ${tenantWhere}
  `, ...withTenant(range.start, range.end));

  const openReceivables = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE due_date < ?
      AND status IN ('pending', 'overdue')
      ${tenantWhere}
  `, ...withTenant(range.end));

  const openExpenses = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE due_date IS NOT NULL
      AND due_date < ?
      AND payment_status IN ('pending', 'overdue')
      ${tenantWhere}
  `, ...withTenant(range.end));

  const manualPaymentsWithoutReceipt = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM payments
    WHERE status = 'paid'
      AND payment_date >= ?
      AND payment_date < ?
      AND method IN ('cash', 'card')
      AND (receipt_file_path IS NULL OR receipt_file_path = '')
      ${tenantWhere}
  `, ...withTenant(range.start, range.end));

  const paidExpensesWithoutReceipt = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE payment_status = 'paid'
      AND paid_at >= ?
      AND paid_at < ?
      AND document_type IN ('invoice', 'receipt', 'ticket')
      AND (receipt_file_path IS NULL OR receipt_file_path = '')
      ${tenantWhere}
  `, ...withTenant(range.start, range.end));

  const expensesWithoutDueDate = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount_total), 0) as amount
    FROM expenses
    WHERE date >= ?
      AND date < ?
      AND payment_status IN ('pending', 'overdue')
      AND due_date IS NULL
      ${tenantWhere}
  `, ...withTenant(range.start, range.end));

  const overdueCollectionActions = await metric(`
    SELECT COUNT(*) as count, COALESCE(SUM(p.amount), 0) as amount
    FROM collection_actions ca
    JOIN payments p ON p.id = ca.payment_id AND p.tenant_id = ca.tenant_id
    WHERE ca.status = 'open'
      AND ca.next_action_at IS NOT NULL
      AND ca.next_action_at < ?
      ${tenantId ? "AND ca.tenant_id = ?" : ""}
  `, ...withTenant(range.end));

  const checks = [
    makeCheck(
      "bank-pending",
      "Movimientos bancarios sin conciliar",
      bankPending,
      "critical",
      "No hay movimientos pendientes en la cartola del mes.",
      (count, amount) => `${count} movimiento(s) por $${amount.toLocaleString()} siguen sin match.`
    ),
    makeCheck(
      "bank-partial",
      "Movimientos bancarios parciales",
      bankPartial,
      "warning",
      "No hay movimientos parcialmente aplicados.",
      (count, amount) => `${count} movimiento(s) por $${amount.toLocaleString()} tienen saldo por resolver.`
    ),
    makeCheck(
      "open-receivables",
      "Cuentas por cobrar abiertas al cierre",
      openReceivables,
      "critical",
      "No quedan cobros vencidos o abiertos antes del cierre.",
      (count, amount) => `${count} cobro(s) por $${amount.toLocaleString()} siguen abiertos antes del cierre.`
    ),
    makeCheck(
      "open-expenses",
      "Gastos vencidos o abiertos al cierre",
      openExpenses,
      "critical",
      "No quedan gastos vencidos o abiertos antes del cierre.",
      (count, amount) => `${count} gasto(s) por $${amount.toLocaleString()} siguen abiertos antes del cierre.`
    ),
    makeCheck(
      "manual-payments-without-receipt",
      "Pagos manuales sin respaldo",
      manualPaymentsWithoutReceipt,
      "warning",
      "Los pagos manuales del mes tienen respaldo adjunto.",
      (count, amount) => `${count} pago(s) manual(es) por $${amount.toLocaleString()} no tienen comprobante.`
    ),
    makeCheck(
      "paid-expenses-without-receipt",
      "Gastos pagados sin respaldo",
      paidExpensesWithoutReceipt,
      "warning",
      "Los gastos pagados del mes tienen respaldo adjunto.",
      (count, amount) => `${count} gasto(s) pagado(s) por $${amount.toLocaleString()} no tienen comprobante.`
    ),
    makeCheck(
      "expenses-without-due-date",
      "Gastos abiertos sin vencimiento",
      expensesWithoutDueDate,
      "warning",
      "Los gastos abiertos del mes tienen fecha de vencimiento.",
      (count, amount) => `${count} gasto(s) por $${amount.toLocaleString()} no tienen vencimiento para seguimiento.`
    ),
    makeCheck(
      "collection-actions-overdue",
      "Gestiones de cobranza abiertas",
      overdueCollectionActions,
      "warning",
      "No hay gestiones de cobranza abiertas antes del cierre.",
      (count, amount) => `${count} gestion(es) por $${amount.toLocaleString()} siguen abiertas antes del cierre.`
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

export async function getFinanceSummaryFromDb(tenantId: number, branchId: number | null) {
  const branchFilter = branchFilterSql("branch_id", branchId);
  const branchParamsForTenant = branchParams(branchId);
  const totalPending = await db.prepare(`SELECT SUM(amount) as total FROM payments WHERE tenant_id = ? AND status = 'pending'${branchFilter}`).get(tenantId, ...branchParamsForTenant) as { total: number };
  const totalCollected = await db.prepare(`SELECT SUM(amount) as total FROM payments WHERE tenant_id = ? AND status = 'paid'${branchFilter}`).get(tenantId, ...branchParamsForTenant) as { total: number };
  const visitorCollected = await getVisitorCollectedTotal(`AND tenant_id = ?${branchFilterSql("branch_id", branchId)}`, [tenantId, ...branchParamsForTenant]);
  const totalOverdue = await db.prepare(`SELECT SUM(amount) as total FROM payments WHERE tenant_id = ? AND status = 'overdue'${branchFilter}`).get(tenantId, ...branchParamsForTenant) as { total: number };
  const overdueClientsCount = await db.prepare(`SELECT COUNT(DISTINCT c.client_id) as count FROM payments p JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.status = 'overdue'${branchFilterSql("p.branch_id", branchId)}`).get(tenantId, ...branchParamsForTenant) as { count: number };
  const pendingExpenses = await db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE tenant_id = ? AND payment_status = 'pending'${branchFilter}`).get(tenantId, ...branchParamsForTenant) as { total: number };
  const overdueExpenses = await db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE tenant_id = ? AND payment_status = 'overdue'${branchFilter}`).get(tenantId, ...branchParamsForTenant) as { total: number };

  return {
    totalPending: totalPending.total || 0,
    totalCollected: Number(totalCollected.total || 0) + visitorCollected,
    totalOverdue: totalOverdue.total || 0,
    overdueClientsCount: overdueClientsCount.count || 0,
    pendingExpenses: pendingExpenses.total || 0,
    overdueExpenses: overdueExpenses.total || 0,
    projectedCashBalance: Number(totalCollected.total || 0) + visitorCollected - Number(pendingExpenses.total || 0) - Number(overdueExpenses.total || 0),
  };
}

export async function getCollectionsReportFromDb(tenantId: number, branchId: number | null) {
  const byMethod = await db.prepare(`
    SELECT COALESCE(method, 'unknown') as method, COUNT(*) as count, SUM(amount) as total
    FROM (
      SELECT method, amount
      FROM payments
      WHERE tenant_id = ?
        AND status = 'paid'
        ${branchFilterSql("branch_id", branchId)}
      UNION ALL
      SELECT payment_method as method, amount
      FROM visitor_tickets
      WHERE tenant_id = ?
        AND amount > 0
        AND payment_method IS NOT NULL
        AND paid_at IS NOT NULL
        ${branchFilterSql("branch_id", branchId)}
    )
    GROUP BY COALESCE(method, 'unknown')
    ORDER BY total DESC
  `).all(tenantId, ...branchParams(branchId), tenantId, ...branchParams(branchId));

  const daily = await db.prepare(`
    SELECT date, COUNT(*) as count, SUM(amount) as total
    FROM (
      SELECT substr(payment_date, 1, 10) as date, amount
      FROM payments
      WHERE tenant_id = ?
        AND status = 'paid' AND payment_date IS NOT NULL
        ${branchFilterSql("branch_id", branchId)}
      UNION ALL
      SELECT substr(paid_at, 1, 10) as date, amount
      FROM visitor_tickets
      WHERE tenant_id = ?
        AND amount > 0
        AND payment_method IS NOT NULL
        AND paid_at IS NOT NULL
        ${branchFilterSql("branch_id", branchId)}
    )
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
  `).all(tenantId, ...branchParams(branchId), tenantId, ...branchParams(branchId));

  const totals = await db.prepare(`
    SELECT COUNT(*) as count, SUM(amount) as total
    FROM (
      SELECT amount
      FROM payments
      WHERE tenant_id = ?
        AND status = 'paid'
        ${branchFilterSql("branch_id", branchId)}
      UNION ALL
      SELECT amount
      FROM visitor_tickets
      WHERE tenant_id = ?
        AND amount > 0
        AND payment_method IS NOT NULL
        AND paid_at IS NOT NULL
        ${branchFilterSql("branch_id", branchId)}
    )
  `).get(tenantId, ...branchParams(branchId), tenantId, ...branchParams(branchId)) as { count: number; total: number | null };

  return {
    totalCollected: totals.total || 0,
    paidPaymentsCount: totals.count || 0,
    byMethod,
    daily,
  };
}

export async function getDelinquencyReportFromDb(tenantId: number, branchId: number | null) {
  return await db.prepare(`
    SELECT cl.id as client_id,
           cl.name as client_name,
           cl.rut as client_rut,
           COUNT(p.id) as overdue_count,
           SUM(p.amount) as overdue_total,
           MIN(p.due_date) as oldest_due_date
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
      AND p.status = 'overdue'
      ${branchFilterSql("p.branch_id", branchId)}
    GROUP BY cl.id, cl.name, cl.rut
    ORDER BY overdue_total DESC
  `).all(tenantId, ...branchParams(branchId));
}

export async function getProfitabilityReportFromDb(tenantId: number, branchId: number | null) {
  const collected = await db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND status = 'paid'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParams(branchId)) as { total: number };
  const visitorCollected = await getVisitorCollectedTotal(`AND tenant_id = ?${branchFilterSql("branch_id", branchId)}`, [tenantId, ...branchParams(branchId)]);
  const paidExpenses = await db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE tenant_id = ? AND payment_status = 'paid'${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParams(branchId)) as { total: number };
  const pendingExpenses = await db.prepare(`SELECT COALESCE(SUM(amount_total), 0) as total FROM expenses WHERE tenant_id = ? AND payment_status IN ('pending', 'overdue')${branchFilterSql("branch_id", branchId)}`).get(tenantId, ...branchParams(branchId)) as { total: number };
  const byCategory = await db.prepare(`
    SELECT category, COUNT(*) as count, SUM(amount_total) as total
    FROM expenses
    WHERE tenant_id = ?
      AND payment_status != 'cancelled'
      ${branchFilterSql("branch_id", branchId)}
    GROUP BY category
    ORDER BY total DESC
  `).all(tenantId, ...branchParams(branchId));

  return {
    totalCollected: Number(collected.total || 0) + visitorCollected,
    totalPaidExpenses: paidExpenses.total || 0,
    totalPendingExpenses: pendingExpenses.total || 0,
    netMargin: Number(collected.total || 0) + visitorCollected - Number(paidExpenses.total || 0),
    byCategory,
  };
}

export async function listExpensesForExportFromDb(tenantId: number, branchId: number | null) {
  return await db.prepare(`
    SELECT id, date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
           document_type, document_number, payment_method, payment_status, paid_at, due_date, notes
    FROM expenses
    WHERE tenant_id = ?
      ${branchFilterSql("branch_id", branchId)}
    ORDER BY date DESC, id DESC
  `).all(tenantId, ...branchParams(branchId));
}

export async function listPaymentsForExportFromDb(tenantId: number, branchId: number | null, status?: string) {
  return status
    ? await db.prepare(`
        SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
        FROM payments p
        JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
        JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
        WHERE p.tenant_id = ?
          AND p.status = ?
          ${branchFilterSql("p.branch_id", branchId)}
        ORDER BY p.due_date DESC
      `).all(tenantId, status, ...branchParams(branchId))
    : await db.prepare(`
        SELECT p.id, cl.name as client_name, c.id as contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
        FROM payments p
        JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
        JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
        WHERE p.tenant_id = ?
          ${branchFilterSql("p.branch_id", branchId)}
        ORDER BY p.due_date DESC
      `).all(tenantId, ...branchParams(branchId));
}

export async function listBankMovementsForExportFromDb(
  tenantId: number,
  branchId: number | null,
  statuses: BankMovementExportStatus[]
) {
  const params: Array<string | number> = [tenantId];
  let where = "WHERE tenant_id = ?";
  if (branchId) {
    where += " AND branch_id = ?";
    params.push(branchId);
  }
  if (statuses.length) {
    where += ` AND status IN (${statuses.map(() => "?").join(", ")})`;
    params.push(...statuses);
  }

  return await db.prepare(`
    SELECT id, date, description, rut, amount, status, notes
    FROM bank_movements
    ${where}
    ORDER BY date DESC, id DESC
  `).all(...params);
}

