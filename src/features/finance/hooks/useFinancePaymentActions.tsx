import { useApiMutation } from "../../../lib/useApiMutation";
import { useReceivableState } from "./useReceivableState";

import React from "react";

import { Payment } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import type { PaymentDetail } from "../pages/financeShared";
import type { PaymentAdjustmentValues } from "../../../../shared/schemas/finance";

export type Dependencies_useFinancePaymentActions = {
  adjustmentPayment: ReturnType<typeof useReceivableState>["adjustmentPayment"];
  fetchData: () => Promise<void>;
  focusedQueryRef: any;
  paymentDetail: ReturnType<typeof useReceivableState>["paymentDetail"];
  payments: Payment[];
  setAdjustmentPayment: ReturnType<
    typeof useReceivableState
  >["setAdjustmentPayment"];
  setAllocationPayment: ReturnType<
    typeof useReceivableState
  >["setAllocationPayment"];
  setHistoryPayment: ReturnType<typeof useReceivableState>["setHistoryPayment"];
  setIsDrawerOpen: ReturnType<typeof useReceivableState>["setIsDrawerOpen"];
  setIsSavingAdjustment: ReturnType<
    typeof useReceivableState
  >["setIsSavingAdjustment"];
  setPaymentDetail: ReturnType<typeof useReceivableState>["setPaymentDetail"];
  setPaymentReportMonth: ReturnType<
    typeof useReceivableState
  >["setPaymentReportMonth"];
  setPaymentReportMonthField: ReturnType<
    typeof useReceivableState
  >["setPaymentReportMonthField"];
  setPaymentReviewFilter: ReturnType<
    typeof useReceivableState
  >["setPaymentReviewFilter"];
  setReverseAllocation: ReturnType<
    typeof useReceivableState
  >["setReverseAllocation"];
  setSelectedPayment: ReturnType<
    typeof useReceivableState
  >["setSelectedPayment"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useFinancePaymentActions(
  dependencies: Dependencies_useFinancePaymentActions,
) {
  const {
    adjustmentPayment,
    fetchData,
    focusedQueryRef,
    paymentDetail,
    payments,
    setAdjustmentPayment,
    setAllocationPayment,
    setHistoryPayment,
    setIsDrawerOpen,
    setIsSavingAdjustment,
    setPaymentDetail,
    setPaymentReportMonth,
    setPaymentReportMonthField,
    setPaymentReviewFilter,
    setReverseAllocation,
    setSelectedPayment,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinancePaymentActions");
  const openPaymentDetail = async (payment: Payment) => {
    setPaymentDetail({
      payment,
      adjustments: [],
      allocations: [],
      collectionActions: [],
      invoices: [],
    });
    try {
      const detail = await apiFetchJson<PaymentDetail>(
        `/api/finance/payments/${payment.id}/detail`,
      );
      setPaymentDetail(detail);
    } catch (error: any) {
      setToast({
        message:
          error.message || "No se pudo cargar la ficha de cuenta por cobrar",
        type: "error",
      });
    }
  };

  const openPaymentDetailById = async (paymentId: number) => {
    const payment = payments.find((item) => item.id === paymentId);
    if (payment) {
      await openPaymentDetail(payment);
      return;
    }

    try {
      const detail = await apiFetchJson<PaymentDetail>(
        `/api/finance/payments/${paymentId}/detail`,
      );
      setPaymentDetail(detail);
    } catch (error: any) {
      focusedQueryRef.current = "";
      setToast({
        message: error.message || "No se pudo abrir el pago solicitado",
        type: "error",
      });
    }
  };

  const handleCreatePaymentAdjustment = async (
    values: PaymentAdjustmentValues,
  ) => {
    if (!adjustmentPayment) return;

    setIsSavingAdjustment(true);
    const res = await apiWrite.request(
      `/api/finance/payments/${adjustmentPayment.id}/adjustments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    const result = await res.json();

    if (res.ok) {
      setToast({
        message: "Ajuste financiero registrado con motivo.",
        type: "success",
      });
      setAdjustmentPayment(null);
      await fetchData();
      if (paymentDetail?.payment.id === adjustmentPayment.id) {
        await openPaymentDetail({
          ...adjustmentPayment,
          amount: result.adjustment.newAmount,
          status: result.adjustment.status,
        });
      }
    } else {
      setToast({
        message: result.error || "No se pudo registrar el ajuste.",
        type: "error",
      });
    }
    setIsSavingAdjustment(false);
  };

  const resetPaymentReview = () => {
    setPaymentReviewFilter("all");
    setPaymentReportMonth(null);
    setPaymentReportMonthField("any");
  };

  const closePaymentDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedPayment(null);
  };

  const closePaymentDetailDrawer = () => {
    setPaymentDetail(null);
  };

  const closeAdjustmentDrawer = () => {
    setAdjustmentPayment(null);
  };

  const closeAllocationDrawer = () => {
    setAllocationPayment(null);
  };

  const closeHistoryDrawer = () => {
    setHistoryPayment(null);
  };

  const closeReverseDrawer = () => {
    setReverseAllocation(null);
  };
  return {
    openPaymentDetail,
    openPaymentDetailById,
    handleCreatePaymentAdjustment,
    resetPaymentReview,
    closePaymentDrawer,
    closePaymentDetailDrawer,
    closeAdjustmentDrawer,
    closeAllocationDrawer,
    closeHistoryDrawer,
    closeReverseDrawer,
  };
}
