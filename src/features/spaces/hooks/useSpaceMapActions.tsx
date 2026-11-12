import { useMapEditorState } from "./useMapEditorState";
import type { SpaceMapFieldsValues } from "../../../../shared/schemas/spaces";
import { useInventoryState } from "./useInventoryState";
import { useSpaceMapState } from "./useSpaceMapState";
import { useSpaceNavigationState } from "./useSpaceNavigationState";
import { useApiMutation } from "../../../lib/useApiMutation";

import React from "react";
import { Space, SpaceMap, SpaceMapLiveRegion, SpaceMapRegion } from "../../../types";
import { apiFetchJson } from "../../../lib/api";

import { readErrorMessage } from "../pages/spacesShared";

export type Dependencies_useSpaceMapActions = {
  canCreateSpaces: boolean;
  parkingMode: ReturnType<typeof useSpaceNavigationState>["parkingMode"];
  selectedBranchId: ReturnType<
    typeof useSpaceNavigationState
  >["selectedBranchId"];
  selectedMapId: ReturnType<typeof useSpaceMapState>["selectedMapId"];
  setActiveType: ReturnType<typeof useSpaceNavigationState>["setActiveType"];
  setIsActionLoading: any;
  setIsDrawerOpen: ReturnType<typeof useInventoryState>["setIsDrawerOpen"];
  setIsMapCreateDrawerOpen: ReturnType<
    typeof useSpaceMapState
  >["setIsMapCreateDrawerOpen"];
  setIsMapLoading: ReturnType<typeof useSpaceMapState>["setIsMapLoading"];
  setLastMapRefresh: ReturnType<typeof useSpaceMapState>["setLastMapRefresh"];
  setLiveRegions: ReturnType<typeof useSpaceMapState>["setLiveRegions"];
  setMapFilterStatus: ReturnType<typeof useSpaceMapState>["setMapFilterStatus"];
  setMapLiveSummary: ReturnType<typeof useSpaceMapState>["setMapLiveSummary"];
  setMapRegions: ReturnType<typeof useMapEditorState>["setMapRegions"];
  setMapSummary: ReturnType<typeof useSpaceMapState>["setMapSummary"];
  setParkingMode: ReturnType<typeof useSpaceNavigationState>["setParkingMode"];
  setSelectedBranchId: ReturnType<
    typeof useSpaceNavigationState
  >["setSelectedBranchId"];
  setSelectedMap: ReturnType<typeof useSpaceMapState>["setSelectedMap"];
  setSelectedMapId: ReturnType<typeof useSpaceMapState>["setSelectedMapId"];
  setSelectedMapRegionId: ReturnType<
    typeof useMapEditorState
  >["setSelectedMapRegionId"];
  setSpaceMaps: ReturnType<typeof useSpaceMapState>["setSpaceMaps"];
  setSpaces: (value: Space[]) => unknown;
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
};
export function useSpaceMapActions(
  dependencies: Dependencies_useSpaceMapActions,
) {
  const {
    canCreateSpaces,
    parkingMode,
    selectedBranchId,
    selectedMapId,
    setActiveType,
    setIsActionLoading,
    setIsDrawerOpen,
    setIsMapCreateDrawerOpen,
    setIsMapLoading,
    setLastMapRefresh,
    setLiveRegions,
    setMapFilterStatus,
    setMapLiveSummary,
    setMapRegions,
    setMapSummary,
    setParkingMode,
    setSelectedBranchId,
    setSelectedMap,
    setSelectedMapId,
    setSelectedMapRegionId,
    setSpaceMaps,
    setSpaces,
    setToast,
  } = dependencies;
  const apiWrite = useApiMutation("spaces/useSpaceMapActions");
  const fetchSpaceMaps = async () => {
    if (parkingMode !== "map" || selectedBranchId === "all") {
      setSpaceMaps([]);
      setMapSummary(null);
      setSelectedMap(null);
      setSelectedMapId(null);
      setMapRegions([]);
      setLiveRegions([]);
      return;
    }

    setIsMapLoading(true);
    try {
      const data = await apiFetchJson<{
        maps: SpaceMap[];
        spaces: Space[];
        summary: {
          totalSpaces: number;
          mappedSpaces: number;
          unmappedSpaces: number;
        };
      }>(`/api/space-maps?branch_id=${selectedBranchId}`);
      setSpaceMaps(data.maps);
      setMapSummary(data.summary);
      if (data.spaces?.length) setSpaces(data.spaces);

      const nextMap =
        data.maps.find((map) => map.id === selectedMapId) ||
        data.maps.find((map) => map.is_default) ||
        data.maps[0] ||
        null;
      setSelectedMapId(nextMap?.id || null);
      if (!nextMap) {
        setSelectedMap(null);
        setMapRegions([]);
        setLiveRegions([]);
      }
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudieron cargar los mapas aéreos",
        type: "error",
      });
    } finally {
      setIsMapLoading(false);
    }
  };

  const fetchSpaceMapDetail = async (mapId = selectedMapId) => {
    if (!mapId) return;
    setIsMapLoading(true);
    try {
      const data = await apiFetchJson<{
        map: SpaceMap;
        regions: SpaceMapRegion[];
        live: SpaceMapLiveRegion[];
        summary: any;
      }>(`/api/space-maps/${mapId}`);
      setSelectedMap(data.map);
      setMapRegions(data.regions || []);
      setLiveRegions(data.live || []);
      setMapLiveSummary(data.summary || null);
      setLastMapRefresh(new Date().toISOString());
      setSelectedMapRegionId((current) =>
        current && data.regions?.some((region) => region.id === current)
          ? current
          : null,
      );
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo cargar el mapa aéreo",
        type: "error",
      });
    } finally {
      setIsMapLoading(false);
    }
  };

  const readImagePayload = (file: File) =>
    new Promise<{
      fileName: string;
      mimeType: string;
      dataBase64: string;
      width: number;
      height: number;
    }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.onload = () => {
        const result = String(reader.result || "");
        const image = new Image();
        image.onerror = () => reject(new Error("No se pudo validar la imagen"));
        image.onload = () => {
          resolve({
            fileName: file.name,
            mimeType: file.type,
            dataBase64: result.split(",")[1] || "",
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        };
        image.src = result;
      };
      reader.readAsDataURL(file);
    });

  /** Recibe los campos validados y la imagen elegida. */
  const handleCreateSpaceMap = async (
    values: SpaceMapFieldsValues,
    file: File | null,
  ) => {
    if (!canCreateSpaces) return;
    const branchId = String(values.branch_id);
    const name = values.name;

    if (!file || file.size === 0) {
      setToast({ message: "Selecciona una imagen JPG o PNG", type: "error" });
      return;
    }
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setToast({
        message: "La imagen debe ser JPG o PNG y pesar máximo 10MB",
        type: "error",
      });
      return;
    }

    setIsActionLoading(true);
    try {
      const image = await readImagePayload(file);
      const res = await apiWrite.request("/api/space-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: Number(branchId),
          name,
          image: {
            fileName: image.fileName,
            mimeType: image.mimeType,
            dataBase64: image.dataBase64,
          },
          image_width: image.width,
          image_height: image.height,
          is_default: values.is_default,
        }),
      });

      if (res.ok) {
        const body = await res.json();
        setToast({ message: "Mapa aéreo creado", type: "success" });
        setIsMapCreateDrawerOpen(false);
        if (selectedBranchId !== branchId) setSelectedBranchId(branchId);
        setSelectedMapId(body.map?.id || null);
        if (selectedBranchId === branchId) await fetchSpaceMaps();
      } else {
        setToast({
          message: await readErrorMessage(
            res,
            "No se pudo crear el mapa aéreo",
          ),
          type: "error",
        });
      }
    } catch (error: any) {
      setToast({
        message: error.message || "No se pudo procesar la imagen",
        type: "error",
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const focusSpaceOnMap = async (space: Space) => {
    if (!space.branch_id) {
      setToast({
        message: "El estacionamiento no tiene sucursal asociada",
        type: "error",
      });
      return;
    }

    setActiveType("parking");
    setParkingMode("map");
    setSelectedBranchId(String(space.branch_id));
    setMapFilterStatus("all");
    setIsDrawerOpen(false);
    setIsMapLoading(true);

    try {
      const list = await apiFetchJson<{
        maps: SpaceMap[];
        spaces: Space[];
        summary: {
          totalSpaces: number;
          mappedSpaces: number;
          unmappedSpaces: number;
        };
      }>(`/api/space-maps?branch_id=${space.branch_id}`);
      setSpaceMaps(list.maps);
      setMapSummary(list.summary);
      if (list.spaces?.length) setSpaces(list.spaces);

      for (const map of list.maps) {
        const detail = await apiFetchJson<{
          map: SpaceMap;
          regions: SpaceMapRegion[];
          live: SpaceMapLiveRegion[];
          summary: any;
        }>(`/api/space-maps/${map.id}`);
        const region = detail.regions.find(
          (item) => item.space_id === space.id,
        );
        if (region) {
          setSelectedMapId(map.id);
          setSelectedMap(detail.map);
          setMapRegions(detail.regions || []);
          setLiveRegions(detail.live || []);
          setMapLiveSummary(detail.summary || null);
          setSelectedMapRegionId(region.id);
          setLastMapRefresh(new Date().toISOString());
          return;
        }
      }

      setToast({
        message: "Este estacionamiento todavía no tiene región en un mapa",
        type: "error",
      });
    } catch (error: any) {
      setToast({
        message:
          error.message || "No se pudo abrir el mapa del estacionamiento",
        type: "error",
      });
    } finally {
      setIsMapLoading(false);
    }
  };
  return {
    fetchSpaceMaps,
    fetchSpaceMapDetail,
    readImagePayload,
    handleCreateSpaceMap,
    focusSpaceOnMap,
  };
}
