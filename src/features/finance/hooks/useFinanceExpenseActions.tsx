import { useApiMutation } from "../../../lib/useApiMutation";

import { useExpenseState } from "./useExpenseState";

import React from "react";

import { BankMovement, Expense } from "../../../types";
import { apiFetchJson } from "../../../lib/api";
import type { ExpenseFieldsValues } from "../../../../shared/schemas/finance";

export type Dependencies_useFinanceExpenseActions = {
  editingExpense: ReturnType<typeof useExpenseState>["editingExpense"];
  expensePaymentAction: ReturnType<
    typeof useExpenseState
  >["expensePaymentAction"];
  expensePaymentNote: ReturnType<typeof useExpenseState>["expensePaymentNote"];
  expenses: Expense[];
  fetchData: () => Promise<void>;
  fileToReceipt: (
    file: File,
  ) => Promise<{ fileName: string; mimeType: string; dataBase64: string }>;
  focusedQueryRef: any;
  reconcilingExpense: ReturnType<typeof useExpenseState>["reconcilingExpense"];
  setEditingExpense: ReturnType<typeof useExpenseState>["setEditingExpense"];
  setExpenseMovementSuggestions: ReturnType<
    typeof useExpenseState
  >["setExpenseMovementSuggestions"];
  setExpensePaymentAction: ReturnType<
    typeof useExpenseState
  >["setExpensePaymentAction"];
  setExpensePaymentNote: ReturnType<
    typeof useExpenseState
  >["setExpensePaymentNote"];
  setExpenseReportMonth: ReturnType<
    typeof useExpenseState
  >["setExpenseReportMonth"];
  setExpenseReportMonthField: ReturnType<
    typeof useExpenseState
  >["setExpenseReportMonthField"];
  setExpenseReviewFilter: ReturnType<
    typeof useExpenseState
  >["setExpenseReviewFilter"];
  setExpenses: (value: Expense[]) => void;
  setIsExpenseDrawerOpen: ReturnType<
    typeof useExpenseState
  >["setIsExpenseDrawerOpen"];
  setIsReconcilingExpense: ReturnType<
    typeof useExpenseState
  >["setIsReconcilingExpense"];
  setIsSavingExpense: ReturnType<typeof useExpenseState>["setIsSavingExpense"];
  setReconcilingExpense: ReturnType<
    typeof useExpenseState
  >["setReconcilingExpense"];
  setSelectedExpenseReceiptName: ReturnType<
    typeof useExpenseState
  >["setSelectedExpenseReceiptName"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useFinanceExpenseActions(
  dependencies: Dependencies_useFinanceExpenseActions,
) {
  const {
    editingExpense,
    expensePaymentAction,
    expensePaymentNote,
    expenses,
    fetchData,
    fileToReceipt,
    focusedQueryRef,
    reconcilingExpense,
    setEditingExpense,
    setExpenseMovementSuggestions,
    setExpensePaymentAction,
    setExpensePaymentNote,
    setExpenseReportMonth,
    setExpenseReportMonthField,
    setExpenseReviewFilter,
    setExpenses,
    setIsExpenseDrawerOpen,
    setIsReconcilingExpense,
    setIsSavingExpense,
    setReconcilingExpense,
    setSelectedExpenseReceiptName,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinanceExpenseActions");
  const openExpenseDrawerById = async (expenseId: number) => {
    const expense = expenses.find((item) => item.id === expenseId);
    if (expense) {
      openExpenseDrawer(expense);
      return;
    }

    try {
      const allExpenses = await apiFetchJson<Expense[]>(
        "/api/finance/expenses?status=all&category=all&due=all",
      );
      const requestedExpense = allExpenses.find(
        (item) => item.id === expenseId,
      );
      if (!requestedExpense) throw new Error("Gasto no encontrado");
      setExpenses(allExpenses);
      openExpenseDrawer(requestedExpense);
    } catch (error: any) {
      focusedQueryRef.current = "";
      setToast({
        message: error.message || "No se pudo abrir el gasto solicitado",
        type: "error",
      });
    }
  };

  /** Recibe los campos validados y, si se eligió, el archivo del comprobante. */
  const handleSaveExpense = async (
    values: ExpenseFieldsValues,
    receiptFile: File | null,
  ) => {
    setIsSavingExpense(true);
    try {
      const receipt =
        receiptFile && receiptFile.size > 0
          ? await fileToReceipt(receiptFile)
          : undefined;
      const payload = { ...values, receipt };
      const res = await apiWrite.request(
        editingExpense
          ? `/api/finance/expenses/${editingExpense.id}`
          : "/api/finance/expenses",
        {
          method: editingExpense ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await res.json();

      if (res.ok) {
        setToast({
          message: editingExpense ? "Gasto actualizado." : "Gasto registrado.",
          type: "success",
        });
        setIsExpenseDrawerOpen(false);
        setEditingExpense(null);
        setSelectedExpenseReceiptName("");
        fetchData();
      } else {
        setToast({
          message: result.error || "No se pudo guardar el gasto.",
          type: "error",
        });
      }
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo leer el comprobante.",
        type: "error",
      });
    } finally {
      setIsSavingExpense(false);
    }
  };

  const closeExpensePaymentDialog = () => {
    setExpensePaymentAction(null);
    setExpensePaymentNote("");
  };

  const handleMarkExpensePaid = async () => {
    if (!expensePaymentAction) return;

    setIsSavingExpense(true);
    const res = await apiWrite.request(
      `/api/finance/expenses/${expensePaymentAction.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_status: "paid",
          paid_at: new Date().toISOString().slice(0, 10),
          payment_method: expensePaymentAction.payment_method || "transfer",
          notes: expensePaymentNote,
        }),
      },
    );
    const result = await res.json();
    if (res.ok) {
      setToast({ message: "Gasto marcado como pagado.", type: "success" });
      closeExpensePaymentDialog();
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo actualizar el gasto.",
        type: "error",
      });
    }
    setIsSavingExpense(false);
  };

  const handleApproveExpense = async (
    expense: Expense,
    approval_status: "approved" | "rejected",
  ) => {
    const note = window.prompt(
      approval_status === "approved"
        ? "Motivo de aprobación del gasto"
        : "Motivo de rechazo del gasto",
    );
    if (!note?.trim()) {
      setToast({
        message: "Debes ingresar una nota para cambiar aprobación.",
        type: "error",
      });
      return;
    }

    setIsSavingExpense(true);
    const res = await apiWrite.request(
      `/api/finance/expenses/${expense.id}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_status, note: note.trim() }),
      },
    );
    const result = await res.json();
    if (res.ok) {
      setToast({
        message:
          approval_status === "approved"
            ? "Gasto aprobado."
            : "Gasto rechazado.",
        type: "success",
      });
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo actualizar la aprobación.",
        type: "error",
      });
    }
    setIsSavingExpense(false);
  };

  const handleReconcileExpenseMovement = async (movement: BankMovement) => {
    if (!reconcilingExpense) return;

    setIsReconcilingExpense(true);
    const res = await apiWrite.request(
      `/api/finance/expenses/${reconcilingExpense.id}/reconcile-bank`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_movement_id: movement.id,
          note: `Gasto conciliado desde cartola: ${movement.description}`,
        }),
      },
    );
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: "Gasto conciliado con cartola bancaria.",
        type: "success",
      });
      setReconcilingExpense(null);
      setExpenseMovementSuggestions([]);
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo conciliar el gasto.",
        type: "error",
      });
    }
    setIsReconcilingExpense(false);
  };

  const resetExpenseReview = () => {
    setExpenseReviewFilter("all");
    setExpenseReportMonth(null);
    setExpenseReportMonthField("any");
  };

  const openExpenseDrawer = (expense?: Expense) => {
    setEditingExpense(expense || null);
    setSelectedExpenseReceiptName("");
    setIsExpenseDrawerOpen(true);
  };

  const closeExpenseDrawer = () => {
    setIsExpenseDrawerOpen(false);
    setEditingExpense(null);
    setSelectedExpenseReceiptName("");
  };

  const closeExpenseReconcileDrawer = () => {
    setReconcilingExpense(null);
    setExpenseMovementSuggestions([]);
  };
  return {
    openExpenseDrawerById,
    handleSaveExpense,
    closeExpensePaymentDialog,
    handleMarkExpensePaid,
    handleApproveExpense,
    handleReconcileExpenseMovement,
    resetExpenseReview,
    openExpenseDrawer,
    closeExpenseDrawer,
    closeExpenseReconcileDrawer,
  };
}
