import { useInventoryState } from "./useInventoryState";
import type { CreateSpaceValues, UpdateSpaceValues } from "../../../../shared/schemas/spaces";
import { useApiMutation } from "../../../lib/useApiMutation";

import React from "react";
import { Space } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import { readErrorMessage } from "../pages/spacesShared";
import type { SpaceDetail } from "../pages/spacesShared";

export type Dependencies_useInventoryActions = {
  canCreateSpaces: boolean;
  canEditSpaces: boolean;
  canOperateSpaces: boolean;
  editingSpace: ReturnType<typeof useInventoryState>["editingSpace"];
  fetchData: () => Promise<void>;
  selectedSpace: ReturnType<typeof useInventoryState>["selectedSpace"];
  setConfirmAction: ReturnType<typeof useInventoryState>["setConfirmAction"];
  setEditingSpace: ReturnType<typeof useInventoryState>["setEditingSpace"];
  setIsActionLoading: any;
  setIsCreateDrawerOpen: ReturnType<
    typeof useInventoryState
  >["setIsCreateDrawerOpen"];
  setIsDrawerOpen: ReturnType<typeof useInventoryState>["setIsDrawerOpen"];
  setSelectedSpace: ReturnType<typeof useInventoryState>["setSelectedSpace"];
  setSpaceDetail: ReturnType<typeof useInventoryState>["setSpaceDetail"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useInventoryActions(
  dependencies: Dependencies_useInventoryActions,
) {
  const {
    canCreateSpaces,
    canEditSpaces,
    canOperateSpaces,
    editingSpace,
    fetchData,
    selectedSpace,
    setConfirmAction,
    setEditingSpace,
    setIsActionLoading,
    setIsCreateDrawerOpen,
    setIsDrawerOpen,
    setSelectedSpace,
    setSpaceDetail,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("spaces/useInventoryActions");
  const openSpaceDetail = async (space: Space) => {
    setSelectedSpace(space);
    setSpaceDetail(null);
    setIsDrawerOpen(true);
    try {
      const detail = await apiFetchJson<SpaceDetail>(
        `/api/spaces/${space.id}/detail`,
      );
      setSpaceDetail(detail);
      setSelectedSpace(detail.space);
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo cargar la ficha del espacio",
        type: "error",
      });
    }
  };

  const handleUpdateStatus = async (status: string, notes: string = "") => {
    if (!canOperateSpaces) return;
    if (!selectedSpace) return;
    setIsActionLoading(true);
    const res = await apiWrite.request(
      `/api/spaces/${selectedSpace.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes }),
      },
    );
    if (res.ok) {
      setToast({
        message: `Espacio ${selectedSpace.name} actualizado a ${status}`,
        type: "success",
      });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "Error al actualizar el espacio"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const executeOpenBarrier = async (space: Space) => {
    if (!canOperateSpaces) return;
    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/spaces/${space.id}/open-barrier`, {
      method: "POST",
    });
    if (res.ok) {
      const body = await res.json();
      setToast({
        message:
          body.message || `Apertura manual registrada para ${space.name}`,
        type: "success",
      });
      setIsDrawerOpen(false);
      setConfirmAction(null);
      fetchData();
    } else {
      setToast({
        message: await readErrorMessage(
          res,
          "Error al registrar la apertura manual",
        ),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const executeForceRelease = async (space: Space) => {
    if (!canOperateSpaces) return;
    const reason = window.prompt(
      `Motivo obligatorio para liberar ${space.name}`,
    );
    if (!reason?.trim()) {
      setToast({
        message: "Debes ingresar un motivo para liberar manualmente el espacio",
        type: "error",
      });
      setConfirmAction(null);
      return;
    }
    setIsActionLoading(true);
    const res = await apiWrite.request(
      `/api/spaces/${space.id}/force-release`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      },
    );
    if (res.ok) {
      setToast({
        message: "Espacio liberado y limpiado forzosamente",
        type: "success",
      });
      setIsDrawerOpen(false);
      setConfirmAction(null);
      fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "Error al liberar el espacio"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const handleCreateSpace = async (data: CreateSpaceValues) => {
    if (!canCreateSpaces) return;
    setIsActionLoading(true);

    const res = await apiWrite.request("/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      setToast({ message: "Espacio creado exitosamente", type: "success" });
      setIsCreateDrawerOpen(false);
      fetchData();
    } else {
      setToast({
        message: await readErrorMessage(res, "Error al crear el espacio"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };

  const handleUpdateSpace = async (data: UpdateSpaceValues) => {
    if (!canEditSpaces || !editingSpace) return;
    setIsActionLoading(true);

    const res = await apiWrite.request(`/api/spaces/${editingSpace.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      setToast({ message: "Ficha de espacio actualizada", type: "success" });
      setEditingSpace(null);
      await fetchData();
      const updated = await apiFetchJson<SpaceDetail>(
        `/api/spaces/${editingSpace.id}/detail`,
      );
      setSpaceDetail(updated);
      setSelectedSpace(updated.space);
    } else {
      setToast({
        message: await readErrorMessage(res, "Error al actualizar el espacio"),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };
  return {
    openSpaceDetail,
    handleUpdateStatus,
    executeOpenBarrier,
    executeForceRelease,
    handleCreateSpace,
    handleUpdateSpace,
  };
}
