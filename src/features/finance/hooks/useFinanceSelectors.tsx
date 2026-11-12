import { useReceivableState } from "./useReceivableState";
import { useBankState } from "./useBankState";
import { useExpenseState } from "./useExpenseState";

import { useReportState } from "./useReportState";
import { useInvoiceState } from "./useInvoiceState";
import { useFinanceData } from "./useFinanceData";

import { Expense, FinancialBudget } from "../../../types";

import type { MovementSuggestion, PaymentReviewFilter, ExpenseReviewFilter } from "../pages/financeShared";

export type Dependencies_useFinanceSelectors = {
  budgetReport: ReturnType<typeof useFinanceData>["budgetReport"];
  budgets: ReturnType<typeof useFinanceData>["budgets"];
  cashFlowReport: ReturnType<typeof useFinanceData>["cashFlowReport"];
  expenseCategory: ReturnType<typeof useExpenseState>["expenseCategory"];
  expenseDueFilter: ReturnType<typeof useExpenseState>["expenseDueFilter"];
  expenseReportMonth: ReturnType<typeof useExpenseState>["expenseReportMonth"];
  expenseReportMonthField: ReturnType<
    typeof useExpenseState
  >["expenseReportMonthField"];
  expenseReviewFilter: ReturnType<
    typeof useExpenseState
  >["expenseReviewFilter"];
  expenses: ReturnType<typeof useFinanceData>["expenses"];
  expenseStatus: ReturnType<typeof useExpenseState>["expenseStatus"];
  invoices: ReturnType<typeof useFinanceData>["invoices"];
  invoiceStatus: ReturnType<typeof useInvoiceState>["invoiceStatus"];
  monthlyCloseReport: ReturnType<typeof useFinanceData>["monthlyCloseReport"];
  movementReportMonth: ReturnType<typeof useBankState>["movementReportMonth"];
  movements: ReturnType<typeof useFinanceData>["movements"];
  movementSearch: ReturnType<typeof useBankState>["movementSearch"];
  movementStatus: ReturnType<typeof useBankState>["movementStatus"];
  movementSuggestions: ReturnType<typeof useBankState>["movementSuggestions"];
  openCollectionQueue: ReturnType<typeof useFinanceData>["openCollectionQueue"];
  paymentReportMonth: ReturnType<
    typeof useReceivableState
  >["paymentReportMonth"];
  paymentReportMonthField: ReturnType<
    typeof useReceivableState
  >["paymentReportMonthField"];
  paymentReviewFilter: ReturnType<
    typeof useReceivableState
  >["paymentReviewFilter"];
  payments: ReturnType<typeof useFinanceData>["payments"];
  paymentSearch: ReturnType<typeof useReceivableState>["paymentSearch"];
  paymentStatus: ReturnType<typeof useReceivableState>["paymentStatus"];
  reportMonth: ReturnType<typeof useReportState>["reportMonth"];
  summary: ReturnType<typeof useFinanceData>["summary"];
};
export function useFinanceSelectors(
  dependencies: Dependencies_useFinanceSelectors,
) {
  const {
    budgetReport,
    budgets,
    cashFlowReport,
    expenseCategory,
    expenseDueFilter,
    expenseReportMonth,
    expenseReportMonthField,
    expenseReviewFilter,
    expenseStatus,
    expenses,
    invoiceStatus,
    invoices,
    monthlyCloseReport,
    movementReportMonth,
    movementSearch,
    movementStatus,
    movementSuggestions,
    movements,
    openCollectionQueue,
    paymentReportMonth,
    paymentReportMonthField,
    paymentReviewFilter,
    paymentSearch,
    paymentStatus,
    payments,
    reportMonth,
    summary,
  } = dependencies;
  const getReportMonthEnd = () => {
    const [year, month] = reportMonth.split("-").map(Number);
    if (!year || !month) return "9999-12-31";
    return new Date(year, month, 1).toISOString().slice(0, 10);
  };

  const filteredPayments = payments.filter((payment) => {
    const query = paymentSearch.toLowerCase();
    const matchesSearch =
      payment.client_name?.toLowerCase().includes(query) ||
      payment.id.toString().includes(query) ||
      payment.contract_id_display?.toString().includes(query) ||
      payment.due_date?.toLowerCase().includes(query) ||
      payment.payment_date?.toLowerCase().includes(query) ||
      payment.reference?.toLowerCase().includes(query);
    const matchesStatus =
      paymentStatus === "all" || payment.status === paymentStatus;
    const monthEnd = getReportMonthEnd();
    const matchesReportMonth =
      !paymentReportMonth ||
      (paymentReportMonthField === "due" &&
        payment.due_date?.startsWith(paymentReportMonth)) ||
      (paymentReportMonthField === "paid" &&
        payment.payment_date?.startsWith(paymentReportMonth)) ||
      (paymentReportMonthField === "any" &&
        (payment.due_date?.startsWith(paymentReportMonth) ||
          payment.payment_date?.startsWith(paymentReportMonth)));
    const matchesReview =
      paymentReviewFilter === "all" ||
      (paymentReviewFilter === "open-to-close" &&
        payment.due_date < monthEnd &&
        ["pending", "overdue"].includes(payment.status)) ||
      (paymentReviewFilter === "manual-without-receipt" &&
        payment.status === "paid" &&
        ["cash", "card"].includes(payment.method || "") &&
        !payment.receipt_file_path);
    return (
      matchesSearch && matchesStatus && matchesReportMonth && matchesReview
    );
  });

  const suggestionByPaymentId = new Map<number, MovementSuggestion>(
    movementSuggestions.map((suggestion) => [
      suggestion.payment_id,
      suggestion,
    ]),
  );

  const pendingReconcilePayments = payments
    .filter((payment) => payment.status !== "paid")
    .sort(
      (a, b) =>
        (suggestionByPaymentId.get(b.id)?.score || 0) -
        (suggestionByPaymentId.get(a.id)?.score || 0),
    );

  const pendingMovementsCount = movements.filter(
    (movement) => movement.status === "pending",
  ).length;

  const partialMovementsCount = movements.filter(
    (movement) => movement.status === "partial",
  ).length;

  const reconciledMovementsCount = movements.filter(
    (movement) => movement.status === "reconciled",
  ).length;

  const todayIso = new Date().toISOString().slice(0, 10);

  const overdueReceivables = payments
    .filter((payment) => payment.status === "overdue")
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  const unmanagedOverdueReceivables = overdueReceivables.filter(
    (payment) => Number(payment.open_collection_actions_count || 0) === 0,
  );

  const overdueReceivablesTotal = overdueReceivables.reduce(
    (sum, payment) =>
      sum + Number(payment.remaining_amount ?? payment.amount ?? 0),
    0,
  );

  const openCollectionCount = openCollectionQueue.length;

  const overdueCollectionCount = openCollectionQueue.filter(
    (action) => action.next_action_at && action.next_action_at < todayIso,
  ).length;

  const todayCollectionCount = openCollectionQueue.filter(
    (action) => action.next_action_at === todayIso,
  ).length;

  const pendingExpenseCount = expenses.filter(
    (expense) => expense.payment_status === "pending",
  ).length;

  const overdueExpenseCount = expenses.filter(
    (expense) => expense.payment_status === "overdue",
  ).length;

  const todayExpenseCount = expenses.filter(
    (expense) =>
      expense.payment_status === "pending" && expense.due_date === todayIso,
  ).length;

  const hasPaymentFilters =
    paymentSearch.trim().length > 0 ||
    paymentStatus !== "all" ||
    paymentReviewFilter !== "all" ||
    Boolean(paymentReportMonth);

  const hasExpenseFilters =
    expenseStatus !== "all" ||
    expenseCategory !== "all" ||
    expenseDueFilter !== "all" ||
    expenseReviewFilter !== "all" ||
    Boolean(expenseReportMonth);

  const hasMovementFilters =
    movementSearch.trim().length > 0 ||
    movementStatus !== "all" ||
    Boolean(movementReportMonth);

  const hasReportActivity = Boolean(
    Number(monthlyCloseReport?.collectedCount || 0) ||
      Number(monthlyCloseReport?.paidExpensesCount || 0) ||
      Number(monthlyCloseReport?.billedCount || 0) ||
      Number(monthlyCloseReport?.accruedExpensesCount || 0) ||
      (budgetReport?.rows ?? []).length ||
      (cashFlowReport?.buckets ?? []).length,
  );

  const expenseCategoryLabels: Record<Expense["category"], string> = {
    rent: "Arriendo",
    maintenance: "Mantención",
    utilities: "Servicios",
    payroll: "Sueldos",
    supplies: "Insumos",
    taxes: "Impuestos",
    admin: "Administración",
    other: "Otros",
  };

  const operationalStatusLabels: Record<string, string> = {
    ok: "Listo",
    warning: "Con observaciones",
    critical: "Bloqueado",
  };

  const operationalStatusClasses: Record<string, string> = {
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    critical: "bg-red-50 text-red-700 border-red-200",
  };

  const paymentReviewLabels: Record<PaymentReviewFilter, string> = {
    all: "",
    "open-to-close": "Cobros abiertos al cierre",
    "manual-without-receipt": "Pagos manuales sin respaldo",
  };

  const expenseReviewLabels: Record<ExpenseReviewFilter, string> = {
    all: "",
    "open-to-close": "Gastos abiertos al cierre",
    "paid-without-receipt": "Gastos pagados sin respaldo",
    "without-due-date": "Gastos sin vencimiento",
  };

  const budgetByCategory = new Map<Expense["category"], FinancialBudget>(
    budgets.map((budget) => [budget.category, budget]),
  );

  const collectibleTotal =
    Number(summary?.totalCollected || 0) +
    Number(summary?.totalPending || 0) +
    Number(summary?.totalOverdue || 0);

  const collectionProgress =
    collectibleTotal > 0
      ? Math.round(
          (Number(summary?.totalCollected || 0) / collectibleTotal) * 100,
        )
      : 0;

  const filteredExpenses = expenses.filter((expense) => {
    const monthEnd = getReportMonthEnd();
    const matchesReportMonth =
      !expenseReportMonth ||
      (expenseReportMonthField === "date" &&
        expense.date?.startsWith(expenseReportMonth)) ||
      (expenseReportMonthField === "paid" &&
        expense.paid_at?.startsWith(expenseReportMonth)) ||
      (expenseReportMonthField === "any" &&
        (expense.date?.startsWith(expenseReportMonth) ||
          expense.due_date?.startsWith(expenseReportMonth) ||
          expense.paid_at?.startsWith(expenseReportMonth)));
    return (
      (matchesReportMonth && expenseReviewFilter === "all") ||
      (matchesReportMonth &&
        expenseReviewFilter === "open-to-close" &&
        Boolean(expense.due_date) &&
        String(expense.due_date) < monthEnd &&
        ["pending", "overdue"].includes(expense.payment_status)) ||
      (matchesReportMonth &&
        expenseReviewFilter === "paid-without-receipt" &&
        expense.payment_status === "paid" &&
        ["invoice", "receipt", "ticket"].includes(expense.document_type) &&
        !expense.receipt_file_path) ||
      (matchesReportMonth &&
        expenseReviewFilter === "without-due-date" &&
        ["pending", "overdue"].includes(expense.payment_status) &&
        !expense.due_date)
    );
  });

  const filteredMovements = movements.filter((movement) => {
    const query = movementSearch.toLowerCase();
    const matchesSearch =
      movement.description?.toLowerCase().includes(query) ||
      movement.rut?.toLowerCase().includes(query) ||
      movement.notes?.toLowerCase().includes(query) ||
      movement.date?.toLowerCase().includes(query) ||
      movement.amount.toString().includes(query);
    const matchesStatus =
      movementStatus === "all" ||
      (movementStatus === "attention" &&
        ["pending", "partial"].includes(movement.status)) ||
      movement.status === movementStatus;
    const matchesReportMonth =
      !movementReportMonth || movement.date?.startsWith(movementReportMonth);
    return matchesSearch && matchesStatus && matchesReportMonth;
  });

  const filteredInvoices = invoices.filter(
    (invoice) =>
      invoiceStatus === "all" || invoice.status_sii === invoiceStatus,
  );

  const pendingInvoicesCount = invoices.filter(
    (invoice) => invoice.status_sii === "pending",
  ).length;

  const acceptedInvoicesCount = invoices.filter(
    (invoice) => invoice.status_sii === "accepted",
  ).length;

  const rejectedInvoicesCount = invoices.filter(
    (invoice) => invoice.status_sii === "rejected",
  ).length;
  return {
    getReportMonthEnd,
    filteredPayments,
    suggestionByPaymentId,
    pendingReconcilePayments,
    pendingMovementsCount,
    partialMovementsCount,
    reconciledMovementsCount,
    todayIso,
    overdueReceivables,
    unmanagedOverdueReceivables,
    overdueReceivablesTotal,
    openCollectionCount,
    overdueCollectionCount,
    todayCollectionCount,
    pendingExpenseCount,
    overdueExpenseCount,
    todayExpenseCount,
    hasPaymentFilters,
    hasExpenseFilters,
    hasMovementFilters,
    hasReportActivity,
    expenseCategoryLabels,
    operationalStatusLabels,
    operationalStatusClasses,
    paymentReviewLabels,
    expenseReviewLabels,
    budgetByCategory,
    collectibleTotal,
    collectionProgress,
    filteredExpenses,
    filteredMovements,
    filteredInvoices,
    pendingInvoicesCount,
    acceptedInvoicesCount,
    rejectedInvoicesCount,
  };
}
