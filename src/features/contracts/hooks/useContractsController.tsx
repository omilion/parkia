import { useApiMutation } from "../../../lib/useApiMutation";
import type { UpdateContractValues } from "../../../../shared/schemas/contracts";
import { documentFileError } from "../../../../shared/schemas/documents";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Branch, Contract, DocumentRecord, PaginatedResponse, Payment } from "../../../types";

import { apiFetchJson } from "../../../lib/api";

const CONTRACT_PAGE_SIZE = 25;
type ContractDetail = {
  contract: Contract & {
    client_rut?: string | null;
    client_email?: string | null;
    client_phone?: string | null;
    client_type?: string | null;
    client_address?: string | null;
    client_business_activity?: string | null;
    billing_contact_name?: string | null;
    billing_contact_email?: string | null;
    billing_contact_phone?: string | null;
    space_price?: number | null;
  };
  payments: Array<
    Payment & { allocated_amount?: number; remaining_amount?: number }
  >;
  documents: DocumentRecord[];
  audit: Array<{
    id: number;
    action: string;
    created_at: string;
    staff_name?: string | null;
    staff_email?: string | null;
    metadata?: string | null;
  }>;
};

import { createContext, useContext } from "react";
export function useContractsController() {
  const apiWrite = useApiMutation("features/contracts/pages");
  const [searchParams, setSearchParams] = useSearchParams();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [searchContract, setSearchContract] = useState("");
  const [contractStatus, setContractStatus] = useState("all");
  const [contractPage, setContractPage] = useState(1);
  const [contractAction, setContractAction] = useState<{
    contract: Contract;
    action: "suspend" | "reactivate" | "terminate";
  } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionDate, setActionDate] = useState("");
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [showExpiringOnly, setShowExpiringOnly] = useState(
    () =>
      new URLSearchParams(window.location.search).get("filter") === "expiring",
  );
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const [renewingContract, setRenewingContract] = useState<Contract | null>(
    null,
  );
  const [newEndDate, setNewEndDate] = useState("");
  const [isRenewing, setIsRenewing] = useState(false);
  const [contractUpload, setContractUpload] = useState<Contract | null>(null);
  const [signedFileName, setSignedFileName] = useState("");
  const [isUploadingSigned, setIsUploadingSigned] = useState(false);
  const [isGeneratingPdfId, setIsGeneratingPdfId] = useState<number | null>(
    null,
  );
  const [selectedContractId, setSelectedContractId] = useState<number | null>(
    null,
  );
  const detailQuery = useQuery({
    queryKey: ["contracts", "detail", selectedContractId],
    enabled: Boolean(selectedContractId),
    queryFn: ({ signal }) =>
      apiFetchJson<ContractDetail>(
        `/api/contracts/${selectedContractId}/detail`,
        { signal },
      ),
  });
  const contractDetail = detailQuery.data;
  const isDetailLoading = Boolean(selectedContractId) && detailQuery.isPending;
  const detailError = detailQuery.error?.message || "";
  const [editingContract, setEditingContract] = useState<
    ContractDetail["contract"] | null
  >(null);
  const [isUpdatingContract, setIsUpdatingContract] = useState(false);
  const queryClient = useQueryClient();
  const contractParams = new URLSearchParams({
    page: String(contractPage),
    pageSize: String(CONTRACT_PAGE_SIZE),
  });
  if (searchContract.trim())
    contractParams.set("search", searchContract.trim());
  if (contractStatus !== "all") contractParams.set("status", contractStatus);
  if (showExpiringOnly) contractParams.set("expiring", "true");
  if (selectedBranchId !== "all")
    contractParams.set("branch_id", selectedBranchId);
  const contractQuery = useQuery({
    queryKey: ["contracts", contractParams.toString()],
    queryFn: async ({ signal }) => {
      const [contracts, branches] = await Promise.all([
        apiFetchJson<PaginatedResponse<Contract>>(
          `/api/contracts?${contractParams}`,
          { signal },
        ),
        apiFetchJson<Branch[]>("/api/branches", { signal }),
      ]);
      return { contracts, branches };
    },
  });
  const contracts = contractQuery.data?.contracts.items ?? [];
  const contractTotal = contractQuery.data?.contracts.total ?? 0;
  const branches = contractQuery.data?.branches ?? [];
  const isLoading = contractQuery.isPending;
  const loadError = contractQuery.error?.message || "";
  const fetchData = () =>
    Promise.all(
      ["contracts", "spaces", "clients"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const fetchContractDetail = (contractId: number) =>
    queryClient.invalidateQueries({
      queryKey: ["contracts", "detail", contractId],
    });
  useEffect(() => {
    const requestedContractId = Number(searchParams.get("id") || 0);
    if (Number.isFinite(requestedContractId) && requestedContractId > 0) {
      setSelectedContractId(requestedContractId);
      return;
    }

    setSelectedContractId(null);
  }, [searchParams]);
  const openContractDetail = (contractId: number) => {
    setSelectedContractId(contractId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("id", String(contractId));
      return next;
    });
  };
  const closeContractDetail = () => {
    setSelectedContractId(null);
    setEditingContract(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("id");
        return next;
      },
      { replace: true },
    );
  };
  const isExpiringContract = (contract: Contract) => {
    if (contract.status !== "active" || !contract.end_date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(contract.end_date);
    return (
      endDate >= today &&
      endDate <= new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
    );
  };
  const filteredContracts = contracts;
  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };
  const closeActionDialog = () => {
    setContractAction(null);
    setActionReason("");
    setActionDate("");
  };
  const closeRenewDialog = () => {
    setRenewingContract(null);
    setNewEndDate("");
  };
  const handleRenewContract = async () => {
    if (!renewingContract || !newEndDate) return;
    setIsRenewing(true);
    const res = await apiWrite.request(
      `/api/contracts/${renewingContract.id}/renew`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_end_date: newEndDate }),
      },
    );

    if (res.ok) {
      const result = await res.json();
      const receivableCount = Number(result.receivables?.created || 0);
      setToast({
        message: `Contrato renovado correctamente. ${receivableCount} cobro${receivableCount === 1 ? "" : "s"} nuevo${receivableCount === 1 ? "" : "s"}.`,
        type: "success",
      });
      closeRenewDialog();
      fetchData();
    } else {
      const err = await res.json();
      setToast({
        message: err.error || "No se pudo renovar el contrato",
        type: "error",
      });
    }
    setIsRenewing(false);
  };
  const handleContractAction = async () => {
    if (!contractAction || actionReason.trim().length < 3) return;

    setIsActionSubmitting(true);
    const res = await apiWrite.request(
      `/api/contracts/${contractAction.contract.id}/${contractAction.action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: actionReason,
          effective_date: actionDate || undefined,
        }),
      },
    );

    if (res.ok) {
      const label =
        contractAction.action === "suspend"
          ? "suspendido"
          : contractAction.action === "reactivate"
            ? "reactivado"
            : "terminado";
      setToast({ message: `Contrato ${label} correctamente`, type: "success" });
      closeActionDialog();
      fetchData();
    } else {
      const err = await res.json();
      setToast({
        message: err.error || "No se pudo actualizar el contrato",
        type: "error",
      });
    }
    setIsActionSubmitting(false);
  };
  const handleUpdateContract = async (payload: UpdateContractValues) => {
    if (!editingContract) return;

    setIsUpdatingContract(true);
    try {
      const res = await apiWrite.request(
        `/api/contracts/${editingContract.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "No se pudo actualizar el contrato");
      }

      const result = await res.json();
      const receivables = result.receivables;
      const receivableSummary = receivables
        ? ` Cobros: ${Number(receivables.created || 0)} creados, ${Number(receivables.updated || 0)} actualizados, ${Number(receivables.cancelled || 0)} cancelados.`
        : "";
      setToast({
        message: `Contrato actualizado.${receivableSummary}`,
        type: "success",
      });
      setEditingContract(null);
      fetchData();
      fetchContractDetail(editingContract.id);
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo actualizar el contrato",
        type: "error",
      });
    } finally {
      setIsUpdatingContract(false);
    }
  };
  const actionLabels = {
    suspend: {
      title: "Suspender contrato",
      button: "Suspender",
      tone: "amber",
    },
    reactivate: {
      title: "Reactivar contrato",
      button: "Reactivar",
      tone: "emerald",
    },
    terminate: { title: "Terminar contrato", button: "Terminar", tone: "red" },
  };
  const fileToPayload = (file: File) =>
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
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      },
    );
  const closeUploadDialog = () => {
    setContractUpload(null);
    setSignedFileName("");
  };
  /** Valida y adjunta el contrato firmado. Devuelve el error para mostrarlo junto al campo. */
  const handleSignedUpload = async (file: File | null): Promise<string | null> => {
    if (!contractUpload) return null;
    const fileError = documentFileError(file);
    if (fileError) return fileError;

    setIsUploadingSigned(true);
    try {
      const payload = await fileToPayload(file as File);
      const res = await apiWrite.request(
        `/api/documents/contract/${contractUpload.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: "Contrato firmado",
            document_type: "contract",
            status: "approved",
            notes: `Contrato CON-2026-${contractUpload.id.toString().padStart(3, "0")} firmado`,
            ...payload,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "No se pudo guardar el contrato firmado");
      }
      setToast({ message: "Contrato firmado adjuntado", type: "success" });
      closeUploadDialog();
      return null;
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo guardar el contrato firmado",
        type: "error",
      });
      return null;
    } finally {
      setIsUploadingSigned(false);
    }
  };
  const handleGeneratePdfDocument = async (contract: Contract) => {
    setIsGeneratingPdfId(contract.id);
    const res = await apiWrite.request(
      `/api/contracts/${contract.id}/generate-pdf`,
      { method: "POST" },
    );
    if (res.ok) {
      setToast({
        message: "PDF generado y archivado en documentos del contrato",
        type: "success",
      });
    } else {
      const err = await res.json();
      setToast({
        message: err.error || "No se pudo generar el PDF",
        type: "error",
      });
    }
    setIsGeneratingPdfId(null);
  };
  return {
    apiWrite,
    searchParams,
    setSearchParams,
    isDrawerOpen,
    setIsDrawerOpen,
    toast,
    setToast,
    searchContract,
    setSearchContract,
    contractStatus,
    setContractStatus,
    contractPage,
    setContractPage,
    contractAction,
    setContractAction,
    actionReason,
    setActionReason,
    actionDate,
    setActionDate,
    isActionSubmitting,
    setIsActionSubmitting,
    showExpiringOnly,
    setShowExpiringOnly,
    selectedBranchId,
    setSelectedBranchId,
    renewingContract,
    setRenewingContract,
    newEndDate,
    setNewEndDate,
    isRenewing,
    setIsRenewing,
    contractUpload,
    setContractUpload,
    signedFileName,
    setSignedFileName,
    isUploadingSigned,
    setIsUploadingSigned,
    isGeneratingPdfId,
    setIsGeneratingPdfId,
    selectedContractId,
    setSelectedContractId,
    contractDetail,
    isDetailLoading,
    detailError,
    editingContract,
    setEditingContract,
    isUpdatingContract,
    setIsUpdatingContract,
    queryClient,
    contractParams,
    contractQuery,
    contracts,
    contractTotal,
    branches,
    isLoading,
    loadError,
    fetchData,
    fetchContractDetail,
    openContractDetail,
    closeContractDetail,
    isExpiringContract,
    filteredContracts,
    closeDrawer,
    closeActionDialog,
    closeRenewDialog,
    handleRenewContract,
    handleContractAction,
    handleUpdateContract,
    actionLabels,
    fileToPayload,
    closeUploadDialog,
    handleSignedUpload,
    handleGeneratePdfDocument,
  };
}
export const ContractsPageContext = createContext<ReturnType<
  typeof useContractsController
> | null>(null);
export function useContractsPageContext() {
  const context = useContext(ContractsPageContext);
  if (!context) throw new Error("ContractsPage requiere su proveedor");
  return context;
}
