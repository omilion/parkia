import { useFinanceSelectors } from "./useFinanceSelectors";
import {
  useFinanceBankActions,
  type Dependencies_useFinanceBankActions,
} from "./useFinanceBankActions";
import {
  useFinancePaymentActions,
  type Dependencies_useFinancePaymentActions,
} from "./useFinancePaymentActions";
import {
  useFinanceCollectionActions,
  type Dependencies_useFinanceCollectionActions,
} from "./useFinanceCollectionActions";
import {
  useFinanceExpenseActions,
  type Dependencies_useFinanceExpenseActions,
} from "./useFinanceExpenseActions";
import {
  useFinanceReportActions,
  type Dependencies_useFinanceReportActions,
} from "./useFinanceReportActions";
import {
  useFinanceInvoiceActions,
  type Dependencies_useFinanceInvoiceActions,
} from "./useFinanceInvoiceActions";
import {
  useFinanceToolbar,
  type Dependencies_useFinanceToolbar,
} from "./useFinanceToolbar";

import { useReceivableState } from "./useReceivableState";
import { useBankState } from "./useBankState";
import { useExpenseState } from "./useExpenseState";
import { useCollectionState } from "./useCollectionState";
import { useReportState } from "./useReportState";
import { useInvoiceState } from "./useInvoiceState";
import { useFinanceData } from "./useFinanceData";
import React, { useEffect, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { financePaths, financeTabFromPath } from "../pages/financeRoutes";

import { StaffUser } from "../../../types";

import { apiFetchJson } from "../../../lib/api";

import type { FinanceTab, TaskAssignee } from "../pages/financeShared";
export function useFinanceController(user: StaffUser) {
  const isAdmin = user.role === "admin";
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = financeTabFromPath(location.pathname);
  const setActiveTab = (tab: FinanceTab) => {
    if (tab !== activeTab) navigate(`${financePaths[tab]}${location.search}`);
  };
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const receivableState = useReceivableState();
  const {
    historyPayment,
    setPaymentAllocationHistory,
    setPaymentSearch,
    setPaymentStatus,
  } = receivableState;
  const bankState = useBankState();
  const {
    selectedMovement,
    setSelectedMovement,
    setEditingMovement,
    setMovementAllocationHistory,
    setMovementSuggestions,
    movementStatus,
    setMovementStatus,
  } = bankState;
  const expenseState = useExpenseState();
  const {
    reconcilingExpense,
    setExpenseMovementSuggestions,
    expenseStatus,
    setExpenseStatus,
    setExpenseCategory,
    expenseDueFilter,
    setExpenseDueFilter,
  } = expenseState;
  const collectionState = useCollectionState();
  const {
    collectionPayment,
    setCollectionActions,
    collectionQueueStatus,
    setCollectionQueueStatus,
    collectionQueueDue,
    setCollectionQueueDue,
  } = collectionState;
  const reportState = useReportState();
  const { setReportMonth } = reportState;
  const invoiceState = useInvoiceState();

  const [taskAssignees, setTaskAssignees] = useState<TaskAssignee[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const focusedQueryRef = React.useRef("");
  const financeData = useFinanceData({
    ...expenseState,
    ...collectionState,
    ...reportState,
    activeTab,
    selectedBranchId,
  });
  const {
    payments,
    expenses,
    fetchData,
    setInvoices,
    setExpenses,
    setSiiReadiness,
  } = financeData;

  const fileToReceipt = (file: File) =>
    new Promise<{ fileName: string; mimeType: string; dataBase64: string }>(
      (resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result);
          resolve({
            fileName: file.name,
            mimeType: file.type,
            dataBase64: result.includes(",") ? result.split(",")[1] : result,
          });
        };
        reader.onerror = () =>
          reject(new Error("No se pudo leer el comprobante"));
        reader.readAsDataURL(file);
      },
    );

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
      reader.readAsDataURL(file);
    });

  const withBranch = (url: string) => {
    if (selectedBranchId === "all") return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}branch_id=${selectedBranchId}`;
  };

  useEffect(() => {
    apiFetchJson<TaskAssignee[]>("/api/tasks/assignees")
      .then(setTaskAssignees)
      .catch(() => setTaskAssignees([]));
  }, []);

  useEffect(() => {
    const nextReportMonth = searchParams.get("month");
    if (/^\d{4}-\d{2}$/.test(nextReportMonth || "")) {
      setReportMonth(nextReportMonth as string);
    }

    const nextExpenseStatus = searchParams.get("expenseStatus");
    if (
      ["all", "pending", "paid", "overdue", "cancelled"].includes(
        nextExpenseStatus || "",
      )
    ) {
      setExpenseStatus(nextExpenseStatus as typeof expenseStatus);
    }
    const nextExpenseDue = searchParams.get("expenseDue");
    if (
      ["all", "overdue", "today", "upcoming"].includes(nextExpenseDue || "")
    ) {
      setExpenseDueFilter(nextExpenseDue as typeof expenseDueFilter);
    }
    const nextCollectionStatus = searchParams.get("collectionStatus");
    if (["open", "done", "all"].includes(nextCollectionStatus || "")) {
      setCollectionQueueStatus(
        nextCollectionStatus as typeof collectionQueueStatus,
      );
    }
    const nextCollectionDue = searchParams.get("collectionDue");
    if (
      ["all", "overdue", "today", "upcoming", "actionable"].includes(
        nextCollectionDue || "",
      )
    ) {
      setCollectionQueueDue(nextCollectionDue as typeof collectionQueueDue);
    }
    const nextMovementStatus = searchParams.get("movementStatus");
    if (
      ["all", "attention", "pending", "partial", "reconciled"].includes(
        nextMovementStatus || "",
      )
    ) {
      setMovementStatus(nextMovementStatus as typeof movementStatus);
    }
    const nextPaymentStatus = searchParams.get("paymentStatus");
    if (
      ["all", "pending", "paid", "overdue", "cancelled"].includes(
        nextPaymentStatus || "",
      )
    ) {
      setPaymentStatus(nextPaymentStatus);
    }
  }, [searchParams]);

  const copyText = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      setToast({
        message: `${label} no disponible para este cliente.`,
        type: "error",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: `${label} copiado.`, type: "success" });
    } catch {
      setToast({
        message: `No se pudo copiar ${label.toLowerCase()}.`,
        type: "error",
      });
    }
  };

  useEffect(() => {
    if (!selectedMovement) {
      setMovementSuggestions([]);
      setMovementAllocationHistory([]);
      return;
    }

    let cancelled = false;
    Promise.all([
      fetch(`/api/finance/bank-movements/${selectedMovement.id}/suggestions`)
        .then(async (res) => (res.ok ? res.json() : { suggestions: [] }))
        .catch(() => ({ suggestions: [] })),
      fetchAllocationHistory(
        new URLSearchParams({ bank_movement_id: String(selectedMovement.id) }),
      ).catch(() => []),
    ]).then(([suggestionsResult, allocations]) => {
      if (cancelled) return;
      setMovementSuggestions(suggestionsResult.suggestions || []);
      setMovementAllocationHistory(allocations);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedMovement]);

  useEffect(() => {
    if (!historyPayment) {
      setPaymentAllocationHistory([]);
      return;
    }

    let cancelled = false;
    fetchAllocationHistory(
      new URLSearchParams({ payment_id: String(historyPayment.id) }),
    )
      .then((allocations) => {
        if (!cancelled) setPaymentAllocationHistory(allocations);
      })
      .catch(() => {
        if (!cancelled) setPaymentAllocationHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [historyPayment]);

  useEffect(() => {
    if (!collectionPayment) {
      setCollectionActions([]);
      return;
    }

    let cancelled = false;
    fetchCollectionActions(collectionPayment.id)
      .then((actions) => {
        if (!cancelled) setCollectionActions(actions);
      })
      .catch(() => {
        if (!cancelled) setCollectionActions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionPayment]);

  useEffect(() => {
    if (!reconcilingExpense) {
      setExpenseMovementSuggestions([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/finance/expenses/${reconcilingExpense.id}/bank-suggestions`)
      .then(async (res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((result) => {
        if (!cancelled) setExpenseMovementSuggestions(result.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setExpenseMovementSuggestions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reconcilingExpense]);

  const downloadFile = async (url: string, fileName: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo generar el archivo");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo descargar el archivo",
        type: "error",
      });
    }
  };

  const financeSelectors = useFinanceSelectors({
    ...receivableState,
    ...bankState,
    ...expenseState,
    ...reportState,
    ...invoiceState,
    ...financeData,
  });
  const { filteredMovements } = financeSelectors;

  const handleTabChange = (tabId: FinanceTab) => navigate(financePaths[tabId]);

  useEffect(() => {
    if (
      selectedMovement &&
      !filteredMovements.some((movement) => movement.id === selectedMovement.id)
    ) {
      setSelectedMovement(null);
    }
  }, [filteredMovements, selectedMovement]);

  const closeMovementDrawer = () => {
    setEditingMovement(null);
  };

  useEffect(() => {
    const paymentId = Number(searchParams.get("paymentId") || 0);
    const expenseId = Number(searchParams.get("expenseId") || 0);
    if (!(paymentId > 0) && !(expenseId > 0)) {
      focusedQueryRef.current = "";
      return;
    }

    if (paymentId > 0) {
      const key = `payment:${paymentId}`;
      if (focusedQueryRef.current === key) return;
      focusedQueryRef.current = key;
      setActiveTab("payments");
      setPaymentSearch("");
      setPaymentStatus("all");
      resetPaymentReview();
      openPaymentDetailById(paymentId);
      return;
    }

    if (expenseId > 0) {
      const key = `expense:${expenseId}`;
      if (focusedQueryRef.current === key) return;
      focusedQueryRef.current = key;
      setActiveTab("expenses");
      setExpenseStatus("all");
      setExpenseCategory("all");
      setExpenseDueFilter("all");
      resetExpenseReview();
      openExpenseDrawerById(expenseId);
    }
  }, [searchParams, payments, expenses]);

  const financeBankActions = useFinanceBankActions({
    ...receivableState,
    ...bankState,
    fetchData: (
      ...args: Parameters<Dependencies_useFinanceBankActions["fetchData"]>
    ) => fetchData(...args),
    fileToBase64: (
      ...args: Parameters<Dependencies_useFinanceBankActions["fileToBase64"]>
    ) => fileToBase64(...args),
    selectedBranchId,
    setToast,
  });
  const {
    fetchAllocationHistory,
    handleSyncBank,
    handleImportBankMovements,
    getBankMovementExportParams,
    getBankMovementExportName,
  } = financeBankActions;
  const financePaymentActions = useFinancePaymentActions({
    ...receivableState,
    ...financeData,
    fetchData: (
      ...args: Parameters<Dependencies_useFinancePaymentActions["fetchData"]>
    ) => fetchData(...args),
    focusedQueryRef,
    setToast,
  });
  const { openPaymentDetailById, resetPaymentReview } = financePaymentActions;
  const financeCollectionActions = useFinanceCollectionActions({
    ...collectionState,
    copyText: (
      ...args: Parameters<Dependencies_useFinanceCollectionActions["copyText"]>
    ) => copyText(...args),
    fetchData: (
      ...args: Parameters<Dependencies_useFinanceCollectionActions["fetchData"]>
    ) => fetchData(...args),
    setToast,
    taskAssignees,
    user,
  });
  const { fetchCollectionActions } = financeCollectionActions;
  const financeExpenseActions = useFinanceExpenseActions({
    ...expenseState,
    ...financeData,
    fetchData: (
      ...args: Parameters<Dependencies_useFinanceExpenseActions["fetchData"]>
    ) => fetchData(...args),
    fileToReceipt: (
      ...args: Parameters<
        Dependencies_useFinanceExpenseActions["fileToReceipt"]
      >
    ) => fileToReceipt(...args),
    focusedQueryRef,
    setExpenses: (
      ...args: Parameters<Dependencies_useFinanceExpenseActions["setExpenses"]>
    ) => setExpenses(...args),
    setToast,
  });
  const { openExpenseDrawerById, resetExpenseReview, openExpenseDrawer } =
    financeExpenseActions;
  const financeReportActions = useFinanceReportActions({
    ...expenseState,
    ...reportState,
    ...bankState,
    ...collectionState,
    ...receivableState,
    fetchData: (
      ...args: Parameters<Dependencies_useFinanceReportActions["fetchData"]>
    ) => fetchData(...args),
    handleTabChange: (
      ...args: Parameters<
        Dependencies_useFinanceReportActions["handleTabChange"]
      >
    ) => handleTabChange(...args),
    setToast,
  });

  const financeInvoiceActions = useFinanceInvoiceActions({
    ...invoiceState,
    setInvoices: (
      ...args: Parameters<Dependencies_useFinanceInvoiceActions["setInvoices"]>
    ) => setInvoices(...args),
    setSiiReadiness: (
      ...args: Parameters<
        Dependencies_useFinanceInvoiceActions["setSiiReadiness"]
      >
    ) => setSiiReadiness(...args),
    setToast,
    withBranch: (
      ...args: Parameters<Dependencies_useFinanceInvoiceActions["withBranch"]>
    ) => withBranch(...args),
  });
  const { refreshInvoices } = financeInvoiceActions;
  const financeToolbar = useFinanceToolbar({
    ...bankState,
    ...receivableState,
    ...financeData,
    activeTab,
    downloadFile: (
      ...args: Parameters<Dependencies_useFinanceToolbar["downloadFile"]>
    ) => downloadFile(...args),
    getBankMovementExportName: (
      ...args: Parameters<
        Dependencies_useFinanceToolbar["getBankMovementExportName"]
      >
    ) => getBankMovementExportName(...args),
    getBankMovementExportParams: (
      ...args: Parameters<
        Dependencies_useFinanceToolbar["getBankMovementExportParams"]
      >
    ) => getBankMovementExportParams(...args),
    handleImportBankMovements: (
      ...args: Parameters<
        Dependencies_useFinanceToolbar["handleImportBankMovements"]
      >
    ) => handleImportBankMovements(...args),
    handleSyncBank: (
      ...args: Parameters<Dependencies_useFinanceToolbar["handleSyncBank"]>
    ) => handleSyncBank(...args),
    openExpenseDrawer: (
      ...args: Parameters<Dependencies_useFinanceToolbar["openExpenseDrawer"]>
    ) => openExpenseDrawer(...args),
    refreshInvoices: (
      ...args: Parameters<Dependencies_useFinanceToolbar["refreshInvoices"]>
    ) => refreshInvoices(...args),
    setToast,
    withBranch: (
      ...args: Parameters<Dependencies_useFinanceToolbar["withBranch"]>
    ) => withBranch(...args),
  });
  const { renderTabActions } = financeToolbar;
  const tabActions = renderTabActions();

  return {
    ...financeSelectors,
    ...receivableState,
    ...bankState,
    ...expenseState,
    ...collectionState,
    ...reportState,
    ...invoiceState,
    ...financeData,
    ...financeBankActions,
    ...financePaymentActions,
    ...financeCollectionActions,
    ...financeExpenseActions,
    ...financeReportActions,
    ...financeInvoiceActions,
    ...financeToolbar,
    isAdmin,
    activeTab,
    selectedBranchId,
    setSelectedBranchId,
    toast,
    setToast,
    withBranch,
    copyText,
    downloadFile,
    handleTabChange,
    closeMovementDrawer,
    tabActions,
  };
}
