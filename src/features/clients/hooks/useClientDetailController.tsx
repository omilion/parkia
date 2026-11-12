import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientEditFormValues, VehicleValues } from "../../../../shared/schemas/clients";
import { documentFileError, type DocumentFieldsValues } from "../../../../shared/schemas/documents";
import { apiFetchJson } from "../../../lib/api";
import { useApiMutation } from "../../../lib/useApiMutation";

import React, { useEffect, useState } from "react";


import { createContext, useContext } from "react";
export function useClientDetailController({
  clientId,
  onClose,
  onChanged,
}: {
  clientId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const apiWrite = useApiMutation("features/clients/pages");
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["clients", "detail", clientId],
    enabled: Boolean(clientId),
    queryFn: ({ signal }) =>
      apiFetchJson<any>(`/api/clients/${clientId}`, { signal }),
  });
  const data = detailQuery.data;
  const [activeTab, setActiveTab] = useState("summary");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("all");
  const [selectedDocumentName, setSelectedDocumentName] = useState("");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [clientActionError, setClientActionError] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [isSavingVehicle, setIsSavingVehicle] = useState(false);
  const [expandedContractId, setExpandedContractId] = useState<number | null>(
    null,
  );
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
        reader.onerror = () =>
          reject(new Error("No se pudo leer el documento"));
        reader.readAsDataURL(file);
      },
    );
  const fetchClientDetail = () =>
    queryClient.invalidateQueries({
      queryKey: ["clients", "detail", clientId],
    });
  useEffect(() => {
    if (clientId) {
      setActiveTab("summary");
      setIsEditingClient(false);
      setClientActionError("");
      setArchiveReason("");
      setExpandedContractId(null);
    }
  }, [clientId]);
  /** Devuelve true si el documento quedó guardado, para limpiar el formulario. */
  const handleUploadDocument = async (
    values: DocumentFieldsValues,
    file: File | null,
  ): Promise<boolean> => {
    if (!clientId) return false;
    const fileError = documentFileError(file);
    if (fileError) {
      setDocumentError(fileError);
      return false;
    }

    setIsUploadingDocument(true);
    setDocumentError("");
    try {
      const payload = await fileToPayload(file as File);
      const res = await apiWrite.request(`/api/documents/client/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "No se pudo guardar el documento");
      }
      setSelectedDocumentName("");
      fetchClientDetail();
      return true;
    } catch (error: any) {
      setDocumentError(error.message || "No se pudo guardar el documento");
      return false;
    } finally {
      setIsUploadingDocument(false);
    }
  };
  const updateDocumentStatus = async (documentId: number, status: string) => {
    setDocumentError("");
    const payload: Record<string, string> = { status };
    if (status === "rejected") {
      const reason = window.prompt("Motivo de observación del documento");
      if (!reason?.trim()) {
        setDocumentError("Observar un documento requiere motivo.");
        return;
      }
      payload.rejection_reason = reason;
      payload.notes = reason;
    }
    const res = await apiWrite.request(`/api/documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchClientDetail();
      return;
    }
    const err = await res.json();
    setDocumentError(err.error || "No se pudo actualizar el documento");
  };
  const handleUpdateClient = async (payload: ClientEditFormValues) => {
    if (!clientId) return;
    setIsSavingClient(true);
    setClientActionError("");
    const res = await apiWrite.request(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setIsEditingClient(false);
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || "No se pudo actualizar el cliente");
    }
    setIsSavingClient(false);
  };
  const handleClientStatus = async (status: "active" | "archived") => {
    if (!clientId) return;
    setIsSavingClient(true);
    setClientActionError("");
    const res = await apiWrite.request(`/api/clients/${clientId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        reason:
          archiveReason ||
          (status === "active" ? "Reactivación administrativa" : ""),
      }),
    });
    if (res.ok) {
      setArchiveReason("");
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(
        err.error || "No se pudo cambiar el estado del cliente",
      );
    }
    setIsSavingClient(false);
  };
  /** Devuelve true si el vehículo quedó agregado, para limpiar el formulario. */
  const handleCreateVehicle = async (values: VehicleValues): Promise<boolean> => {
    if (!clientId) return false;
    setIsSavingVehicle(true);
    setClientActionError("");
    const res = await apiWrite.request(`/api/clients/${clientId}/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setIsSavingVehicle(false);
    if (res.ok) {
      fetchClientDetail();
      onChanged();
      return true;
    }
    const err = await res.json();
    setClientActionError(err.error || "No se pudo agregar el vehículo");
    return false;
  };
  const handleDeleteVehicle = async (vehicleId: number, plate: string) => {
    if (!clientId) return;
    const reason = window.prompt(
      `Motivo para dar de baja el vehiculo ${plate}`,
    );
    if (!reason?.trim()) {
      setClientActionError("La baja de un vehiculo requiere motivo.");
      return;
    }
    setClientActionError("");
    const res = await apiWrite.request(
      `/api/clients/${clientId}/vehicles/${vehicleId}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      },
    );
    if (res.ok) {
      fetchClientDetail();
      onChanged();
    } else {
      const err = await res.json();
      setClientActionError(err.error || "No se pudo dar de baja el vehículo");
    }
  };
  const documents = data?.documents ?? [];
  const filteredDocuments = documents.filter(
    (document: any) =>
      documentStatusFilter === "all" ||
      document.status === documentStatusFilter,
  );
  const pendingDocuments = documents.filter(
    (document: any) =>
      document.status === "pending" || document.status === "rejected",
  ).length;
  const expiredDocuments = documents.filter(
    (document: any) =>
      document.status === "expired" ||
      (document.expires_at && new Date(document.expires_at) < new Date()),
  ).length;
  const documentStatusLabel: Record<string, string> = {
    pending: "Pendiente",
    received: "Recibido",
    approved: "Aprobado",
    rejected: "Observado",
    expired: "Vencido",
  };
  const documentTypeLabel: Record<string, string> = {
    contract: "Contrato",
    identity: "Identidad",
    mandate: "Mandato",
    receipt: "Comprobante",
    other: "Otro",
  };
  return {
    clientId,
    onClose,
    onChanged,
    apiWrite,
    data,
    detailQuery,
    activeTab,
    setActiveTab,
    documentStatusFilter,
    setDocumentStatusFilter,
    selectedDocumentName,
    setSelectedDocumentName,
    isUploadingDocument,
    setIsUploadingDocument,
    documentError,
    setDocumentError,
    isEditingClient,
    setIsEditingClient,
    isSavingClient,
    setIsSavingClient,
    clientActionError,
    setClientActionError,
    archiveReason,
    setArchiveReason,
    isSavingVehicle,
    setIsSavingVehicle,
    expandedContractId,
    setExpandedContractId,
    fileToPayload,
    fetchClientDetail,
    handleUploadDocument,
    updateDocumentStatus,
    handleUpdateClient,
    handleClientStatus,
    handleCreateVehicle,
    handleDeleteVehicle,
    documents,
    filteredDocuments,
    pendingDocuments,
    expiredDocuments,
    documentStatusLabel,
    documentTypeLabel,
  };
}
export const ClientDetailViewContext = createContext<ReturnType<
  typeof useClientDetailController
> | null>(null);
export function useClientDetailViewContext() {
  const context = useContext(ClientDetailViewContext);
  if (!context) throw new Error("ClientDetailView requiere su proveedor");
  return context;
}
