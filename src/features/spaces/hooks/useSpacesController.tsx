import { useSpaceNavigationState } from "./useSpaceNavigationState";
import { useInventoryState } from "./useInventoryState";
import { useVisitorState } from "./useVisitorState";
import { useSpaceMapState } from "./useSpaceMapState";
import { useMapEditorState } from "./useMapEditorState";
import {
  useSpaceMapActions,
  type Dependencies_useSpaceMapActions,
} from "./useSpaceMapActions";
import {
  useMapEditorActions,
  type Dependencies_useMapEditorActions,
} from "./useMapEditorActions";
import {
  useVisitorActions,
  type Dependencies_useVisitorActions,
} from "./useVisitorActions";
import {
  useInventoryActions,
  type Dependencies_useInventoryActions,
} from "./useInventoryActions";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useEffect, useState } from "react";

import {
  Branch,
  CashSessionClosure,
  CashSessionSummary,
  Space,
  SpaceMap,
  SpaceMapLiveRegion,
  SpaceMapRegion,
  StaffUser,
  VisitorTicket,
} from "../../../types";

import { apiFetchJson } from "../../../lib/api";

import { useIsDesktop } from "../../../ui/useMediaQuery";

import type { VisitorPaymentHistoryItem } from "../pages/spacesShared";
export function useSpacesController(user: StaffUser) {
  const canCreateSpaces = user.role === "admin";
  const canEditSpaces = user.role === "admin";
  const canOperateSpaces = user.role === "admin" || user.role === "guard";
  const canManageVisitors =
    user.role === "admin" || user.role === "guard" || user.role === "cashier";
  const canExportVisitorReports = user.role === "admin";
  const canSeeCommercialData = user.role === "admin" || user.role === "finance";
  const isInventoryOnly = user.role === "finance";

  const spaceNavigationState = useSpaceNavigationState();
  const {
    activeType,
    setActiveType,
    selectedBranchId,
    setSelectedBranchId,
    filterStatus,
    setFilterStatus,
    parkingMode,
    setParkingMode,
  } = spaceNavigationState;
  const inventoryState = useInventoryState();
  const {
    selectedSpace,
    confirmAction,
    setConfirmAction,
    openedUrlSpaceId,
    setOpenedUrlSpaceId,
  } = inventoryState;
  const visitorState = useVisitorState();

  const spaceMapState = useSpaceMapState();
  const {
    spaceMaps,
    selectedMapId,
    setSelectedMapId,
    setSelectedMap,
    liveRegions,
    setLiveRegions,
    setMapLiveSummary,
    mapFilterStatus,
    setMapFilterStatus,
    setIsMapLoading,
    setLastMapRefresh,
    pendingMapSpaceFocusId,
    setPendingMapSpaceFocusId,
  } = spaceMapState;
  const mapEditorState = useMapEditorState();
  const {
    mapRegions,
    setMapRegions,
    setIsMapEditorOpen,
    selectedMapRegionId,
    setSelectedMapRegionId,
  } = mapEditorState;
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const canUseMapEditor = useIsDesktop();
  useEffect(() => {
    if (!canUseMapEditor) setIsMapEditorOpen(false);
  }, [canUseMapEditor]);

  const queryClient = useQueryClient();
  const scopeUrl = (url: string) =>
    selectedBranchId === "all"
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}branch_id=${selectedBranchId}`;
  const inventoryQuery = useQuery({
    queryKey: ["spaces", "inventory", selectedBranchId],
    queryFn: ({ signal }) =>
      apiFetchJson<Space[]>(scopeUrl("/api/spaces"), { signal }),
  });
  const branchQuery = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) =>
      apiFetchJson<Branch[]>("/api/branches", { signal }),
  });
  const visitorQuery = useQuery({
    queryKey: ["spaces", "visitors", selectedBranchId],
    enabled: canManageVisitors && activeType === "visitors",
    queryFn: async ({ signal }) => {
      const [visitors, cash, payments, closures] = await Promise.all([
        apiFetchJson<VisitorTicket[]>(scopeUrl("/api/visitors"), { signal }),
        apiFetchJson<CashSessionSummary>(
          scopeUrl("/api/visitors/cash/current"),
          { signal },
        ),
        apiFetchJson<VisitorPaymentHistoryItem[]>(
          scopeUrl("/api/visitors/payments"),
          { signal },
        ),
        apiFetchJson<CashSessionClosure[]>(
          scopeUrl("/api/visitors/cash/closures"),
          { signal },
        ),
      ]);
      return { visitors, cash, payments, closures };
    },
  });
  const spaces = inventoryQuery.data ?? [];
  const branches = branchQuery.data ?? [];
  const visitors = visitorQuery.data?.visitors ?? [];
  const visitorCashSummary = visitorQuery.data?.cash ?? null;
  const visitorPaymentHistory = visitorQuery.data?.payments ?? [];
  const visitorCashClosures = visitorQuery.data?.closures ?? [];
  const setSpaces = (value: Space[]) =>
    queryClient.setQueryData(["spaces", "inventory", selectedBranchId], value);
  const fetchData = () =>
    queryClient.invalidateQueries({ queryKey: ["spaces"] });
  const operationsLoading =
    inventoryQuery.isPending ||
    (activeType === "visitors" && visitorQuery.isPending);
  const operationsError =
    inventoryQuery.error?.message ||
    (activeType === "visitors" ? visitorQuery.error?.message : "") ||
    "";
  const withBranchParam = (path: string) => {
    return selectedBranchId === "all"
      ? path
      : `${path}?branch_id=${selectedBranchId}`;
  };

  const availableEditorSpaces = spaces.filter((space) => {
    if (space.type !== "parking") return false;
    const mapped = mapRegions.some(
      (region) =>
        region.space_id === space.id && region.id !== selectedMapRegionId,
    );
    return !mapped;
  });

  useEffect(() => {
    if (!canManageVisitors && activeType === "visitors")
      setActiveType("parking");
  }, [activeType, canManageVisitors, selectedBranchId]);

  useEffect(() => {
    if (activeType !== "parking") setParkingMode("grid");
  }, [activeType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMapSpaceId = Number(params.get("mapSpaceId") || 0);
    if (!requestedMapSpaceId) return;

    setPendingMapSpaceFocusId(requestedMapSpaceId);
    setActiveType("parking");
    setParkingMode("map");
    setMapFilterStatus("all");
    const requestedBranchId = params.get("branchId");
    if (requestedBranchId) setSelectedBranchId(requestedBranchId);
  }, []);

  useEffect(() => {
    fetchSpaceMaps();
  }, [parkingMode, selectedBranchId]);

  useEffect(() => {
    if (parkingMode !== "map" || !selectedMapId) return;
    fetchSpaceMapDetail(selectedMapId);
  }, [parkingMode, selectedMapId]);

  useEffect(() => {
    if (activeType !== "parking" || parkingMode !== "map" || !selectedMapId)
      return;
    const timer = window.setInterval(() => {
      fetchSpaceMapDetail(selectedMapId);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeType, parkingMode, selectedMapId]);

  useEffect(() => {
    if (
      !pendingMapSpaceFocusId ||
      parkingMode !== "map" ||
      selectedBranchId === "all" ||
      spaceMaps.length === 0
    )
      return;
    let cancelled = false;

    const focusRequestedSpace = async () => {
      setIsMapLoading(true);
      try {
        for (const map of spaceMaps) {
          const detail = await apiFetchJson<{
            map: SpaceMap;
            regions: SpaceMapRegion[];
            live: SpaceMapLiveRegion[];
            summary: any;
          }>(`/api/space-maps/${map.id}`);
          const region = detail.regions.find(
            (item) => item.space_id === pendingMapSpaceFocusId,
          );
          if (region && !cancelled) {
            setSelectedMapId(map.id);
            setSelectedMap(detail.map);
            setMapRegions(detail.regions || []);
            setLiveRegions(detail.live || []);
            setMapLiveSummary(detail.summary || null);
            setSelectedMapRegionId(region.id);
            setPendingMapSpaceFocusId(null);
            setLastMapRefresh(new Date().toISOString());
            return;
          }
        }
        if (!cancelled) {
          setPendingMapSpaceFocusId(null);
          setToast({
            message:
              "El estacionamiento no tiene región asociada en los mapas de esta sucursal",
            type: "error",
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          setPendingMapSpaceFocusId(null);
          setToast({
            message:
              error.message ||
              "No se pudo enfocar el estacionamiento en el mapa",
            type: "error",
          });
        }
      } finally {
        if (!cancelled) setIsMapLoading(false);
      }
    };

    focusRequestedSpace();
    return () => {
      cancelled = true;
    };
  }, [pendingMapSpaceFocusId, parkingMode, selectedBranchId, spaceMaps]);

  useEffect(() => {
    const requestedSpaceId = Number(
      new URLSearchParams(window.location.search).get("spaceId") || 0,
    );
    if (
      !requestedSpaceId ||
      openedUrlSpaceId === requestedSpaceId ||
      spaces.length === 0
    )
      return;
    const requestedSpace = spaces.find(
      (space) => space.id === requestedSpaceId,
    );
    if (!requestedSpace) return;
    setOpenedUrlSpaceId(requestedSpaceId);
    setActiveType(requestedSpace.type);
    setFilterStatus("all");
    openSpaceDetail(requestedSpace);
  }, [spaces, openedUrlSpaceId]);

  const filteredSpaces = spaces.filter((s) => {
    if (activeType === "visitors") return false;
    const matchesType = s.type === activeType;
    const matchesStatus = filterStatus === "all" || s.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const filteredLiveRegions = liveRegions.filter(
    (region) => mapFilterStatus === "all" || region.status === mapFilterStatus,
  );
  const selectedMapRegion =
    mapRegions.find((region) => region.id === selectedMapRegionId) || null;
  const selectedMapRegionSpace = selectedMapRegion
    ? spaces.find((space) => space.id === selectedMapRegion.space_id)
    : null;
  const selectedSpaceLiveRegion = selectedSpace
    ? liveRegions.find((region) => region.space_id === selectedSpace.id)
    : null;

  const handleConfirmAction = () => {
    if (!confirmAction) return;

    if (confirmAction.type === "open-barrier") {
      executeOpenBarrier(confirmAction.space);
      return;
    }

    if (confirmAction.type === "force-release") {
      executeForceRelease(confirmAction.space);
      return;
    }

    handleUpdateStatus(confirmAction.nextStatus);
    setConfirmAction(null);
  };

  const spaceMapActions = useSpaceMapActions({
    ...spaceNavigationState,
    ...spaceMapState,
    ...inventoryState,
    ...mapEditorState,
    canCreateSpaces,
    setIsActionLoading,
    setSpaces: (
      ...args: Parameters<Dependencies_useSpaceMapActions["setSpaces"]>
    ) => setSpaces(...args),
    setToast,
  });
  const { fetchSpaceMaps, fetchSpaceMapDetail } = spaceMapActions;
  const mapEditorActions = useMapEditorActions({
    ...mapEditorState,
    ...spaceMapState,
    canEditSpaces,
    fetchSpaceMapDetail: (
      ...args: Parameters<
        Dependencies_useMapEditorActions["fetchSpaceMapDetail"]
      >
    ) => fetchSpaceMapDetail(...args),
    fetchSpaceMaps: (
      ...args: Parameters<Dependencies_useMapEditorActions["fetchSpaceMaps"]>
    ) => fetchSpaceMaps(...args),
    setIsActionLoading,
    setToast,
    spaces,
  });

  const visitorActions = useVisitorActions({
    ...visitorState,
    canManageVisitors,
    fetchData: (
      ...args: Parameters<Dependencies_useVisitorActions["fetchData"]>
    ) => fetchData(...args),
    setIsActionLoading,
    setToast,
    visitorCashSummary,
  });

  const inventoryActions = useInventoryActions({
    ...inventoryState,
    canCreateSpaces,
    canEditSpaces,
    canOperateSpaces,
    fetchData: (
      ...args: Parameters<Dependencies_useInventoryActions["fetchData"]>
    ) => fetchData(...args),
    setIsActionLoading,
    setToast,
  });
  const {
    openSpaceDetail,
    handleUpdateStatus,
    executeOpenBarrier,
    executeForceRelease,
  } = inventoryActions;

  return {
    ...spaceNavigationState,
    ...inventoryState,
    ...visitorState,
    ...spaceMapState,
    ...mapEditorState,
    ...spaceMapActions,
    ...mapEditorActions,
    ...visitorActions,
    ...inventoryActions,
    user,
    canCreateSpaces,
    canEditSpaces,
    canOperateSpaces,
    canManageVisitors,
    canExportVisitorReports,
    canSeeCommercialData,
    isInventoryOnly,
    toast,
    setToast,
    isActionLoading,
    canUseMapEditor,
    spaces,
    branches,
    visitors,
    visitorCashSummary,
    visitorPaymentHistory,
    visitorCashClosures,
    fetchData,
    operationsLoading,
    operationsError,
    withBranchParam,
    availableEditorSpaces,
    filteredSpaces,
    filteredLiveRegions,
    selectedMapRegion,
    selectedMapRegionSpace,
    selectedSpaceLiveRegion,
    handleConfirmAction,
  };
}
