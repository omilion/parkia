import { useApiMutation } from "../../../lib/useApiMutation";

import { useInvoiceState } from "./useInvoiceState";

import { Invoice } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import { formatDteType } from "../pages/financeShared";
import type { SiiReadiness } from "../pages/financeShared";

export type Dependencies_useFinanceInvoiceActions = {
  setInvoiceActionId: ReturnType<typeof useInvoiceState>["setInvoiceActionId"];
  setInvoices: (value: Invoice[]) => void;
  setSiiReadiness: (value: SiiReadiness | null) => void;
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
  withBranch: (url: string) => string;
};
export function useFinanceInvoiceActions(
  dependencies: Dependencies_useFinanceInvoiceActions,
) {
  const {
    setInvoiceActionId,
    setInvoices,
    setSiiReadiness,
    setToast,
    withBranch,
  } = dependencies;
  const apiWrite = useApiMutation("finance/useFinanceInvoiceActions");
  const refreshInvoices = async () => {
    const [invoiceData, readinessData] = await Promise.all([
      apiFetchJson<Invoice[]>(withBranch("/api/finance/invoices")),
      apiFetchJson<SiiReadiness>("/api/finance/invoices/readiness"),
    ]);
    setInvoices(invoiceData || []);
    setSiiReadiness(readinessData);
  };

  const handleIssueInvoice = async (invoice: Invoice) => {
    setInvoiceActionId(invoice.id);
    try {
      await apiWrite.json(`/api/finance/invoices/${invoice.id}/issue`, {
        method: "POST",
      });
      setToast({
        message: `${formatDteType(invoice.type, true)} folio #${invoice.folio} procesado en mock local; no acredita aceptación real del SII.`,
        type: "success",
      });
      await refreshInvoices();
    } catch (error: any) {
      setToast({
        message:
          error.message || "No se pudo procesar el documento tributario.",
        type: "error",
      });
      await refreshInvoices().catch(() => undefined);
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleSyncInvoice = async (invoice: Invoice) => {
    setInvoiceActionId(invoice.id);
    try {
      await apiWrite.json(`/api/finance/invoices/${invoice.id}/sync`, {
        method: "POST",
      });
      setToast({
        message: `Estado DTE/proveedor actualizado para folio #${invoice.folio}.`,
        type: "success",
      });
      await refreshInvoices();
    } catch (error: any) {
      setToast({
        message:
          error.message || "No se pudo sincronizar el documento tributario.",
        type: "error",
      });
    } finally {
      setInvoiceActionId(null);
    }
  };

  const downloadInvoiceFile = (invoice: Invoice, format: "pdf" | "xml") => {
    window.location.href = `/api/finance/invoices/${invoice.id}/${format}`;
  };
  return {
    refreshInvoices,
    handleIssueInvoice,
    handleSyncInvoice,
    downloadInvoiceFile,
  };
}
