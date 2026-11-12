import { useSpaceMapState } from "./useSpaceMapState";
import { useMapEditorState } from "./useMapEditorState";
import { useApiMutation } from "../../../lib/useApiMutation";

import React from "react";
import { Space, SpaceMapGeometry, SpaceMapLiveRegion, SpaceMapRegion } from "../../../types";

import { readErrorMessage, liveStatusLabels, EDITOR_REGION_COLOR, clamp01 } from "../pages/spacesShared";

export type Dependencies_useMapEditorActions = {
  canEditSpaces: boolean;
  draftPolygonPoints: ReturnType<
    typeof useMapEditorState
  >["draftPolygonPoints"];
  drawingRect: ReturnType<typeof useMapEditorState>["drawingRect"];
  editorSpaceId: ReturnType<typeof useMapEditorState>["editorSpaceId"];
  fetchSpaceMapDetail: (mapId?: any) => Promise<void>;
  fetchSpaceMaps: () => Promise<void>;
  isMapEditorOpen: ReturnType<typeof useMapEditorState>["isMapEditorOpen"];
  liveRegions: ReturnType<typeof useSpaceMapState>["liveRegions"];
  mapEditorTool: ReturnType<typeof useMapEditorState>["mapEditorTool"];
  mapRegions: ReturnType<typeof useMapEditorState>["mapRegions"];
  movingRegion: ReturnType<typeof useMapEditorState>["movingRegion"];
  nextDraftRegionId: ReturnType<typeof useMapEditorState>["nextDraftRegionId"];
  selectedMap: ReturnType<typeof useSpaceMapState>["selectedMap"];
  selectedMapRegionId: ReturnType<
    typeof useMapEditorState
  >["selectedMapRegionId"];
  setDraftPolygonPoints: ReturnType<
    typeof useMapEditorState
  >["setDraftPolygonPoints"];
  setDrawingRect: ReturnType<typeof useMapEditorState>["setDrawingRect"];
  setEditorSpaceId: ReturnType<typeof useMapEditorState>["setEditorSpaceId"];
  setIsActionLoading: any;
  setMapRegions: ReturnType<typeof useMapEditorState>["setMapRegions"];
  setMovingRegion: ReturnType<typeof useMapEditorState>["setMovingRegion"];
  setNextDraftRegionId: ReturnType<
    typeof useMapEditorState
  >["setNextDraftRegionId"];
  setSelectedMapRegionId: ReturnType<
    typeof useMapEditorState
  >["setSelectedMapRegionId"];
  setToast: (
    value: { message: string; type: "success" | "error" } | null,
  ) => void;
  spaces: Space[];
};
export function useMapEditorActions(
  dependencies: Dependencies_useMapEditorActions,
) {
  const {
    canEditSpaces,
    draftPolygonPoints,
    drawingRect,
    editorSpaceId,
    fetchSpaceMapDetail,
    fetchSpaceMaps,
    isMapEditorOpen,
    liveRegions,
    mapEditorTool,
    mapRegions,
    movingRegion,
    nextDraftRegionId,
    selectedMap,
    selectedMapRegionId,
    setDraftPolygonPoints,
    setDrawingRect,
    setEditorSpaceId,
    setIsActionLoading,
    setMapRegions,
    setMovingRegion,
    setNextDraftRegionId,
    setSelectedMapRegionId,
    setToast,
    spaces,
  } = dependencies;
  const apiWrite = useApiMutation("spaces/useMapEditorActions");
  const pointerToMapPoint = (event: React.PointerEvent<SVGElement>) => {
    const currentTarget = event.currentTarget as SVGElement;
    const svg = currentTarget.ownerSVGElement || currentTarget;
    const bounds = svg.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  };

  const rectFromDrawing = (rect: {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  }) => ({
    type: "rect" as const,
    x: Math.min(rect.startX, rect.currentX),
    y: Math.min(rect.startY, rect.currentY),
    width: Math.abs(rect.currentX - rect.startX),
    height: Math.abs(rect.currentY - rect.startY),
  });

  const translateGeometry = (
    geometry: SpaceMapGeometry,
    dx: number,
    dy: number,
  ): SpaceMapGeometry => {
    if (geometry.type === "rect") {
      return {
        ...geometry,
        x: Math.min(1 - geometry.width, Math.max(0, geometry.x + dx)),
        y: Math.min(1 - geometry.height, Math.max(0, geometry.y + dy)),
      };
    }

    const minX = Math.min(...geometry.points.map((point) => point.x));
    const maxX = Math.max(...geometry.points.map((point) => point.x));
    const minY = Math.min(...geometry.points.map((point) => point.y));
    const maxY = Math.max(...geometry.points.map((point) => point.y));
    const safeDx = Math.min(1 - maxX, Math.max(-minX, dx));
    const safeDy = Math.min(1 - maxY, Math.max(-minY, dy));
    return {
      ...geometry,
      points: geometry.points.map((point) => ({
        x: clamp01(point.x + safeDx),
        y: clamp01(point.y + safeDy),
      })),
    };
  };

  const addDraftRegion = (
    spaceId: number | null,
    geometry: SpaceMapGeometry,
  ) => {
    if (!selectedMap) return;
    const assignedSpaceId = spaceId || 0;
    const space = assignedSpaceId
      ? spaces.find((item) => item.id === assignedSpaceId)
      : null;
    const draftId = nextDraftRegionId;
    setNextDraftRegionId((id) => id - 1);
    setMapRegions((regions) => [
      ...regions,
      {
        id: draftId,
        map_id: selectedMap.id,
        space_id: assignedSpaceId,
        space_name: space?.name || null,
        geometry,
        label: space?.name || "Región sin asignar",
        color: EDITOR_REGION_COLOR,
        sort_order: regions.length,
      },
    ]);
    setSelectedMapRegionId(draftId);
    setEditorSpaceId("");
  };

  const tooltipForRegion = (region: SpaceMapRegion | SpaceMapLiveRegion) => {
    const live = liveRegions.find((item) => item.id === region.id);
    const status = live ? liveStatusLabels[live.status] : "Región editable";
    const details = [
      live?.client_name,
      live?.plate,
      live?.contract_id ? `Contrato #${live.contract_id}` : null,
      live?.visitor_ticket_id ? `Ticket #${live.visitor_ticket_id}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `${region.label || region.space_name || (region.space_id ? `Cupo #${region.space_id}` : "Región sin asignar")} · ${status}${details ? ` · ${details}` : ""}`;
  };

  const handleMapPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canEditSpaces || !isMapEditorOpen || !selectedMap) return;
    if (mapEditorTool === "select") {
      setSelectedMapRegionId(null);
      return;
    }
    if (mapEditorTool === "move") {
      setSelectedMapRegionId(null);
      return;
    }
    const point = pointerToMapPoint(event);
    if (mapEditorTool === "polygon") {
      const nextPoints = [...draftPolygonPoints, point];
      if (nextPoints.length >= 4) {
        addDraftRegion(Number(editorSpaceId) || null, {
          type: "polygon",
          points: nextPoints,
        });
        setDraftPolygonPoints([]);
      } else {
        setDraftPolygonPoints(nextPoints);
      }
      return;
    }
    if (mapEditorTool === "rect") {
      setDrawingRect({
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      });
    }
  };

  const handleMapPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointerToMapPoint(event);
    if (movingRegion) {
      const dx = point.x - movingRegion.startX;
      const dy = point.y - movingRegion.startY;
      setMapRegions((regions) =>
        regions.map((region) =>
          region.id === movingRegion.regionId
            ? {
                ...region,
                geometry: translateGeometry(
                  movingRegion.originalGeometry,
                  dx,
                  dy,
                ),
              }
            : region,
        ),
      );
      return;
    }
    if (drawingRect) {
      setDrawingRect({ ...drawingRect, currentX: point.x, currentY: point.y });
    }
  };

  const handleMapPointerUp = () => {
    if (movingRegion) {
      setMovingRegion(null);
      return;
    }
    if (!drawingRect || !selectedMap || mapEditorTool !== "rect") return;
    const geometry = rectFromDrawing(drawingRect);
    setDrawingRect(null);
    if (geometry.width < 0.01 || geometry.height < 0.01) return;

    addDraftRegion(Number(editorSpaceId) || null, geometry);
  };

  const handleFinishPolygon = () => {
    if (draftPolygonPoints.length < 3) {
      setToast({
        message: "El polígono necesita al menos 3 puntos",
        type: "error",
      });
      return;
    }
    addDraftRegion(Number(editorSpaceId) || null, {
      type: "polygon",
      points: draftPolygonPoints,
    });
    setDraftPolygonPoints([]);
  };

  const handleUndoMapEdit = () => {
    if (draftPolygonPoints.length > 0) {
      setDraftPolygonPoints((points) => points.slice(0, -1));
      return;
    }
    if (drawingRect) {
      setDrawingRect(null);
      return;
    }
    if (mapRegions.length === 0) {
      setToast({ message: "No hay cambios para deshacer", type: "error" });
      return;
    }

    setMapRegions((regions) => {
      const targetIndex = selectedMapRegionId
        ? regions.findIndex((region) => region.id === selectedMapRegionId)
        : regions.length - 1;
      if (targetIndex < 0) return regions;
      return regions.filter((_, index) => index !== targetIndex);
    });
    setSelectedMapRegionId(null);
    setEditorSpaceId("");
  };

  const updateSelectedRegion = (patch: Partial<SpaceMapRegion>) => {
    if (!selectedMapRegionId) return;
    setMapRegions((regions) =>
      regions.map((region) => {
        if (region.id !== selectedMapRegionId) return region;
        const next = { ...region, ...patch };
        if (patch.space_id) {
          const space = spaces.find((item) => item.id === patch.space_id);
          next.space_name = space?.name || next.space_name;
          next.label =
            !next.label || next.label === "Región sin asignar"
              ? space?.name || null
              : next.label;
        } else if (Object.prototype.hasOwnProperty.call(patch, "space_id")) {
          next.space_name = null;
          next.label = next.label || "Región sin asignar";
        }
        return next;
      }),
    );
  };

  const handleDeleteSelectedRegion = async () => {
    if (!selectedMapRegionId || !selectedMap) return;
    const regionId = selectedMapRegionId;
    setMapRegions((regions) =>
      regions.filter((region) => region.id !== regionId),
    );
    setSelectedMapRegionId(null);

    if (regionId > 0) {
      const res = await apiWrite.request(
        `/api/space-maps/${selectedMap.id}/regions/${regionId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setToast({
          message: await readErrorMessage(res, "No se pudo eliminar la región"),
          type: "error",
        });
        await fetchSpaceMapDetail(selectedMap.id);
      }
    }
  };

  const handleSaveMapRegions = async () => {
    if (!canEditSpaces || !selectedMap) return;
    const unassignedRegion = mapRegions.find((region) => !region.space_id);
    if (unassignedRegion) {
      setSelectedMapRegionId(unassignedRegion.id);
      setToast({
        message:
          "Asigna un estacionamiento a cada región antes de guardar el mapa",
        type: "error",
      });
      return;
    }
    setIsActionLoading(true);
    const res = await apiWrite.request(
      `/api/space-maps/${selectedMap.id}/regions`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regions: mapRegions.map((region, index) => ({
            id: region.id > 0 ? region.id : undefined,
            space_id: region.space_id,
            geometry: region.geometry,
            label: region.label || undefined,
            color: region.color || undefined,
            sort_order: region.sort_order ?? index,
          })),
        }),
      },
    );

    if (res.ok) {
      const body = await res.json();
      setMapRegions(body.regions || []);
      setToast({ message: "Regiones del mapa guardadas", type: "success" });
      await fetchSpaceMapDetail(selectedMap.id);
      await fetchSpaceMaps();
    } else {
      setToast({
        message: await readErrorMessage(
          res,
          "No se pudieron guardar las regiones",
        ),
        type: "error",
      });
    }
    setIsActionLoading(false);
  };
  return {
    pointerToMapPoint,
    rectFromDrawing,
    translateGeometry,
    addDraftRegion,
    tooltipForRegion,
    handleMapPointerDown,
    handleMapPointerMove,
    handleMapPointerUp,
    handleFinishPolygon,
    handleUndoMapEdit,
    updateSelectedRegion,
    handleDeleteSelectedRegion,
    handleSaveMapRegions,
  };
}
