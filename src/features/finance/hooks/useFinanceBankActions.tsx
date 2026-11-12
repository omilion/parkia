import { useApiMutation } from "../../../lib/useApiMutation";
import { useReceivableState } from "./useReceivableState";
import { useBankState } from "./useBankState";

import React from "react";

import { Payment, PaymentAllocation } from "../../../types";

import { formatIssuedDteMessage } from "../pages/financeShared";
import type { AllocateMovementValues, BankMovementFormValues, ReverseAllocationValues } from "../../../../shared/schemas/finance";

export type Dependencies_useFinanceBankActions = {
  allocationPayment: ReturnType<typeof useReceivableState>["allocationPayment"];
  editingMovement: ReturnType<typeof useBankState>["editingMovement"];
  fetchData: () => Promise<void>;
  fileToBase64: (file: File) => Promise<string>;
  historyPayment: ReturnType<typeof useReceivableState>["historyPayment"];
  isReversingAllocation: ReturnType<
    typeof useReceivableState
  >["isReversingAllocation"];
  movementStatus: ReturnType<typeof useBankState>["movementStatus"];
  reverseAllocation: ReturnType<typeof useReceivableState>["reverseAllocation"];
  selectedBranchId: string;
  selectedMovement: ReturnType<typeof useBankState>["selectedMovement"];
  setAllocationPayment: ReturnType<
    typeof useReceivableState
  >["setAllocationPayment"];
  setEditingMovement: ReturnType<typeof useBankState>["setEditingMovement"];
  setIsAllocating: ReturnType<typeof useReceivableState>["setIsAllocating"];
  setIsImportingBank: ReturnType<typeof useBankState>["setIsImportingBank"];
  setIsReconciling: ReturnType<typeof useBankState>["setIsReconciling"];
  setIsReversingAllocation: ReturnType<
    typeof useReceivableState
  >["setIsReversingAllocation"];
  setIsSyncing: ReturnType<typeof useBankState>["setIsSyncing"];
  setIsUpdatingMovement: ReturnType<
    typeof useBankState
  >["setIsUpdatingMovement"];
  setMovementAllocationHistory: ReturnType<
    typeof useBankState
  >["setMovementAllocationHistory"];
  setMovementStatus: ReturnType<typeof useBankState>["setMovementStatus"];
  setPaymentAllocationHistory: ReturnType<
    typeof useReceivableState
  >["setPaymentAllocationHistory"];
  setReverseAllocation: ReturnType<
    typeof useReceivableState
  >["setReverseAllocation"];
  setSelectedMovement: ReturnType<typeof useBankState>["setSelectedMovement"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useFinanceBankActions(
  dependencies: Dependencies_useFinanceBankActions,
) {
  const {
    allocationPayment,
    editingMovement,
    fetchData,
    fileToBase64,
    historyPayment,
    isReversingAllocation,
    movementStatus,
    reverseAllocation,
    selectedBranchId,
    selectedMovement,
    setAllocationPayment,
    setEditingMovement,
    setIsAllocating,
    setIsImportingBank,
    setIsReconciling,
    setIsReversingAllocation,
    setIsSyncing,
    setIsUpdatingMovement,
    setMovementAllocationHistory,
    setMovementStatus,
    setPaymentAllocationHistory,
    setReverseAllocation,
    setSelectedMovement,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinanceBankActions");
  const fetchAllocationHistory = async (params: URLSearchParams) => {
    const res = await fetch(
      `/api/finance/payment-allocations?${params.toString()}`,
    );
    if (!res.ok) throw new Error("No se pudo cargar el historial");
    return res.json() as Promise<PaymentAllocation[]>;
  };

  const handleSyncBank = async () => {
    setIsSyncing(true);
    const res = await apiWrite.request("/api/finance/sync-bank", {
      method: "POST",
    });
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: `${result.message || "Conciliacion automatica ejecutada sobre cartola importada."} ${result.count} conciliados y ${result.unmatched ?? 0} pendientes para revisión.`,
        type: "success",
      });
      setMovementStatus("pending");
      setSelectedMovement(null);
      fetchData();
    } else {
      setToast({
        message: result.error || "Error al conciliar cartola importada",
        type: "error",
      });
    }
    setIsSyncing(false);
  };

  const handleImportBankMovements = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setToast({
        message: "La cartola debe cargarse en formato CSV",
        type: "error",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setToast({ message: "La cartola no puede superar 2MB", type: "error" });
      return;
    }

    setIsImportingBank(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await apiWrite.request("/api/finance/bank-movements/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          dataBase64,
          branch_id:
            selectedBranchId === "all" ? null : Number(selectedBranchId),
        }),
      });
      const result = await res.json();

      if (res.ok) {
        setToast({
          message: `Cartola importada: ${result.imported} nuevos, ${result.duplicated} duplicados, ${result.skipped} omitidos.`,
          type: "success",
        });
        setMovementStatus("pending");
        fetchData();
      } else {
        setToast({
          message: result.error || "No se pudo importar la cartola",
          type: "error",
        });
      }
    } catch {
      setToast({
        message: "No se pudo leer la cartola bancaria",
        type: "error",
      });
    } finally {
      setIsImportingBank(false);
    }
  };

  const handleManualReconcile = async (payment: Payment) => {
    if (!selectedMovement) return;

    setIsReconciling(true);
    const res = await apiWrite.request(
      `/api/finance/bank-movements/${selectedMovement.id}/reconcile`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_id: payment.id,
          note: "Vinculación manual desde finanzas",
        }),
      },
    );

    const result = await res.json();
    if (res.ok) {
      setToast({
        message: `Movimiento conciliado. ${formatIssuedDteMessage(result)}.`,
        type: "success",
      });
      setSelectedMovement(null);
      fetchData();
    } else {
      setToast({
        message: result.error || "Error al conciliar movimiento",
        type: "error",
      });
    }
    setIsReconciling(false);
  };

  const handleAllocateMovement = async (values: AllocateMovementValues) => {
    if (!selectedMovement || !allocationPayment) return;

    setIsAllocating(true);
    const res = await apiWrite.request(
      `/api/finance/bank-movements/${selectedMovement.id}/allocate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: allocationPayment.id, ...values }),
      },
    );
    const result = await res.json();

    if (res.ok) {
      setToast({
        message: result.paymentFullyPaid
          ? `Abono aplicado y pago completado. ${formatIssuedDteMessage(result)}.`
          : "Abono parcial aplicado. El pago queda con saldo pendiente.",
        type: "success",
      });
      setAllocationPayment(null);
      setSelectedMovement(null);
      setMovementStatus(result.movementStatus || "partial");
      fetchData();
    } else {
      setToast({
        message: result.error || "No se pudo aplicar el abono",
        type: "error",
      });
    }
    setIsAllocating(false);
  };

  const refreshAllocationHistoryPanels = async () => {
    await fetchData();
    if (selectedMovement) {
      fetchAllocationHistory(
        new URLSearchParams({ bank_movement_id: String(selectedMovement.id) }),
      )
        .then(setMovementAllocationHistory)
        .catch(() => setMovementAllocationHistory([]));
    }
    if (historyPayment) {
      fetchAllocationHistory(
        new URLSearchParams({ payment_id: String(historyPayment.id) }),
      )
        .then(setPaymentAllocationHistory)
        .catch(() => setPaymentAllocationHistory([]));
    }
  };

  const handleReverseAllocation = async ({ note }: ReverseAllocationValues) => {
    if (
      !reverseAllocation ||
      reverseAllocation.reversed_at ||
      isReversingAllocation
    )
      return;

    setIsReversingAllocation(true);
    const res = await apiWrite.request(
      `/api/finance/payment-allocations/${reverseAllocation.id}/reverse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      },
    );
    const result = await res.json();

    if (res.ok) {
      setToast({
        message: "Abono reversado y saldos recalculados.",
        type: "success",
      });
      setReverseAllocation(null);
      await refreshAllocationHistoryPanels();
    } else {
      setToast({
        message: result.error || "No se pudo reversar el abono.",
        type: "error",
      });
    }
    setIsReversingAllocation(false);
  };

  const handleUpdateMovement = async (values: BankMovementFormValues) => {
    if (!editingMovement) return;

    setIsUpdatingMovement(true);
    const res = await apiWrite.request(
      `/api/finance/bank-movements/${editingMovement.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );

    if (res.ok) {
      setToast({
        message: "Movimiento actualizado para revisión manual.",
        type: "success",
      });
      setEditingMovement(null);
      setSelectedMovement(null);
      fetchData();
    } else {
      const result = await res.json();
      setToast({
        message: result.error || "No se pudo actualizar el movimiento",
        type: "error",
      });
    }
    setIsUpdatingMovement(false);
  };

  /** Recibe la nota de revisión que el usuario escribió en el formulario del movimiento. */
  const handleMarkMovementPartial = async (rawNote: string | null | undefined) => {
    if (!editingMovement) return;

    const note = String(rawNote || "").trim();
    if (note.length < 3) {
      setToast({
        message: "Agrega una nota para marcar el movimiento como parcial.",
        type: "error",
      });
      return;
    }

    setIsUpdatingMovement(true);
    const res = await apiWrite.request(
      `/api/finance/bank-movements/${editingMovement.id}/mark-partial`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      },
    );

    if (res.ok) {
      setToast({
        message: "Movimiento marcado como parcial con nota de seguimiento.",
        type: "success",
      });
      setEditingMovement(null);
      setSelectedMovement(null);
      setMovementStatus("partial");
      fetchData();
    } else {
      const result = await res.json();
      setToast({
        message: result.error || "No se pudo marcar como parcial",
        type: "error",
      });
    }
    setIsUpdatingMovement(false);
  };

  const getBankMovementExportParams = () => {
    if (movementStatus === "all") return "";
    if (movementStatus === "attention") return "?status=pending&status=partial";
    return `?status=${movementStatus}`;
  };

  const getBankMovementExportName = () => {
    if (movementStatus === "all") return "cartola-bancaria.xlsx";
    return `cartola-bancaria-${movementStatus}.xlsx`;
  };
  return {
    fetchAllocationHistory,
    handleSyncBank,
    handleImportBankMovements,
    handleManualReconcile,
    handleAllocateMovement,
    refreshAllocationHistoryPanels,
    handleReverseAllocation,
    handleUpdateMovement,
    handleMarkMovementPartial,
    getBankMovementExportParams,
    getBankMovementExportName,
  };
}
