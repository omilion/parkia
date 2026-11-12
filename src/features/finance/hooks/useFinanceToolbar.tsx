import { useReceivableState } from "./useReceivableState";
import { useBankState } from "./useBankState";

import React from "react";

import { Download, FileText, RefreshCw, UploadCloud } from "lucide-react";
import { Expense } from "../../../types";

import { cn } from "../../../lib/utils";

import type { SiiReadiness } from "../pages/financeShared";

export type Dependencies_useFinanceToolbar = {
  activeTab:
    | "payments"
    | "invoices"
    | "expenses"
    | "collections"
    | "cgvc"
    | "reports"
    | "closures";
  downloadFile: (url: string, fileName: string) => Promise<void>;
  getBankMovementExportName: () => string;
  getBankMovementExportParams: () => string;
  handleImportBankMovements: (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => Promise<void>;
  handleSyncBank: () => Promise<void>;
  isImportingBank: ReturnType<typeof useBankState>["isImportingBank"];
  isSyncing: ReturnType<typeof useBankState>["isSyncing"];
  openExpenseDrawer: (expense?: Expense) => void;
  paymentStatus: ReturnType<typeof useReceivableState>["paymentStatus"];
  refreshInvoices: () => Promise<void>;
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
  siiReadiness: SiiReadiness;
  withBranch: (url: string) => string;
};
export function useFinanceToolbar(
  dependencies: Dependencies_useFinanceToolbar,
) {
  const {
    activeTab,
    downloadFile,
    getBankMovementExportName,
    getBankMovementExportParams,
    handleImportBankMovements,
    handleSyncBank,
    isImportingBank,
    isSyncing,
    openExpenseDrawer,
    paymentStatus,
    refreshInvoices,
    setToast,
    siiReadiness,
    withBranch,
  } = dependencies;
  const renderTabActions = () => {
    if (activeTab === "payments") {
      return (
        <button
          onClick={() =>
            downloadFile(
              withBranch(
                `/api/finance/export/payments.xlsx${paymentStatus === "all" ? "" : `?status=${paymentStatus}`}`,
              ),
              paymentStatus === "all"
                ? "cuentas-por-cobrar.xlsx"
                : `cuentas-por-cobrar-${paymentStatus}.xlsx`,
            )
          }
          className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
        >
          <Download className="w-4 h-4" />
          Exportar Cuentas
        </button>
      );
    }

    if (activeTab === "expenses") {
      return (
        <>
          <button
            onClick={() =>
              downloadFile(
                withBranch("/api/finance/export/expenses.xlsx"),
                "gastos.xlsx",
              )
            }
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <Download className="w-4 h-4" />
            Exportar Gastos
          </button>
          <button
            onClick={() => openExpenseDrawer()}
            className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
          >
            <FileText className="w-4 h-4" />
            Nuevo Gasto
          </button>
        </>
      );
    }

    if (activeTab === "cgvc") {
      return (
        <>
          <label
            className={cn(
              "px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all",
              isImportingBank && "opacity-50 pointer-events-none",
            )}
          >
            <UploadCloud className="w-4 h-4" />
            Importar CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleImportBankMovements}
              disabled={isImportingBank}
            />
          </label>
          <button
            onClick={handleSyncBank}
            disabled={isSyncing}
            className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
            Conciliar Importados
          </button>
          <button
            onClick={() =>
              downloadFile(
                withBranch(
                  `/api/finance/export/bank-movements.xlsx${getBankMovementExportParams()}`,
                ),
                getBankMovementExportName(),
              )
            }
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <Download className="w-4 h-4" />
            Exportar Cola
          </button>
        </>
      );
    }

    if (activeTab === "invoices") {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              "rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-wider",
              siiReadiness?.mode === "disabled"
                ? "bg-slate-100 text-slate-600"
                : siiReadiness?.ready
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700",
            )}
          >
            {siiReadiness?.mode === "real"
              ? "Proveedor real no implementado"
              : siiReadiness?.mode === "disabled"
                ? "SII deshabilitado"
                : "Mock local, sin envío real"}
          </span>
          <button
            onClick={() =>
              refreshInvoices().catch(() =>
                setToast({
                  message: "No se pudo actualizar el estado DTE.",
                  type: "error",
                }),
              )
            }
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar estado DTE
          </button>
        </div>
      );
    }

    return null;
  };
  return { renderTabActions };
}
