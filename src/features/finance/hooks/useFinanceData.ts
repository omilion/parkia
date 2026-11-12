import { useQueries, useQueryClient } from "@tanstack/react-query";
import { apiFetchJson } from "../../../lib/api";
import type { BankMovement, Branch, CollectionAction, Expense, FinanceSummary, FinancialBudget, Invoice, Payment } from "../../../types";
import type { FinanceTab, SiiReadiness } from "../pages/financeShared";

const EMPTY: never[] = [];
export function useFinanceData(filters: {
  activeTab: FinanceTab;
  selectedBranchId: string;
  expenseStatus: string;
  expenseCategory: string;
  expenseDueFilter: string;
  collectionQueueStatus: string;
  collectionQueueDue: string;
  reportMonth: string;
}) {
  const client = useQueryClient();
  const branchUrl = (url: string) =>
    filters.selectedBranchId === "all"
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}branch_id=${filters.selectedBranchId}`;
  const tab = filters.activeTab;
  const definitions = [
    ["summary", branchUrl("/api/finance/summary"), true, true],
    ["branches", "/api/branches", true, true],
    [
      "payments",
      branchUrl("/api/finance/payments"),
      ["payments", "collections", "cgvc", "reports", "closures"].includes(tab),
      true,
    ],
    [
      "movements",
      branchUrl("/api/finance/bank-movements"),
      ["cgvc", "reports", "closures"].includes(tab),
      true,
    ],
    ["invoices", branchUrl("/api/finance/invoices"), tab === "invoices", true],
    [
      "expenses",
      branchUrl(
        `/api/finance/expenses?status=${filters.expenseStatus}&category=${filters.expenseCategory}&due=${filters.expenseDueFilter}`,
      ),
      ["expenses", "reports", "closures"].includes(tab),
      true,
    ],
    [
      "collectionQueue",
      branchUrl(
        `/api/finance/collection-actions?status=${filters.collectionQueueStatus}&due=${filters.collectionQueueDue}`,
      ),
      tab === "collections",
      true,
    ],
    [
      "openCollectionQueue",
      branchUrl("/api/finance/collection-actions?status=open&due=all"),
      ["collections", "reports", "closures"].includes(tab),
      true,
    ],
    [
      "collectionsReport",
      branchUrl("/api/finance/reports/collections"),
      ["collections", "reports", "closures"].includes(tab),
      false,
    ],
    [
      "delinquencyReport",
      branchUrl("/api/finance/reports/delinquency"),
      ["collections", "reports", "closures"].includes(tab),
      false,
    ],
    [
      "profitabilityReport",
      branchUrl("/api/finance/reports/profitability"),
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "monthlyCloseReport",
      `/api/finance/reports/monthly-close?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "operationalCloseReport",
      `/api/finance/reports/operational-close?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "monthlyClosureData",
      `/api/finance/monthly-closures?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "budgetReport",
      `/api/finance/reports/budget?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "cashFlowReport",
      `/api/finance/reports/cash-flow?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "budgetsData",
      `/api/finance/budgets?month=${filters.reportMonth}`,
      ["reports", "closures"].includes(tab),
      false,
    ],
    [
      "siiReadiness",
      "/api/finance/invoices/readiness",
      tab === "invoices",
      false,
    ],
  ] as const;
  const queries = useQueries({
    queries: definitions.map(([, url, enabled]) => ({
      queryKey: ["finance", url],
      enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetchJson<any>(url, { signal }),
    })),
  });
  const data: Record<string, any> = {};
  definitions.forEach(([name], index) => {
    data[name] = queries[index].data;
  });
  const set = (name: string, value: unknown) => {
    const definition = definitions.find((item) => item[0] === name);
    if (definition) client.setQueryData(["finance", definition[1]], value);
  };
  return {
    summary: (data.summary ?? null) as FinanceSummary | null,
    branches: (data.branches ?? EMPTY) as Branch[],
    payments: (data.payments ?? EMPTY) as Payment[],
    movements: (data.movements ?? EMPTY) as BankMovement[],
    invoices: (data.invoices ?? EMPTY) as Invoice[],
    expenses: (data.expenses ?? EMPTY) as Expense[],
    collectionQueue: (data.collectionQueue ?? EMPTY) as CollectionAction[],
    openCollectionQueue: (data.openCollectionQueue ??
      EMPTY) as CollectionAction[],
    collectionsReport: data.collectionsReport ?? null,
    delinquencyReport: data.delinquencyReport ?? null,
    profitabilityReport: data.profitabilityReport ?? null,
    monthlyCloseReport: data.monthlyCloseReport ?? null,
    operationalCloseReport: data.operationalCloseReport ?? null,
    monthlyClosure: data.monthlyClosureData?.closure ?? null,
    budgetReport: data.budgetReport ?? null,
    cashFlowReport: data.cashFlowReport ?? null,
    budgets: (data.budgetsData?.budgets ?? EMPTY) as FinancialBudget[],
    siiReadiness: (data.siiReadiness ?? null) as SiiReadiness | null,
    isLoading: queries.some(
      (query, index) => definitions[index][2] && query.isPending,
    ),
    loadError:
      queries.find(
        (query, index) =>
          definitions[index][2] && definitions[index][3] && query.error,
      )?.error?.message ?? "",
    fetchData: () => client.invalidateQueries({ queryKey: ["finance"] }),
    setInvoices: (value: Invoice[]) => set("invoices", value),
    setExpenses: (value: Expense[]) => set("expenses", value),
    setSiiReadiness: (value: SiiReadiness | null) => set("siiReadiness", value),
  };
}
