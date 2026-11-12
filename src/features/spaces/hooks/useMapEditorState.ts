import { useState } from "react";
import { SpaceMapGeometry, SpaceMapRegion } from "../../../types";

export function useMapEditorState() {
  const [mapRegions, setMapRegions] = useState<SpaceMapRegion[]>([]);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [selectedMapRegionId, setSelectedMapRegionId] = useState<number | null>(
    null,
  );
  const [editorSpaceId, setEditorSpaceId] = useState<string>("");
  const [drawingRect, setDrawingRect] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [nextDraftRegionId, setNextDraftRegionId] = useState(-1);
  const [mapEditorTool, setMapEditorTool] = useState<
    "select" | "rect" | "polygon" | "move"
  >("select");
  const [draftPolygonPoints, setDraftPolygonPoints] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const [movingRegion, setMovingRegion] = useState<{
    regionId: number;
    startX: number;
    startY: number;
    originalGeometry: SpaceMapGeometry;
  } | null>(null);
  return {
    mapRegions,
    setMapRegions,
    isMapEditorOpen,
    setIsMapEditorOpen,
    selectedMapRegionId,
    setSelectedMapRegionId,
    editorSpaceId,
    setEditorSpaceId,
    drawingRect,
    setDrawingRect,
    nextDraftRegionId,
    setNextDraftRegionId,
    mapEditorTool,
    setMapEditorTool,
    draftPolygonPoints,
    setDraftPolygonPoints,
    movingRegion,
    setMovingRegion,
  };
}
