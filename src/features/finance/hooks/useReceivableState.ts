import { useState } from "react";

import { Payment, PaymentAllocation } from "../../../types";

import type { PaymentReviewFilter, PaymentReportMonthField, PaymentDetail } from "../pages/financeShared";
export function useReceivableState() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetail | null>(
    null,
  );
  const [adjustmentPayment, setAdjustmentPayment] = useState<Payment | null>(
    null,
  );
  const [allocationPayment, setAllocationPayment] = useState<Payment | null>(
    null,
  );
  const [reverseAllocation, setReverseAllocation] =
    useState<PaymentAllocation | null>(null);
  const [historyPayment, setHistoryPayment] = useState<Payment | null>(null);
  const [paymentAllocationHistory, setPaymentAllocationHistory] = useState<
    PaymentAllocation[]
  >([]);
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [isReversingAllocation, setIsReversingAllocation] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [paymentReviewFilter, setPaymentReviewFilter] =
    useState<PaymentReviewFilter>("all");
  const [paymentReportMonth, setPaymentReportMonth] = useState<string | null>(
    null,
  );
  const [paymentReportMonthField, setPaymentReportMonthField] =
    useState<PaymentReportMonthField>("any");
  return {
    isDrawerOpen,
    setIsDrawerOpen,
    selectedPayment,
    setSelectedPayment,
    paymentDetail,
    setPaymentDetail,
    adjustmentPayment,
    setAdjustmentPayment,
    allocationPayment,
    setAllocationPayment,
    reverseAllocation,
    setReverseAllocation,
    historyPayment,
    setHistoryPayment,
    paymentAllocationHistory,
    setPaymentAllocationHistory,
    isSavingAdjustment,
    setIsSavingAdjustment,
    isAllocating,
    setIsAllocating,
    isReversingAllocation,
    setIsReversingAllocation,
    paymentSearch,
    setPaymentSearch,
    paymentStatus,
    setPaymentStatus,
    paymentReviewFilter,
    setPaymentReviewFilter,
    paymentReportMonth,
    setPaymentReportMonth,
    paymentReportMonthField,
    setPaymentReportMonthField,
  };
}
