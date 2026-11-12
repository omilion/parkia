import { useState } from "react";
import { SpaceMap, SpaceMapLiveRegion } from "../../../types";

export function useSpaceMapState() {
  const [spaceMaps, setSpaceMaps] = useState<SpaceMap[]>([]);
  const [mapSummary, setMapSummary] = useState<{
    totalSpaces: number;
    mappedSpaces: number;
    unmappedSpaces: number;
  } | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [selectedMap, setSelectedMap] = useState<SpaceMap | null>(null);
  const [liveRegions, setLiveRegions] = useState<SpaceMapLiveRegion[]>([]);
  const [mapLiveSummary, setMapLiveSummary] = useState<any>(null);
  const [mapFilterStatus, setMapFilterStatus] = useState<
    "all" | SpaceMapLiveRegion["status"]
  >("all");
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [isMapCreateDrawerOpen, setIsMapCreateDrawerOpen] = useState(false);
  const [lastMapRefresh, setLastMapRefresh] = useState<string | null>(null);
  const [pendingMapSpaceFocusId, setPendingMapSpaceFocusId] = useState<
    number | null
  >(null);
  return {
    spaceMaps,
    setSpaceMaps,
    mapSummary,
    setMapSummary,
    selectedMapId,
    setSelectedMapId,
    selectedMap,
    setSelectedMap,
    liveRegions,
    setLiveRegions,
    mapLiveSummary,
    setMapLiveSummary,
    mapFilterStatus,
    setMapFilterStatus,
    isMapLoading,
    setIsMapLoading,
    isMapCreateDrawerOpen,
    setIsMapCreateDrawerOpen,
    lastMapRefresh,
    setLastMapRefresh,
    pendingMapSpaceFocusId,
    setPendingMapSpaceFocusId,
  };
}
