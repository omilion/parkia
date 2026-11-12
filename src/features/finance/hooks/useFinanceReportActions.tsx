import { useApiMutation } from "../../../lib/useApiMutation";
import { useReceivableState } from "./useReceivableState";
import { useBankState } from "./useBankState";
import { useExpenseState } from "./useExpenseState";
import { useCollectionState } from "./useCollectionState";
import { useReportState } from "./useReportState";

import React from "react";

import type { PaymentReportMonthField, ExpenseReportMonthField, FinanceTab } from "../pages/financeShared";
import type { BudgetFieldsValues } from "../../../../shared/schemas/finance";

export type Dependencies_useFinanceReportActions = {
  expenseStatus: ReturnType<typeof useExpenseState>["expenseStatus"];
  fetchData: () => Promise<void>;
  handleTabChange: (tabId: FinanceTab) => void | Promise<void>;
  monthlyCloseNote: ReturnType<typeof useReportState>["monthlyCloseNote"];
  monthlyReopenReason: ReturnType<typeof useReportState>["monthlyReopenReason"];
  movementStatus: ReturnType<typeof useBankState>["movementStatus"];
  reportMonth: ReturnType<typeof useReportState>["reportMonth"];
  setCollectionQueueDue: ReturnType<
    typeof useCollectionState
  >["setCollectionQueueDue"];
  setCollectionQueueStatus: ReturnType<
    typeof useCollectionState
  >["setCollectionQueueStatus"];
  setExpenseCategory: ReturnType<typeof useExpenseState>["setExpenseCategory"];
  setExpenseDueFilter: ReturnType<
    typeof useExpenseState
  >["setExpenseDueFilter"];
  setExpenseReportMonth: ReturnType<
    typeof useExpenseState
  >["setExpenseReportMonth"];
  setExpenseReportMonthField: ReturnType<
    typeof useExpenseState
  >["setExpenseReportMonthField"];
  setExpenseReviewFilter: ReturnType<
    typeof useExpenseState
  >["setExpenseReviewFilter"];
  setExpenseStatus: ReturnType<typeof useExpenseState>["setExpenseStatus"];
  setIsClosingMonth: ReturnType<typeof useReportState>["setIsClosingMonth"];
  setIsSavingBudget: ReturnType<typeof useReportState>["setIsSavingBudget"];
  setMonthlyCloseNote: ReturnType<typeof useReportState>["setMonthlyCloseNote"];
  setMonthlyReopenReason: ReturnType<
    typeof useReportState
  >["setMonthlyReopenReason"];
  setMovementReportMonth: ReturnType<
    typeof useBankState
  >["setMovementReportMonth"];
  setMovementSearch: ReturnType<typeof useBankState>["setMovementSearch"];
  setMovementStatus: ReturnType<typeof useBankState>["setMovementStatus"];
  setPaymentReportMonth: ReturnType<
    typeof useReceivableState
  >["setPaymentReportMonth"];
  setPaymentReportMonthField: ReturnType<
    typeof useReceivableState
  >["setPaymentReportMonthField"];
  setPaymentReviewFilter: ReturnType<
    typeof useReceivableState
  >["setPaymentReviewFilter"];
  setPaymentSearch: ReturnType<typeof useReceivableState>["setPaymentSearch"];
  setPaymentStatus: ReturnType<typeof useReceivableState>["setPaymentStatus"];
  setSelectedMovement: ReturnType<typeof useBankState>["setSelectedMovement"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useFinanceReportActions(
  dependencies: Dependencies_useFinanceReportActions,
) {
  const {
    expenseStatus,
    fetchData,
    handleTabChange,
    monthlyCloseNote,
    monthlyReopenReason,
    movementStatus,
    reportMonth,
    setCollectionQueueDue,
    setCollectionQueueStatus,
    setExpenseCategory,
    setExpenseDueFilter,
    setExpenseReportMonth,
    setExpenseReportMonthField,
    setExpenseReviewFilter,
    setExpenseStatus,
    setIsClosingMonth,
    setIsSavingBudget,
    setMonthlyCloseNote,
    setMonthlyReopenReason,
    setMovementReportMonth,
    setMovementSearch,
    setMovementStatus,
    setPaymentReportMonth,
    setPaymentReportMonthField,
    setPaymentReviewFilter,
    setPaymentSearch,
    setPaymentStatus,
    setSelectedMovement,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinanceReportActions");
  /** Devuelve true si se guardó, para que el formulario se limpie. */
  const handleSaveBudget = async (values: BudgetFieldsValues): Promise<boolean> => {
    setIsSavingBudget(true);
    const res = await apiWrite.request("/api/finance/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: reportMonth, ...values }),
    });
    const result = await res.json();
    setIsSavingBudget(false);

    if (res.ok) {
      setToast({ message: "Presupuesto actualizado.", type: "success" });
      fetchData();
      return true;
    }
    setToast({
      message: result.error || "No se pudo guardar el presupuesto.",
      type: "error",
    });
    return false;
  };

  const handleCloseMonth = async () => {
    setIsClosingMonth(true);
    const res = await apiWrite.request("/api/finance/monthly-closures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: reportMonth,
        accepted_pending_note: monthlyCloseNote,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: result.notificationTaskId
          ? "Mes cerrado y tarea de pendientes creada."
          : "Mes cerrado correctamente.",
        type: "success",
      });
      setMonthlyCloseNote("");
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo cerrar el mes.",
        type: "error",
      });
    }
    setIsClosingMonth(false);
  };

  const handleReopenMonth = async () => {
    setIsClosingMonth(true);
    const res = await apiWrite.request(
      `/api/finance/monthly-closures/${reportMonth}/reopen`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: monthlyReopenReason }),
      },
    );
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: "Mes reabierto y tarea de revisión creada.",
        type: "success",
      });
      setMonthlyReopenReason("");
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo reabrir el mes.",
        type: "error",
      });
    }
    setIsClosingMonth(false);
  };

  const handleOperationalCheckClick = (checkId: string) => {
    if (checkId === "bank-pending") {
      handleTabChange("cgvc");
      setMovementStatus("pending");
      setMovementSearch("");
      setMovementReportMonth(reportMonth);
      setSelectedMovement(null);
      return;
    }
    if (checkId === "bank-partial") {
      handleTabChange("cgvc");
      setMovementStatus("partial");
      setMovementSearch("");
      setMovementReportMonth(reportMonth);
      setSelectedMovement(null);
      return;
    }
    if (checkId === "open-receivables") {
      handleTabChange("payments");
      setPaymentStatus("all");
      setPaymentSearch("");
      setPaymentReportMonth(reportMonth);
      setPaymentReportMonthField("due");
      setPaymentReviewFilter("open-to-close");
      return;
    }
    if (checkId === "manual-payments-without-receipt") {
      handleTabChange("payments");
      setPaymentStatus("paid");
      setPaymentSearch("");
      setPaymentReportMonth(reportMonth);
      setPaymentReportMonthField("paid");
      setPaymentReviewFilter("manual-without-receipt");
      return;
    }
    if (checkId === "open-expenses") {
      handleTabChange("expenses");
      setExpenseStatus("all");
      setExpenseDueFilter("all");
      setExpenseCategory("all");
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField("any");
      setExpenseReviewFilter("open-to-close");
      return;
    }
    if (checkId === "paid-expenses-without-receipt") {
      handleTabChange("expenses");
      setExpenseStatus("paid");
      setExpenseDueFilter("all");
      setExpenseCategory("all");
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField("paid");
      setExpenseReviewFilter("paid-without-receipt");
      return;
    }
    if (checkId === "expenses-without-due-date") {
      handleTabChange("expenses");
      setExpenseStatus("all");
      setExpenseDueFilter("all");
      setExpenseCategory("all");
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField("date");
      setExpenseReviewFilter("without-due-date");
      return;
    }
    if (checkId === "collection-actions-overdue") {
      handleTabChange("collections");
      setCollectionQueueStatus("open");
      setCollectionQueueDue("actionable");
    }
  };

  const openReportPayments = (
    status: string,
    field: PaymentReportMonthField,
    month = reportMonth,
  ) => {
    handleTabChange("payments");
    setPaymentStatus(status);
    setPaymentSearch("");
    setPaymentReportMonth(month);
    setPaymentReportMonthField(field);
    setPaymentReviewFilter("all");
  };

  const openReportExpenses = (
    status: typeof expenseStatus,
    field: ExpenseReportMonthField,
    month = reportMonth,
  ) => {
    handleTabChange("expenses");
    setExpenseStatus(status);
    setExpenseDueFilter("all");
    setExpenseCategory("all");
    setExpenseReportMonth(month);
    setExpenseReportMonthField(field);
    setExpenseReviewFilter("all");
  };

  const openReportMovements = (
    status: typeof movementStatus,
    month = reportMonth,
  ) => {
    handleTabChange("cgvc");
    setMovementStatus(status);
    setMovementSearch("");
    setMovementReportMonth(month);
    setSelectedMovement(null);
  };
  return {
    handleSaveBudget,
    handleCloseMonth,
    handleReopenMonth,
    handleOperationalCheckClick,
    openReportPayments,
    openReportExpenses,
    openReportMovements,
  };
}
