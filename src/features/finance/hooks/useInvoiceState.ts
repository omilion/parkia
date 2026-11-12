import { useState } from "react";

export function useInvoiceState() {
  const [invoiceStatus, setInvoiceStatus] = useState<
    "all" | "pending" | "accepted" | "rejected"
  >("all");
  const [invoiceActionId, setInvoiceActionId] = useState<number | null>(null);
  return {
    invoiceStatus,
    setInvoiceStatus,
    invoiceActionId,
    setInvoiceActionId,
  };
}
