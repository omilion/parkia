import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Banknote, Box, Car, CheckCircle2, Clock, Map, MousePointer2, Pencil, Plus, RefreshCw, Save, Ticket, Trash2, Upload, X, Zap } from 'lucide-react';
import { Branch, CashSessionClosure, CashSessionSummary, Space, SpaceMap, SpaceMapGeometry, SpaceMapLiveRegion, SpaceMapRegion, StaffUser, VisitorQuote, VisitorReceipt, VisitorTicket } from '../types';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Drawer from '../components/ui/Drawer';
import Toast from '../components/ui/Toast';
import { apiFetchJson } from '../lib/api';
import { cn } from '../lib/utils';

type ConfirmAction =
  | { type: 'open-barrier'; space: Space }
  | { type: 'force-release'; space: Space }
  | { type: 'mark-available'; space: Space; nextStatus: string }
  | null;

type SpaceDetail = {
  space: Space;
  access: Array<{
    id: number;
    access_type: string;
    status: string;
    reason?: string | null;
    plate?: string | null;
    timestamp: string;
    client_name?: string | null;
    visitor_name?: string | null;
  }>;
  history: Array<{
    id: number;
    previous_status?: string | null;
    status: string;
    reason?: string | null;
    source: string;
    created_at: string;
    staff_name?: string | null;
  }>;
};

type VisitorPaymentDraft = VisitorQuote & {
  ticket_id: number;
  plate: string;
  space_name?: string | null;
  method: string;
  amount: string;
};

type VisitorLookupResult = {
  ticket: VisitorTicket;
  quote?: VisitorQuote | null;
};

type VisitorPaymentHistoryItem = {
  ticket_id: number;
  receipt_number: string;
  plate: string;
  entry_time: string;
  paid_at: string;
  amount: number;
  payment_method: string;
  status: VisitorTicket['status'];
  cash_session_id: number | null;
  payment_override_reason: string | null;
  space_name: string | null;
  cashier_name: string | null;
  duration_mins: number | null;
  grace_period_mins: number | null;
  billable_mins: number | null;
  rate_per_minute: number | null;
  quoted_total: number | null;
  billing_mode: string | null;
};

const readErrorMessage = async (res: Response, fallback: string) => {
  try {
    const body = await res.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
};

const paymentMethodLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  automatic: 'Automático',
  other: 'Otro',
};

const liveStatusLabels: Record<SpaceMapLiveRegion['status'], string> = {
  available: 'Libre',
  monthly: 'Mensual',
  visitor: 'Visita',
  maintenance: 'Mantención',
  unknown: 'Sin dato',
};

const liveStatusClasses: Record<SpaceMapLiveRegion['status'], string> = {
  available: 'bg-emerald-500',
  monthly: 'bg-red-500',
  visitor: 'bg-orange-500',
  maintenance: 'bg-slate-400',
  unknown: 'bg-sky-300',
};

const liveStatusFill: Record<SpaceMapLiveRegion['status'], string> = {
  available: '#10b981',
  monthly: '#ef4444',
  visitor: '#f97316',
  maintenance: '#94a3b8',
  unknown: '#7dd3fc',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getRectPath = (geometry: SpaceMapGeometry) => {
  if (geometry.type === 'polygon') {
    return geometry.points.map(point => `${point.x},${point.y}`).join(' ');
  }
  return undefined;
};

function formatCurrency(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString('es-CL')}`;
}

const SpacesPage = ({ user }: { user: StaffUser }) => {
  const canCreateSpaces = user.role === 'admin';
  const canEditSpaces = user.role === 'admin';
  const canOperateSpaces = user.role === 'admin' || user.role === 'guard';
  const canManageVisitors = user.role === 'admin' || user.role === 'guard' || user.role === 'cashier';
  const canExportVisitorReports = user.role === 'admin';
  const canSeeCommercialData = user.role === 'admin' || user.role === 'finance';
  const isInventoryOnly = user.role === 'finance';

  const [activeType, setActiveType] = useState<'parking' | 'visitors'>('parking');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [visitors, setVisitors] = useState<VisitorTicket[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [visitorPayment, setVisitorPayment] = useState<VisitorPaymentDraft | null>(null);
  const [visitorLookup, setVisitorLookup] = useState<VisitorLookupResult | null>(null);
  const [visitorReceipt, setVisitorReceipt] = useState<VisitorReceipt | null>(null);
  const [visitorSearchPlate, setVisitorSearchPlate] = useState('');
  const [visitorLostTicket, setVisitorLostTicket] = useState(false);
  const [visitorCashSummary, setVisitorCashSummary] = useState<CashSessionSummary | null>(null);
  const [visitorPaymentHistory, setVisitorPaymentHistory] = useState<VisitorPaymentHistoryItem[]>([]);
  const [visitorCashClosures, setVisitorCashClosures] = useState<CashSessionClosure[]>([]);
  const [quotingVisitorId, setQuotingVisitorId] = useState<number | null>(null);
  const [spaceDetail, setSpaceDetail] = useState<SpaceDetail | null>(null);
  const [openedUrlSpaceId, setOpenedUrlSpaceId] = useState<number | null>(null);
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [parkingMode, setParkingMode] = useState<'grid' | 'map'>('grid');
  const [spaceMaps, setSpaceMaps] = useState<SpaceMap[]>([]);
  const [mapSummary, setMapSummary] = useState<{ totalSpaces: number; mappedSpaces: number; unmappedSpaces: number } | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [selectedMap, setSelectedMap] = useState<SpaceMap | null>(null);
  const [mapRegions, setMapRegions] = useState<SpaceMapRegion[]>([]);
  const [liveRegions, setLiveRegions] = useState<SpaceMapLiveRegion[]>([]);
  const [mapLiveSummary, setMapLiveSummary] = useState<any>(null);
  const [mapFilterStatus, setMapFilterStatus] = useState<'all' | SpaceMapLiveRegion['status']>('all');
  const [isMapLoading, setIsMapLoading] = useState(false);
  const [isMapCreateDrawerOpen, setIsMapCreateDrawerOpen] = useState(false);
  const [isMapEditorOpen, setIsMapEditorOpen] = useState(false);
  const [selectedMapRegionId, setSelectedMapRegionId] = useState<number | null>(null);
  const [editorSpaceId, setEditorSpaceId] = useState<string>('');
  const [drawingRect, setDrawingRect] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [nextDraftRegionId, setNextDraftRegionId] = useState(-1);
  const [mapEditorTool, setMapEditorTool] = useState<'select' | 'rect' | 'polygon' | 'move'>('select');
  const [draftPolygonPoints, setDraftPolygonPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [movingRegion, setMovingRegion] = useState<{ regionId: number; startX: number; startY: number; originalGeometry: SpaceMapGeometry } | null>(null);
  const [lastMapRefresh, setLastMapRefresh] = useState<string | null>(null);
  const [pendingMapSpaceFocusId, setPendingMapSpaceFocusId] = useState<number | null>(null);

  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isVisitorTicketDrawerOpen, setIsVisitorTicketDrawerOpen] = useState(false);
  const [isCashCloseDrawerOpen, setIsCashCloseDrawerOpen] = useState(false);

  const withBranchParam = (path: string) => {
    return selectedBranchId === 'all' ? path : `${path}?branch_id=${selectedBranchId}`;
  };

  const fetchSpaceMaps = async () => {
    if (parkingMode !== 'map' || selectedBranchId === 'all') {
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
        summary: { totalSpaces: number; mappedSpaces: number; unmappedSpaces: number };
      }>(`/api/space-maps?branch_id=${selectedBranchId}`);
      setSpaceMaps(data.maps);
      setMapSummary(data.summary);
      if (data.spaces?.length) setSpaces(data.spaces);

      const nextMap = data.maps.find(map => map.id === selectedMapId) || data.maps.find(map => map.is_default) || data.maps[0] || null;
      setSelectedMapId(nextMap?.id || null);
      if (!nextMap) {
        setSelectedMap(null);
        setMapRegions([]);
        setLiveRegions([]);
      }
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudieron cargar los mapas aéreos', type: 'error' });
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
      setSelectedMapRegionId(current => current && data.regions?.some(region => region.id === current) ? current : null);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo cargar el mapa aéreo', type: 'error' });
    } finally {
      setIsMapLoading(false);
    }
  };

  const pointerToMapPoint = (event: React.PointerEvent<SVGElement>) => {
    const currentTarget = event.currentTarget as SVGElement;
    const svg = currentTarget.ownerSVGElement || currentTarget;
    const bounds = svg.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  };

  const rectFromDrawing = (rect: { startX: number; startY: number; currentX: number; currentY: number }) => ({
    type: 'rect' as const,
    x: Math.min(rect.startX, rect.currentX),
    y: Math.min(rect.startY, rect.currentY),
    width: Math.abs(rect.currentX - rect.startX),
    height: Math.abs(rect.currentY - rect.startY),
  });

  const translateGeometry = (geometry: SpaceMapGeometry, dx: number, dy: number): SpaceMapGeometry => {
    if (geometry.type === 'rect') {
      return {
        ...geometry,
        x: Math.min(1 - geometry.width, Math.max(0, geometry.x + dx)),
        y: Math.min(1 - geometry.height, Math.max(0, geometry.y + dy)),
      };
    }

    const minX = Math.min(...geometry.points.map(point => point.x));
    const maxX = Math.max(...geometry.points.map(point => point.x));
    const minY = Math.min(...geometry.points.map(point => point.y));
    const maxY = Math.max(...geometry.points.map(point => point.y));
    const safeDx = Math.min(1 - maxX, Math.max(-minX, dx));
    const safeDy = Math.min(1 - maxY, Math.max(-minY, dy));
    return {
      ...geometry,
      points: geometry.points.map(point => ({
        x: clamp01(point.x + safeDx),
        y: clamp01(point.y + safeDy),
      })),
    };
  };

  const addDraftRegion = (spaceId: number, geometry: SpaceMapGeometry) => {
    if (!selectedMap) return;
    const space = spaces.find(item => item.id === spaceId);
    const draftId = nextDraftRegionId;
    setNextDraftRegionId(id => id - 1);
    setMapRegions(regions => [
      ...regions,
      {
        id: draftId,
        map_id: selectedMap.id,
        space_id: spaceId,
        space_name: space?.name || null,
        geometry,
        label: space?.name || null,
        color: '#0f172a',
        sort_order: regions.length,
      },
    ]);
    setSelectedMapRegionId(draftId);
    setEditorSpaceId('');
  };

  const tooltipForRegion = (region: SpaceMapRegion | SpaceMapLiveRegion) => {
    const live = liveRegions.find(item => item.id === region.id);
    const status = live ? liveStatusLabels[live.status] : 'Región editable';
    const details = [live?.client_name, live?.plate, live?.contract_id ? `Contrato #${live.contract_id}` : null, live?.visitor_ticket_id ? `Ticket #${live.visitor_ticket_id}` : null]
      .filter(Boolean)
      .join(' · ');
    return `${region.label || region.space_name || `Cupo #${region.space_id}`} · ${status}${details ? ` · ${details}` : ''}`;
  };

  const availableEditorSpaces = spaces.filter(space => {
    if (space.type !== 'parking') return false;
    const mapped = mapRegions.some(region => region.space_id === space.id && region.id !== selectedMapRegionId);
    return !mapped;
  });

  const handleMapPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!canEditSpaces || !isMapEditorOpen || !selectedMap) return;
    if (mapEditorTool === 'select') {
      setSelectedMapRegionId(null);
      return;
    }
    if (mapEditorTool === 'move') {
      setSelectedMapRegionId(null);
      return;
    }
    if (!editorSpaceId) {
      setToast({ message: 'Selecciona un estacionamiento antes de dibujar una región', type: 'error' });
      return;
    }
    const point = pointerToMapPoint(event);
    if (mapEditorTool === 'polygon') {
      setDraftPolygonPoints(points => [...points, point]);
      return;
    }
    if (mapEditorTool === 'rect') {
      setDrawingRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
    }
  };

  const handleMapPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointerToMapPoint(event);
    if (movingRegion) {
      const dx = point.x - movingRegion.startX;
      const dy = point.y - movingRegion.startY;
      setMapRegions(regions => regions.map(region => (
        region.id === movingRegion.regionId
          ? { ...region, geometry: translateGeometry(movingRegion.originalGeometry, dx, dy) }
          : region
      )));
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
    if (!drawingRect || !selectedMap || mapEditorTool !== 'rect') return;
    const geometry = rectFromDrawing(drawingRect);
    setDrawingRect(null);
    if (geometry.width < 0.01 || geometry.height < 0.01) return;

    addDraftRegion(Number(editorSpaceId), geometry);
  };

  const handleFinishPolygon = () => {
    if (!editorSpaceId) {
      setToast({ message: 'Selecciona un estacionamiento antes de cerrar el polígono', type: 'error' });
      return;
    }
    if (draftPolygonPoints.length < 3) {
      setToast({ message: 'El polígono necesita al menos 3 puntos', type: 'error' });
      return;
    }
    addDraftRegion(Number(editorSpaceId), { type: 'polygon', points: draftPolygonPoints });
    setDraftPolygonPoints([]);
  };

  const updateSelectedRegion = (patch: Partial<SpaceMapRegion>) => {
    if (!selectedMapRegionId) return;
    setMapRegions(regions => regions.map(region => {
      if (region.id !== selectedMapRegionId) return region;
      const next = { ...region, ...patch };
      if (patch.space_id) {
        const space = spaces.find(item => item.id === patch.space_id);
        next.space_name = space?.name || next.space_name;
        next.label = next.label || space?.name || null;
      }
      return next;
    }));
  };

  const handleDeleteSelectedRegion = async () => {
    if (!selectedMapRegionId || !selectedMap) return;
    const regionId = selectedMapRegionId;
    setMapRegions(regions => regions.filter(region => region.id !== regionId));
    setSelectedMapRegionId(null);

    if (regionId > 0) {
      const res = await fetch(`/api/space-maps/${selectedMap.id}/regions/${regionId}`, { method: 'DELETE' });
      if (!res.ok) {
        setToast({ message: await readErrorMessage(res, 'No se pudo eliminar la región'), type: 'error' });
        await fetchSpaceMapDetail(selectedMap.id);
      }
    }
  };

  const handleSaveMapRegions = async () => {
    if (!canEditSpaces || !selectedMap) return;
    setIsActionLoading(true);
    const res = await fetch(`/api/space-maps/${selectedMap.id}/regions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
    });

    if (res.ok) {
      const body = await res.json();
      setMapRegions(body.regions || []);
      setToast({ message: 'Regiones del mapa guardadas', type: 'success' });
      await fetchSpaceMapDetail(selectedMap.id);
      await fetchSpaceMaps();
    } else {
      setToast({ message: await readErrorMessage(res, 'No se pudieron guardar las regiones'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const readImagePayload = (file: File) => new Promise<{ fileName: string; mimeType: string; dataBase64: string; width: number; height: number }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const image = new Image();
      image.onerror = () => reject(new Error('No se pudo validar la imagen'));
      image.onload = () => {
        resolve({
          fileName: file.name,
          mimeType: file.type,
          dataBase64: result.split(',')[1] || '',
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      };
      image.src = result;
    };
    reader.readAsDataURL(file);
  });

  const handleCreateSpaceMap = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateSpaces) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('image') as File | null;
    const branchId = String(formData.get('branch_id') || '');
    const name = String(formData.get('name') || '').trim();

    if (!branchId || branchId === 'all') {
      setToast({ message: 'Selecciona una sucursal para crear el mapa', type: 'error' });
      return;
    }
    if (!file || file.size === 0) {
      setToast({ message: 'Selecciona una imagen JPG o PNG', type: 'error' });
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setToast({ message: 'La imagen debe ser JPG o PNG y pesar máximo 10MB', type: 'error' });
      return;
    }

    setIsActionLoading(true);
    try {
      const image = await readImagePayload(file);
      const res = await fetch('/api/space-maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          is_default: Boolean(formData.get('is_default')),
        }),
      });

      if (res.ok) {
        const body = await res.json();
        setToast({ message: 'Mapa aéreo creado', type: 'success' });
        setIsMapCreateDrawerOpen(false);
        if (selectedBranchId !== branchId) setSelectedBranchId(branchId);
        setSelectedMapId(body.map?.id || null);
        if (selectedBranchId === branchId) await fetchSpaceMaps();
        form.reset();
      } else {
        setToast({ message: await readErrorMessage(res, 'No se pudo crear el mapa aéreo'), type: 'error' });
      }
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo procesar la imagen', type: 'error' });
    } finally {
      setIsActionLoading(false);
    }
  };

  const focusSpaceOnMap = async (space: Space) => {
    if (!space.branch_id) {
      setToast({ message: 'El estacionamiento no tiene sucursal asociada', type: 'error' });
      return;
    }

    setActiveType('parking');
    setParkingMode('map');
    setSelectedBranchId(String(space.branch_id));
    setMapFilterStatus('all');
    setIsDrawerOpen(false);
    setIsMapLoading(true);

    try {
      const list = await apiFetchJson<{
        maps: SpaceMap[];
        spaces: Space[];
        summary: { totalSpaces: number; mappedSpaces: number; unmappedSpaces: number };
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
        const region = detail.regions.find(item => item.space_id === space.id);
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

      setToast({ message: 'Este estacionamiento todavía no tiene región en un mapa', type: 'error' });
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo abrir el mapa del estacionamiento', type: 'error' });
    } finally {
      setIsMapLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      const [branchesData, spacesData] = await Promise.all([
        apiFetchJson<Branch[]>('/api/branches'),
        apiFetchJson<Space[]>(withBranchParam('/api/spaces')),
      ]);
      setBranches(branchesData);
      setSpaces(spacesData);

      if (canManageVisitors) {
        const [visitorsData, cashData, paymentHistoryData, cashClosuresData] = await Promise.all([
          apiFetchJson<VisitorTicket[]>(withBranchParam('/api/visitors')),
          apiFetchJson<CashSessionSummary>(withBranchParam('/api/visitors/cash/current')),
          apiFetchJson<VisitorPaymentHistoryItem[]>(withBranchParam('/api/visitors/payments')),
          apiFetchJson<CashSessionClosure[]>(withBranchParam('/api/visitors/cash/closures')),
        ]);
        setVisitors(visitorsData);
        setVisitorCashSummary(cashData);
        setVisitorPaymentHistory(paymentHistoryData);
        setVisitorCashClosures(cashClosuresData);
      } else {
        setVisitors([]);
        setVisitorCashSummary(null);
        setVisitorPaymentHistory([]);
        setVisitorCashClosures([]);
      }
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo cargar espacios', type: 'error' });
    }
  };

  const openSpaceDetail = async (space: Space) => {
    setSelectedSpace(space);
    setSpaceDetail(null);
    setIsDrawerOpen(true);
    try {
      const detail = await apiFetchJson<SpaceDetail>(`/api/spaces/${space.id}/detail`);
      setSpaceDetail(detail);
      setSelectedSpace(detail.space);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo cargar la ficha del espacio', type: 'error' });
    }
  };

  useEffect(() => {
    if (!canManageVisitors && activeType === 'visitors') setActiveType('parking');
    fetchData();
  }, [activeType, canManageVisitors, selectedBranchId]);

  useEffect(() => {
    if (activeType !== 'parking') setParkingMode('grid');
  }, [activeType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMapSpaceId = Number(params.get('mapSpaceId') || 0);
    if (!requestedMapSpaceId) return;

    setPendingMapSpaceFocusId(requestedMapSpaceId);
    setActiveType('parking');
    setParkingMode('map');
    setMapFilterStatus('all');
    const requestedBranchId = params.get('branchId');
    if (requestedBranchId) setSelectedBranchId(requestedBranchId);
  }, []);

  useEffect(() => {
    fetchSpaceMaps();
  }, [parkingMode, selectedBranchId]);

  useEffect(() => {
    if (parkingMode !== 'map' || !selectedMapId) return;
    fetchSpaceMapDetail(selectedMapId);
  }, [parkingMode, selectedMapId]);

  useEffect(() => {
    if (activeType !== 'parking' || parkingMode !== 'map' || !selectedMapId) return;
    const timer = window.setInterval(() => {
      fetchSpaceMapDetail(selectedMapId);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeType, parkingMode, selectedMapId]);

  useEffect(() => {
    if (!pendingMapSpaceFocusId || parkingMode !== 'map' || selectedBranchId === 'all' || spaceMaps.length === 0) return;
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
          const region = detail.regions.find(item => item.space_id === pendingMapSpaceFocusId);
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
          setToast({ message: 'El estacionamiento no tiene región asociada en los mapas de esta sucursal', type: 'error' });
        }
      } catch (error: any) {
        if (!cancelled) {
          setPendingMapSpaceFocusId(null);
          setToast({ message: error.message || 'No se pudo enfocar el estacionamiento en el mapa', type: 'error' });
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
    const requestedSpaceId = Number(new URLSearchParams(window.location.search).get('spaceId') || 0);
    if (!requestedSpaceId || openedUrlSpaceId === requestedSpaceId || spaces.length === 0) return;
    const requestedSpace = spaces.find(space => space.id === requestedSpaceId);
    if (!requestedSpace) return;
    setOpenedUrlSpaceId(requestedSpaceId);
    setActiveType(requestedSpace.type);
    setFilterStatus('all');
    openSpaceDetail(requestedSpace);
  }, [spaces, openedUrlSpaceId]);

  const filteredSpaces = spaces.filter(s => {
    if (activeType === 'visitors') return false;
    const matchesType = s.type === activeType;
    const matchesStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const filteredLiveRegions = liveRegions.filter(region => mapFilterStatus === 'all' || region.status === mapFilterStatus);
  const selectedMapRegion = mapRegions.find(region => region.id === selectedMapRegionId) || null;
  const selectedMapRegionSpace = selectedMapRegion ? spaces.find(space => space.id === selectedMapRegion.space_id) : null;
  const selectedSpaceLiveRegion = selectedSpace ? liveRegions.find(region => region.space_id === selectedSpace.id) : null;

  const openVisitorPayment = async (visitor: VisitorTicket) => {
    if (!canManageVisitors) return;
    setQuotingVisitorId(visitor.id);
    try {
      const quote = await apiFetchJson<VisitorQuote>(`/api/visitors/${visitor.id}/quote`);
      setVisitorPayment({
        ...quote,
        ticket_id: visitor.id,
        plate: visitor.plate,
        space_name: visitor.space_name || null,
        method: 'cash',
        amount: String(quote.total),
      });
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo calcular el cobro de la visita', type: 'error' });
    } finally {
      setQuotingVisitorId(null);
    }
  };

  const handleLookupVisitor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageVisitors) return;
    const plate = visitorSearchPlate.trim();
    if (!plate) return;
    setIsActionLoading(true);
    try {
      const params = new URLSearchParams({ plate });
      if (visitorLostTicket) params.set('lost_ticket', 'true');
      const result = await apiFetchJson<VisitorLookupResult>(`/api/visitors/lookup?${params}`);
      setVisitorLookup(result);
      if (result.ticket.status === 'active') {
        await openVisitorPayment(result.ticket);
      } else if (result.ticket.status === 'paid') {
        setToast({ message: 'Ticket pagado encontrado. Puedes autorizar salida.', type: 'success' });
      }
    } catch (error: any) {
      setVisitorLookup(null);
      setToast({ message: error.message || 'No se encontró ticket para esa patente', type: 'error' });
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleUpdateStatus = async (status: string, notes: string = '') => {
    if (!canOperateSpaces) return;
    if (!selectedSpace) return;
    setIsActionLoading(true);
    const res = await fetch(`/api/spaces/${selectedSpace.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes })
    });
    if (res.ok) {
      setToast({ message: `Espacio ${selectedSpace.name} actualizado a ${status}`, type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al actualizar el espacio'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const executeOpenBarrier = async (space: Space) => {
    if (!canOperateSpaces) return;
    setIsActionLoading(true);
    const res = await fetch(`/api/spaces/${space.id}/open-barrier`, { method: 'POST' });
    if (res.ok) {
      const body = await res.json();
      setToast({ message: body.message || `Apertura manual registrada para ${space.name}`, type: 'success' });
      setIsDrawerOpen(false);
      setConfirmAction(null);
      fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al registrar la apertura manual'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const executeForceRelease = async (space: Space) => {
    if (!canOperateSpaces) return;
    const reason = window.prompt(`Motivo obligatorio para liberar ${space.name}`);
    if (!reason?.trim()) {
      setToast({ message: 'Debes ingresar un motivo para liberar manualmente el espacio', type: 'error' });
      setConfirmAction(null);
      return;
    }
    setIsActionLoading(true);
    const res = await fetch(`/api/spaces/${space.id}/force-release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() })
    });
    if (res.ok) {
      setToast({ message: 'Espacio liberado y limpiado forzosamente', type: 'success' });
      setIsDrawerOpen(false);
      setConfirmAction(null);
      fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al liberar el espacio'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handlePayVisitor = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageVisitors) return;
    if (!visitorPayment) return;

    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const method = String(formData.get('method') || 'cash');
    const amount = Number(formData.get('amount') || 0);
    const overrideReason = String(formData.get('override_reason') || '').trim();
    const res = await fetch(`/api/visitors/${visitorPayment.ticket_id}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, amount, quote_id: visitorPayment.id, override_reason: overrideReason || undefined })
    });

    if (res.ok) {
      const body = await res.json();
      setToast({ message: 'Pago de visita registrado. Pase de salida generado.', type: 'success' });
      setVisitorReceipt(body.receipt || null);
      setVisitorPayment(null);
      await fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al registrar pago de visita'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleCreateVisitorTicket = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageVisitors) return;
    setIsActionLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/visitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      const body = await res.json();
      setToast({ message: `Ticket #${body.ticket.ticketId} creado para ${body.ticket.plate}`, type: 'success' });
      setIsVisitorTicketDrawerOpen(false);
      form.reset();
      await fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'No se pudo crear el ticket'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleCompleteVisitor = async (id: number) => {
    if (!canManageVisitors) return;
    setIsActionLoading(true);
    const res = await fetch(`/api/visitors/${id}/complete`, { method: 'POST' });
    if (res.ok) {
      setToast({ message: 'Visita finalizada. Cupo liberado.', type: 'success' });
      if (visitorReceipt?.ticket_id === id) setVisitorReceipt(null);
      await fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al autorizar salida'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleCloseVisitorCashSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canManageVisitors || !visitorCashSummary) return;
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = {
      counted_cash: Number(formData.get('counted_cash') || 0),
      counted_transfer: Number(formData.get('counted_transfer') || 0),
      counted_card: Number(formData.get('counted_card') || 0),
      notes: String(formData.get('notes') || '').trim() || undefined,
      handover_notes: String(formData.get('handover_notes') || '').trim() || undefined,
    };

    const res = await fetch('/api/visitors/cash/current/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      const body = await res.json();
      const difference = Number(body.closure?.difference_cash || 0);
      setToast({
        message: difference === 0 ? 'Caja cerrada y cuadrada.' : `Caja cerrada con diferencia de ${formatCurrency(difference)}.`,
        type: 'success',
      });
      setIsCashCloseDrawerOpen(false);
      await fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'No se pudo cerrar la caja'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleCreateSpace = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canCreateSpaces) return;
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Espacio creado exitosamente', type: 'success' });
      setIsCreateDrawerOpen(false);
      fetchData();
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al crear el espacio'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleUpdateSpace = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canEditSpaces || !editingSpace) return;
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch(`/api/spaces/${editingSpace.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (res.ok) {
      setToast({ message: 'Ficha de espacio actualizada', type: 'success' });
      setEditingSpace(null);
      await fetchData();
      const updated = await apiFetchJson<SpaceDetail>(`/api/spaces/${editingSpace.id}/detail`);
      setSpaceDetail(updated);
      setSelectedSpace(updated.space);
    } else {
      setToast({ message: await readErrorMessage(res, 'Error al actualizar el espacio'), type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleConfirmAction = () => {
    if (!confirmAction) return;

    if (confirmAction.type === 'open-barrier') {
      executeOpenBarrier(confirmAction.space);
      return;
    }

    if (confirmAction.type === 'force-release') {
      executeForceRelease(confirmAction.space);
      return;
    }

    handleUpdateStatus(confirmAction.nextStatus);
    setConfirmAction(null);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Control de Espacios</h2>
          <p className="text-slate-500 mt-1">
            {isInventoryOnly ? 'Inventario comercial de ocupación, tarifas y asignaciones.' : 'Monitoreo de ocupación y gestión de activos físicos.'}
          </p>
        </div>
        <div className="flex overflow-x-auto bg-slate-100 p-1.5 rounded-2xl" role="tablist" aria-label="Tipo de espacio">
          {[
            { id: 'parking', label: 'Estacionamientos', icon: Car },
            ...(canManageVisitors ? [{ id: 'visitors', label: 'Visitas', icon: Ticket }] : [])
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveType(tab.id as any)}
              role="tab"
              aria-selected={activeType === tab.id}
              className={cn(
                "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
                activeType === tab.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        {canCreateSpaces && activeType !== 'visitors' && (
          <div className="flex flex-wrap justify-end gap-3">
            {parkingMode === 'map' && (
              <button
                onClick={() => setIsMapCreateDrawerOpen(true)}
                className="px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all"
              >
                <Upload className="w-5 h-5" />
                Nuevo Mapa
              </button>
            )}
            <button
              onClick={() => setIsCreateDrawerOpen(true)}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
            >
              <Box className="w-5 h-5" />
              Nuevo Estacionamiento
            </button>
          </div>
        )}
        {canManageVisitors && activeType === 'visitors' && (
          <button
            onClick={() => setIsVisitorTicketDrawerOpen(true)}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
          >
            <Plus className="w-5 h-5" />
            Crear Ticket
          </button>
        )}
      </div>

      {activeType !== 'visitors' ? (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-fit bg-slate-100 p-1 rounded-xl" role="tablist" aria-label="Vista de estacionamientos">
              {[
                { id: 'grid', label: 'Grilla', icon: Box },
                { id: 'map', label: 'Mapa aéreo', icon: Map },
              ].map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setParkingMode(mode.id as 'grid' | 'map')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                    parkingMode === mode.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  <mode.icon className="w-4 h-4" />
                  {mode.label}
                </button>
              ))}
            </div>
            {parkingMode === 'map' && mapSummary && (
              <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-500">
                <span>Total: {mapSummary.totalSpaces}</span>
                <span>Mapeados: {mapSummary.mappedSpaces}</span>
                <span>Sin mapear: {mapSummary.unmappedSpaces}</span>
              </div>
            )}
          </div>

          {parkingMode === 'grid' ? (
            <>
          <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedBranchId}
                onChange={event => setSelectedBranchId(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900"
                aria-label="Filtrar por sucursal"
              >
                <option value="all">Todas las sucursales</option>
                {branches.filter(branch => branch.status === 'active').map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {['all', 'available', 'occupied', 'maintenance'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all",
                      filterStatus === status
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {status === 'all' ? 'Todos' :
                      status === 'available' ? 'Libres' :
                        status === 'occupied' ? 'Ocupados' : 'Mantención'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 lg:gap-8 text-sm font-bold">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Libres: {spaces.filter(s => s.type === activeType && s.status === 'available').length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-slate-500">Ocupados: {spaces.filter(s => s.type === activeType && s.status === 'occupied').length}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {filteredSpaces.map(space => (
              <motion.button
                key={space.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openSpaceDetail(space)}
                className={cn(
                  "aspect-square rounded-2xl border-2 p-4 flex flex-col justify-between transition-all text-left relative overflow-hidden group",
                  space.status === 'available' ? "bg-emerald-50/30 border-emerald-100 hover:border-emerald-300" :
                    space.status === 'occupied' ? "bg-white border-slate-100 hover:border-slate-300" :
                      "bg-slate-50 border-slate-100 opacity-60"
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-400">{space.name}</span>
                    {space.branch_name && selectedBranchId === 'all' && (
                      <span className="mt-0.5 block truncate text-[9px] font-bold uppercase tracking-wider text-slate-300">{space.branch_name}</span>
                    )}
                  </div>
                  {space.is_present && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </div>

                <div className="flex flex-col gap-1 mt-auto">
                  {space.status === 'occupied' ? (
                    <>
                      <p className="text-[10px] font-bold text-slate-900 truncate">{space.assigned_client?.name || 'Visita temporal'}</p>
                      <p className="text-[8px] text-slate-400 font-mono">
                        {canSeeCommercialData ? (space.assigned_client?.rut || space.current_plate) : (space.current_plate || 'Cliente asignado')}
                      </p>
                    </>
                  ) : space.status === 'maintenance' ? (
                    <AlertTriangle className="w-4 h-4 text-slate-400" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Zap className="w-3 h-3 text-emerald-600" />
                    </div>
                  )}
                  {space.is_present && space.entry_time && (
                    <div className="flex items-center gap-1 mt-1 text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-md w-fit">
                      <Clock className="w-2 h-2 text-indigo-500" />
                      {new Date(space.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {space.current_plate && ` • ${space.current_plate}`}
                    </div>
                  )}
                </div>

                {space.status === 'occupied' && canSeeCommercialData && space.assigned_client?.financial_status && (
                  <div className={cn(
                    "absolute bottom-0 left-0 right-0 h-1",
                    space.assigned_client?.financial_status === 'up-to-date' ? "bg-emerald-500" : "bg-red-500"
                  )} />
                )}
              </motion.button>
            ))}
          </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={selectedBranchId}
                    onChange={event => setSelectedBranchId(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900"
                    aria-label="Sucursal para mapa aéreo"
                  >
                    <option value="all">Selecciona una sucursal</option>
                    {branches.filter(branch => branch.status === 'active').map(branch => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                  <select
                    value={selectedMapId || ''}
                    onChange={event => setSelectedMapId(Number(event.target.value) || null)}
                    disabled={selectedBranchId === 'all' || spaceMaps.length === 0}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900 disabled:opacity-50"
                    aria-label="Mapa aéreo"
                  >
                    <option value="">Sin mapa seleccionado</option>
                    {spaceMaps.map(map => (
                      <option key={map.id} value={map.id}>{map.name}{map.is_default ? ' · default' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'available', 'monthly', 'visitor', 'maintenance'] as const).map(status => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setMapFilterStatus(status)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all",
                        mapFilterStatus === status
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                      )}
                    >
                      {status === 'all' ? 'Todos' : liveStatusLabels[status]}
                    </button>
                  ))}
                  <button type="button" onClick={() => fetchSpaceMapDetail()} disabled={!selectedMapId} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Actualizar mapa">
                    <RefreshCw className={cn("h-4 w-4", isMapLoading && "animate-spin")} />
                  </button>
                </div>
              </div>

              {selectedBranchId === 'all' ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Map className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">Selecciona una sucursal para operar el mapa aéreo.</p>
                </div>
              ) : !selectedMap ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Upload className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">{isMapLoading ? 'Cargando mapas...' : 'No hay mapa aéreo activo para esta sucursal.'}</p>
                  {canCreateSpaces && (
                    <button type="button" onClick={() => setIsMapCreateDrawerOpen(true)} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
                      Cargar mapa
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-black text-slate-900">{selectedMap.name}</p>
                        <p className="text-xs text-slate-500">{selectedMap.branch_name || 'Sucursal'} · {filteredLiveRegions.length} regiones visibles</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {Object.entries(liveStatusLabels).map(([status, label]) => (
                          <span key={status} className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            <span className={cn("h-2.5 w-2.5 rounded-full", liveStatusClasses[status as SpaceMapLiveRegion['status']])} />
                            {label}
                          </span>
                        ))}
                        {canEditSpaces && (
                          <button
                            type="button"
                            onClick={() => setIsMapEditorOpen(value => !value)}
                            className={cn(
                              "ml-0 md:ml-2 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold",
                              isMapEditorOpen ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <MousePointer2 className="h-4 w-4" />
                            Editor
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="relative bg-slate-100">
                      <img src={selectedMap.image_url} alt={selectedMap.name} className="block w-full select-none" draggable={false} />
                      <svg
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        className={cn(
                          "absolute inset-0 h-full w-full",
                          isMapEditorOpen && mapEditorTool === 'move' ? "cursor-move" :
                            isMapEditorOpen && (mapEditorTool === 'rect' || mapEditorTool === 'polygon') ? "cursor-crosshair" :
                              "cursor-default"
                        )}
                        onPointerDown={handleMapPointerDown}
                        onPointerMove={handleMapPointerMove}
                        onPointerUp={handleMapPointerUp}
                        onPointerLeave={() => {
                          setDrawingRect(null);
                          setMovingRegion(null);
                        }}
                      >
                        {(isMapEditorOpen ? mapRegions : filteredLiveRegions).map(region => {
                          const live = liveRegions.find(item => item.id === region.id);
                          const fill = isMapEditorOpen ? (region.color || '#0f172a') : liveStatusFill[live?.status || 'unknown'];
                          const isSelected = selectedMapRegionId === region.id;
                          const tooltip = tooltipForRegion(region);
                          const commonProps = {
                            fill,
                            fillOpacity: isMapEditorOpen ? 0.25 : 0.55,
                            stroke: isSelected ? '#0f172a' : fill,
                            strokeWidth: isSelected ? 0.006 : 0.003,
                            vectorEffect: 'non-scaling-stroke' as const,
                            className: 'transition-opacity hover:opacity-80',
                            onPointerDown: (event: React.PointerEvent<SVGElement>) => {
                              event.stopPropagation();
                              if (!isMapEditorOpen) return;
                              setSelectedMapRegionId(region.id);
                              setEditorSpaceId(String(region.space_id));
                              if (mapEditorTool === 'move') {
                                const point = pointerToMapPoint(event);
                                setMovingRegion({ regionId: region.id, startX: point.x, startY: point.y, originalGeometry: region.geometry });
                              }
                            },
                            onClick: (event: React.MouseEvent) => {
                              event.stopPropagation();
                              if (isMapEditorOpen) {
                                setSelectedMapRegionId(region.id);
                                setEditorSpaceId(String(region.space_id));
                                return;
                              }
                              const space = spaces.find(item => item.id === region.space_id);
                              if (space) {
                                setSelectedMapRegionId(region.id);
                                openSpaceDetail(space);
                              }
                            },
                          };

                          if (region.geometry.type === 'polygon') {
                            return (
                              <polygon key={region.id} points={getRectPath(region.geometry)} {...commonProps}>
                                <title>{tooltip}</title>
                              </polygon>
                            );
                          }

                          return (
                            <rect
                              key={region.id}
                              x={region.geometry.x}
                              y={region.geometry.y}
                              width={region.geometry.width}
                              height={region.geometry.height}
                              rx={0.006}
                              {...commonProps}
                            >
                              <title>{tooltip}</title>
                            </rect>
                          );
                        })}
                        {draftPolygonPoints.length > 0 && (
                          <>
                            <polyline
                              points={draftPolygonPoints.map(point => `${point.x},${point.y}`).join(' ')}
                              fill="none"
                              stroke="#0f172a"
                              strokeWidth={0.004}
                              vectorEffect="non-scaling-stroke"
                            />
                            {draftPolygonPoints.map((point, index) => (
                              <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={0.01} fill="#0f172a" vectorEffect="non-scaling-stroke" />
                            ))}
                          </>
                        )}
                        {drawingRect && (
                          <rect
                            x={rectFromDrawing(drawingRect).x}
                            y={rectFromDrawing(drawingRect).y}
                            width={rectFromDrawing(drawingRect).width}
                            height={rectFromDrawing(drawingRect).height}
                            fill="#0f172a"
                            fillOpacity={0.18}
                            stroke="#0f172a"
                            strokeWidth={0.004}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                      </svg>
                    </div>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Operación en vivo</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                        <span className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">Libres {liveRegions.filter(region => region.status === 'available').length}</span>
                        <span className="rounded-xl bg-red-50 px-3 py-2 text-red-700">Mensual {liveRegions.filter(region => region.status === 'monthly').length}</span>
                        <span className="rounded-xl bg-orange-50 px-3 py-2 text-orange-700">Visitas {liveRegions.filter(region => region.status === 'visitor').length}</span>
                        <span className="rounded-xl bg-slate-100 px-3 py-2 text-slate-600">Mant. {liveRegions.filter(region => region.status === 'maintenance').length}</span>
                      </div>
                      {lastMapRefresh && <p className="mt-3 text-xs text-slate-500">Actualizado: {new Date(lastMapRefresh).toLocaleTimeString()}</p>}
                    </div>

                    {isMapEditorOpen && canEditSpaces && (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-900">Editor de regiones</p>
                            <p className="text-xs text-slate-500">Dibuja, mueve y asigna regiones normalizadas.</p>
                          </div>
                          <button type="button" onClick={handleSaveMapRegions} disabled={isActionLoading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                            <Save className="h-4 w-4" />
                            Guardar
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'select', label: 'Seleccionar' },
                            { id: 'rect', label: 'Rectángulo' },
                            { id: 'polygon', label: 'Polígono' },
                            { id: 'move', label: 'Mover' },
                          ].map(tool => (
                            <button
                              key={tool.id}
                              type="button"
                              onClick={() => {
                                setMapEditorTool(tool.id as 'select' | 'rect' | 'polygon' | 'move');
                                setDrawingRect(null);
                                setMovingRegion(null);
                                if (tool.id !== 'polygon') setDraftPolygonPoints([]);
                              }}
                              className={cn(
                                "rounded-xl border px-3 py-2 text-xs font-bold transition-all",
                                mapEditorTool === tool.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              )}
                            >
                              {tool.label}
                            </button>
                          ))}
                        </div>
                        {draftPolygonPoints.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-bold text-slate-600">{draftPolygonPoints.length} punto(s) del polígono</p>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button type="button" onClick={handleFinishPolygon} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">
                                Cerrar polígono
                              </button>
                              <button type="button" onClick={() => setDraftPolygonPoints([])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Cupo para nueva región</label>
                          <select value={editorSpaceId} onChange={event => setEditorSpaceId(event.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900">
                            <option value="">Selecciona cupo</option>
                            {availableEditorSpaces.map(space => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))}
                          </select>
                        </div>

                        {selectedMapRegion && (
                          <div className="space-y-3 border-t border-slate-100 pt-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Región seleccionada</p>
                            <select value={selectedMapRegion.space_id} onChange={event => updateSelectedRegion({ space_id: Number(event.target.value) })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900">
                              {[selectedMapRegionSpace, ...availableEditorSpaces].filter(Boolean).map(space => (
                                <option key={space!.id} value={space!.id}>{space!.name}</option>
                              ))}
                            </select>
                            <input value={selectedMapRegion.label || ''} onChange={event => updateSelectedRegion({ label: event.target.value })} placeholder="Etiqueta visible" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900" />
                            <div className="flex items-center gap-3">
                              <input type="color" value={selectedMapRegion.color || '#0f172a'} onChange={event => updateSelectedRegion({ color: event.target.value })} className="h-10 w-14 rounded-lg border border-slate-200 bg-white" aria-label="Color de región" />
                              <button type="button" onClick={handleDeleteSelectedRegion} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50">
                                <Trash2 className="h-4 w-4" />
                                Eliminar región
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Regiones</p>
                      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                        {filteredLiveRegions.map(region => (
                          <button key={region.id} type="button" onClick={() => {
                            const space = spaces.find(item => item.id === region.space_id);
                            if (space) {
                              setSelectedMapRegionId(region.id);
                              openSpaceDetail(space);
                            }
                          }} className="w-full rounded-xl border border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold text-slate-800">{region.label || region.space_name || `Cupo #${region.space_id}`}</span>
                              <span className={cn("h-2.5 w-2.5 rounded-full", liveStatusClasses[region.status])} />
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{region.client_name || region.plate || liveStatusLabels[region.status]}</p>
                          </button>
                        ))}
                        {filteredLiveRegions.length === 0 && <p className="py-6 text-center text-sm font-bold text-slate-400">Sin regiones para este filtro</p>}
                      </div>
                    </div>
                  </aside>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 text-white rounded-2xl p-5 lg:col-span-1">
              <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Caja abierta</p>
              <p className="text-2xl font-black mt-1">#{visitorCashSummary?.session.id || '-'}</p>
              <p className="text-xs text-white/60 mt-1">{visitorCashSummary?.session.status === 'open' ? 'En operación' : 'Sin caja abierta'}</p>
              <button
                type="button"
                onClick={() => setIsCashCloseDrawerOpen(true)}
                disabled={!visitorCashSummary || visitorCashSummary.session.status !== 'open'}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                <Banknote className="h-4 w-4" />
                Arqueo y cierre
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Efectivo esperado</p>
              <p className="text-2xl font-black mt-1">{formatCurrency(visitorCashSummary?.expectedCash)}</p>
              <p className="text-xs text-slate-500 mt-1">Según cobros en efectivo</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tarjeta / Transferencia</p>
              <p className="text-2xl font-black mt-1">{formatCurrency((visitorCashSummary?.totals.card || 0) + (visitorCashSummary?.totals.transfer || 0))}</p>
              <p className="text-xs text-slate-500 mt-1">Medios no efectivo</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cobros caja</p>
              <p className="text-2xl font-black mt-1">{visitorCashSummary?.tickets.length || 0}</p>
              <p className="text-xs text-slate-500 mt-1">Tickets pagados en sesión</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={cn(
              "rounded-2xl border p-4",
              Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0
                ? "border-red-200 bg-red-50"
                : "border-emerald-200 bg-emerald-50"
            )}>
              <div className="flex items-start gap-3">
                {Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0 ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Bloqueo de cierre</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0
                      ? `${visitorCashSummary?.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) sin salida`
                      : 'Sin tickets pagados pendientes de salida'}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Advertencias</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{visitorCashSummary?.warnings.activeVisitorTickets || 0} ticket(s) activos</p>
              <p className="text-xs text-amber-800/80 mt-1">No bloquea el cierre, pero queda visible para traspaso.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Último cierre</p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {visitorCashClosures[0]?.closed_at ? new Date(visitorCashClosures[0].closed_at).toLocaleString() : 'Sin cierres registrados'}
              </p>
              <p className={cn("text-xs font-bold mt-1", Number(visitorCashClosures[0]?.difference_cash || 0) === 0 ? "text-emerald-600" : "text-red-600")}>
                Diferencia: {formatCurrency(visitorCashClosures[0]?.difference_cash)}
              </p>
            </div>
          </div>

          <form onSubmit={handleLookupVisitor} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-900">Salida por patente</p>
                <p className="text-sm text-slate-500 mt-1">Busca el ticket activo, recalcula por minuto efectivo y cobra desde una sola acción.</p>
              </div>
              <div className="lg:w-80">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Patente</label>
                <input
                  value={visitorSearchPlate}
                  onChange={e => setVisitorSearchPlate(e.target.value.toUpperCase())}
                  placeholder="Ej: ABCD12"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm uppercase focus:bg-white focus:border-slate-900 outline-none transition-all"
                />
              </div>
              <button type="submit" disabled={isActionLoading || !visitorSearchPlate.trim()} className="px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {isActionLoading ? 'Buscando...' : 'Buscar y cobrar'}
              </button>
            </div>
            <label className="flex w-fit items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              <input
                type="checkbox"
                checked={visitorLostTicket}
                onChange={e => setVisitorLostTicket(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
              />
              Ticket perdido: buscar por patente y dejar auditoría
            </label>
            {visitorLookup && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Último ticket encontrado</p>
                  <p className="text-sm font-bold text-slate-900">#{visitorLookup.ticket.id} · {visitorLookup.ticket.plate} · {visitorLookup.ticket.space_name || 'Sin cupo'}</p>
                  <p className="text-xs text-slate-500 mt-1">Ingreso: {new Date(visitorLookup.ticket.entry_time).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {visitorLookup.ticket.status === 'active' && (
                    <button type="button" onClick={() => openVisitorPayment(visitorLookup.ticket)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">
                      Recalcular cobro
                    </button>
                  )}
                  {visitorLookup.ticket.status === 'paid' && (
                    <button type="button" onClick={() => handleCompleteVisitor(visitorLookup.ticket.id)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">
                      Autorizar salida
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tickets activos</p>
              <p className="text-2xl font-black mt-1">{visitors.filter(v => v.status === 'active').length}</p>
              <p className="text-xs text-slate-500 mt-1">Pendientes de cobro por salida</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tickets pagados</p>
              <p className="text-2xl font-black mt-1">{visitors.filter(v => v.status === 'paid').length}</p>
              <p className="text-xs text-slate-500 mt-1">Listos para autorizar salida</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Modalidad</p>
              <p className="text-lg font-black mt-1">Minuto efectivo</p>
              <p className="text-xs text-slate-500 mt-1">Sin redondeo al alza</p>
            </div>
          </div>
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">ID Ticket</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Patente</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cupo</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Entrada</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visitors.map(v => (
                <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm font-mono text-slate-400">#TKT-{v.id.toString().padStart(4, '0')}</td>
                  <td className="px-6 py-4 text-sm font-bold uppercase">{v.plate}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{v.space_name || (v.space_id ? `#${v.space_id}` : 'Sin cupo')}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{new Date(v.entry_time).toLocaleTimeString()}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                      v.status === 'paid' ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                    )}>
                      {v.status === 'paid' ? 'Pagado' : 'Activo'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {v.status === 'active' ? (
                      <button
                        onClick={() => openVisitorPayment(v)}
                        disabled={quotingVisitorId === v.id || isActionLoading}
                        className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      >
                        {quotingVisitorId === v.id ? 'Calculando...' : 'Cobrar Ticket'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCompleteVisitor(v.id)}
                        className="text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-all"
                      >
                        Autorizar Salida
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visitors.length === 0 && (
                <tr>
                  <td className="px-6 py-10 text-center text-sm font-bold text-slate-400" colSpan={6}>No hay tickets activos</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial de cobros</h3>
                <p className="text-sm text-slate-500">Últimos comprobantes de visitas pagadas.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canExportVisitorReports && (
                  <>
                    <a href={withBranchParam('/api/visitors/payments/export.csv')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">CSV</a>
                    <a href={withBranchParam('/api/visitors/payments/export.xlsx')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">XLSX</a>
                  </>
                )}
                <button type="button" onClick={fetchData} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  Actualizar
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Comprobante</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Patente</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Pago</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Método</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visitorPaymentHistory.slice(0, 8).map(payment => (
                    <tr key={payment.receipt_number} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">{payment.receipt_number}</td>
                      <td className="px-4 py-3 text-sm font-bold uppercase">{payment.plate}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(payment.paid_at).toLocaleString()}</td>
                      <td className="px-4 py-3 text-xs font-bold text-slate-600">{paymentMethodLabels[payment.payment_method] || payment.payment_method}</td>
                      <td className="px-4 py-3 text-sm font-black text-right">{formatCurrency(payment.amount)}</td>
                    </tr>
                  ))}
                  {visitorPaymentHistory.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm font-bold text-slate-400" colSpan={5}>Sin cobros registrados</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial de cierres</h3>
                <p className="text-sm text-slate-500">Arqueos cerrados con efectivo esperado, contado y diferencia.</p>
              </div>
              {canExportVisitorReports && (
                <div className="flex flex-wrap gap-2">
                  <a href={withBranchParam('/api/visitors/cash/closures/export.csv')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">CSV</a>
                  <a href={withBranchParam('/api/visitors/cash/closures/export.xlsx')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">XLSX</a>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Caja</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Cierre</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Responsable</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Esperado</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Contado</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Diferencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visitorCashClosures.slice(0, 6).map(closure => (
                    <tr key={closure.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 text-xs font-mono text-slate-500">#{closure.id}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{closure.closed_at ? new Date(closure.closed_at).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3 text-sm font-bold text-slate-700">{closure.staff_name || closure.closed_by_name || 'Caja'}</td>
                      <td className="px-4 py-3 text-sm font-black text-right">{formatCurrency(closure.expected_cash)}</td>
                      <td className="px-4 py-3 text-sm font-black text-right">{formatCurrency(closure.counted_cash)}</td>
                      <td className={cn("px-4 py-3 text-sm font-black text-right", Number(closure.difference_cash || 0) === 0 ? "text-emerald-600" : "text-red-600")}>
                        {formatCurrency(closure.difference_cash)}
                      </td>
                    </tr>
                  ))}
                  {visitorCashClosures.length === 0 && (
                    <tr>
                      <td className="px-4 py-8 text-center text-sm font-bold text-slate-400" colSpan={6}>Sin cierres registrados</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={`Detalle de Espacio: ${selectedSpace?.name}`}
      >
        {selectedSpace && (
          <div className="space-y-8">
            <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Estado Físico</p>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    selectedSpace.status === 'available' ? "bg-emerald-500" :
                      selectedSpace.status === 'occupied' ? "bg-amber-500" : "bg-slate-300"
                  )} />
                  <span className="text-sm font-bold uppercase">
                    {selectedSpace.status === 'available' ? 'Habilitado / Libre' :
                      selectedSpace.status === 'occupied' ? 'Arrendado' : 'En Mantención'}
                  </span>
                </div>
              </div>
              <select
                value={selectedSpace.status}
                disabled={!canOperateSpaces}
                onChange={(e) => {
                  if (!canOperateSpaces) return;
                  const newStatus = e.target.value;
                  if (newStatus === 'available' && selectedSpace.status === 'occupied') {
                    setConfirmAction({ type: 'mark-available', space: selectedSpace, nextStatus: newStatus });
                    return;
                  }
                  handleUpdateStatus(newStatus);
                }}
                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none disabled:bg-slate-100 disabled:text-slate-400"
              >
                <option value="available">Libre / Habilitado</option>
                <option value="occupied">Arrendado / Ocupado</option>
                <option value="maintenance">Poner en Mantención</option>
              </select>
              <button
                type="button"
                onClick={() => focusSpaceOnMap(selectedSpace)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
              >
                Ver en mapa
              </button>
              {canEditSpaces && (
                <button
                  type="button"
                  onClick={() => setEditingSpace(selectedSpace)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900"
                  title="Editar ficha del espacio"
                  aria-label={`Editar ficha de ${selectedSpace.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Sucursal y ubicación</p>
                <p className="text-sm font-bold text-slate-800">{selectedSpace.branch_name || 'Sucursal no registrada'}</p>
                <p className="text-sm font-bold text-slate-800">{selectedSpace.location || 'Sin ubicación registrada'}</p>
                <p className="text-xs text-slate-500 mt-1">Nivel: {selectedSpace.level || 'Sin nivel'}</p>
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Dimensiones</p>
                <p className="text-sm font-bold text-slate-800">
                  {[selectedSpace.width_m, selectedSpace.length_m, selectedSpace.height_m].some(Boolean)
                    ? `${selectedSpace.width_m || '-'} x ${selectedSpace.length_m || '-'} x ${selectedSpace.height_m || '-'} m`
                    : 'Sin dimensiones registradas'}
                </p>
                {selectedSpace.updated_at && <p className="text-xs text-slate-500 mt-1">Actualizado: {new Date(selectedSpace.updated_at).toLocaleString()}</p>}
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl md:col-span-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Características y notas</p>
                <p className="text-sm text-slate-700">{selectedSpace.features || 'Sin características registradas'}</p>
                {selectedSpace.notes && <p className="text-sm text-slate-500 mt-2">{selectedSpace.notes}</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Mapa aéreo</p>
                  <p className="text-sm font-bold text-slate-800">
                    {selectedSpaceLiveRegion
                      ? `${liveStatusLabels[selectedSpaceLiveRegion.status]} · ${selectedSpaceLiveRegion.label || selectedSpaceLiveRegion.space_name || selectedSpace.name}`
                      : 'Sin región enfocada o sin mapa cargado'}
                  </p>
                  {selectedSpaceLiveRegion && (
                    <p className="mt-1 text-xs text-slate-500">
                      {[selectedSpaceLiveRegion.client_name, selectedSpaceLiveRegion.plate, selectedSpaceLiveRegion.contract_id ? `Contrato #${selectedSpaceLiveRegion.contract_id}` : null, selectedSpaceLiveRegion.visitor_ticket_id ? `Ticket #${selectedSpaceLiveRegion.visitor_ticket_id}` : null]
                        .filter(Boolean)
                        .join(' · ') || 'Sin actividad asociada'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => focusSpaceOnMap(selectedSpace)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                >
                  <Map className="h-4 w-4" />
                  Enfocar región
                </button>
              </div>
            </div>

            {selectedSpace.status === 'occupied' && selectedSpace.assigned_client && (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-2xl font-bold text-slate-400">
                    {selectedSpace.assigned_client.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold">{selectedSpace.assigned_client.name}</h4>
                    <p className="text-sm text-slate-500 font-mono">
                      {canSeeCommercialData ? selectedSpace.assigned_client.rut : (selectedSpace.current_plate || 'Dato operativo')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {canSeeCommercialData && (
                    <div className="p-4 border border-slate-100 rounded-2xl">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Finanzas</p>
                      <span className={cn(
                        "text-sm font-bold",
                        selectedSpace.assigned_client.financial_status === 'up-to-date' ? "text-emerald-600" : "text-red-600"
                      )}>
                        {selectedSpace.assigned_client.financial_status === 'up-to-date' ? 'Al Día' : 'Moroso'}
                      </span>
                    </div>
                  )}
                  <div className="p-4 border border-slate-100 rounded-2xl">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Presencia</p>
                    <span className={cn(
                      "text-sm font-bold",
                      selectedSpace.is_present ? "text-blue-600" : "text-slate-400"
                    )}>
                      {selectedSpace.is_present ? 'En el interior' : 'Fuera del recinto'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Historial operativo</h4>
              <div className="space-y-3">
                {spaceDetail?.history?.slice(0, 5).map(item => (
                  <div key={item.id} className="p-3 border border-slate-100 rounded-2xl bg-white">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800">
                        {item.previous_status ? `${item.previous_status} -> ${item.status}` : item.status}
                      </p>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{item.source}</span>
                    </div>
                    {item.reason && <p className="text-sm text-slate-600 mt-1">{item.reason}</p>}
                    <p className="text-xs text-slate-400 mt-1">{new Date(item.created_at).toLocaleString()} · {item.staff_name || 'Sistema'}</p>
                  </div>
                ))}
                {spaceDetail && spaceDetail.history.length === 0 && (
                  <p className="text-sm text-slate-400">Sin movimientos registrados.</p>
                )}
                {!spaceDetail && (
                  <p className="text-sm text-slate-400">Cargando historial...</p>
                )}
              </div>
            </div>

            {canOperateSpaces ? (
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Controles de Emergencia</h4>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfirmAction({ type: 'open-barrier', space: selectedSpace })}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-red-100 text-red-600 rounded-2xl flex flex-col items-center gap-2 hover:bg-red-50 transition-all disabled:opacity-50"
                  >
                    <Zap className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Registrar Apertura</span>
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'force-release', space: selectedSpace })}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-emerald-100 text-emerald-600 rounded-2xl flex flex-col items-center gap-2 hover:bg-emerald-50 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Liberar Espacio</span>
                  </button>
                  <button
                    onClick={() => handleUpdateStatus('maintenance', 'Bloqueo manual de acceso')}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-slate-100 text-slate-500 rounded-2xl flex flex-col items-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    <X className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Bloquear Acceso</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Vista de inventario</p>
                <p className="mt-1 text-sm text-slate-600">Este rol puede revisar ocupación, tarifa y asignación comercial, sin acciones operativas de acceso.</p>
              </div>
            )}

            <div className="pt-6 border-t border-slate-100">
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all"
              >
                Cerrar Panel
              </button>
            </div>
          </div>
        )}
      </Drawer>
      <Drawer
        isOpen={isVisitorTicketDrawerOpen}
        onClose={() => setIsVisitorTicketDrawerOpen(false)}
        title="Crear Ticket de Entrada"
      >
        <form onSubmit={handleCreateVisitorTicket} className="space-y-6">
          <div className="rounded-2xl bg-slate-900 text-white p-5">
            <p className="text-xs font-bold uppercase tracking-wider opacity-60">Cobro legal</p>
            <p className="mt-1 text-sm font-bold">El cobro se calcula al salir por minuto efectivo, descontando minutos de gracia y sin redondeo al alza.</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Patente</label>
            <input
              type="text"
              name="plate"
              required
              autoFocus
              placeholder="Ej: ABCD12"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm uppercase focus:bg-white focus:border-slate-900 outline-none transition-all"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Cupo</label>
            <select name="space_id" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
              <option value="">Asignar automáticamente</option>
              {spaces.filter(space => space.type === 'parking' && space.status === 'available').map(space => (
                <option key={space.id} value={space.id}>{space.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">Si no eliges cupo, Parkia toma el primer estacionamiento disponible.</p>
          </div>
          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsVisitorTicketDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isActionLoading ? 'Creando...' : 'Crear Ticket'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={isCreateDrawerOpen}
        onClose={() => setIsCreateDrawerOpen(false)}
        title="Registrar Nuevo Estacionamiento"
      >
        <form onSubmit={handleCreateSpace} className="space-y-6">
          <input type="hidden" name="type" value={activeType} />

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
            <select
              name="branch_id"
              defaultValue={selectedBranchId === 'all' ? branches.find(branch => branch.status === 'active')?.id : selectedBranchId}
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            >
              {branches.filter(branch => branch.status === 'active').map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Identificador / Nombre</label>
            <input type="text" name="name" required placeholder="Ej: A-101" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Precio Base Mensual</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
              <input type="number" name="price" required className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ubicación</label>
              <input type="text" name="location" placeholder="Ej: Patio norte, pasillo B" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nivel</label>
              <input type="text" name="level" placeholder="Ej: -1, 1, Exterior" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ancho m</label>
              <input type="number" step="0.01" min="0" name="width_m" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Largo m</label>
              <input type="number" step="0.01" min="0" name="length_m" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Alto m</label>
              <input type="number" step="0.01" min="0" name="height_m" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Características</label>
            <textarea name="features" rows={3} placeholder="Ej: iluminación, cámara, enchufe, acceso techado..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"></textarea>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Estado Inicial</label>
            <select name="status" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
              <option value="available">Disponible</option>
              <option value="maintenance">En Mantención</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas Adicionales</label>
            <textarea name="notes" rows={3} placeholder="Opcional..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"></textarea>
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsCreateDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Crear Estacionamiento
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={isMapCreateDrawerOpen}
        onClose={() => setIsMapCreateDrawerOpen(false)}
        title="Crear Mapa Aéreo"
      >
        <form onSubmit={handleCreateSpaceMap} className="space-y-6">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
            <select
              name="branch_id"
              defaultValue={selectedBranchId === 'all' ? '' : selectedBranchId}
              required
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
            >
              <option value="" disabled>Selecciona una sucursal</option>
              {branches.filter(branch => branch.status === 'active').map(branch => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nombre del mapa</label>
            <input name="name" required placeholder="Ej: Patio norte aéreo" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Imagen JPG/PNG</label>
            <input
              name="image"
              type="file"
              accept="image/png,image/jpeg"
              required
              className="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
            />
            <p className="mt-2 text-xs text-slate-500">Máximo 10MB. Se guardan dimensiones reales para mantener coordenadas normalizadas.</p>
          </div>

          <label className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
            <input name="is_default" type="checkbox" className="h-4 w-4 accent-slate-900" />
            Usar como mapa por defecto de la sucursal
          </label>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={() => setIsMapCreateDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isActionLoading ? 'Creando...' : 'Crear mapa'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={Boolean(editingSpace)}
        onClose={() => setEditingSpace(null)}
        title={`Editar ${editingSpace?.name || 'espacio'}`}
      >
        {editingSpace && (
          <form onSubmit={handleUpdateSpace} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Identificador / Nombre</label>
                <input type="text" name="name" required defaultValue={editingSpace.name} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo</label>
                <select name="type" defaultValue={editingSpace.type} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                  <option value="parking">Estacionamiento</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Precio Base Mensual</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input type="number" name="price" required defaultValue={editingSpace.price} className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
              <select name="branch_id" defaultValue={editingSpace.branch_id || ''} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                {branches.filter(branch => branch.status === 'active').map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ubicación</label>
                <input type="text" name="location" defaultValue={editingSpace.location || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nivel</label>
                <input type="text" name="level" defaultValue={editingSpace.level || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ancho m</label>
                <input type="number" step="0.01" min="0" name="width_m" defaultValue={editingSpace.width_m || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Largo m</label>
                <input type="number" step="0.01" min="0" name="length_m" defaultValue={editingSpace.length_m || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Alto m</label>
                <input type="number" step="0.01" min="0" name="height_m" defaultValue={editingSpace.height_m || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Características</label>
              <textarea name="features" rows={3} defaultValue={editingSpace.features || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"></textarea>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas</label>
              <textarea name="notes" rows={3} defaultValue={editingSpace.notes || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"></textarea>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo de actualización</label>
              <textarea name="reason" rows={2} required placeholder="Ej: corrección de tarifa, actualización de ubicación o medidas" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all resize-none"></textarea>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setEditingSpace(null)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
                {isActionLoading ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={isCashCloseDrawerOpen}
        onClose={() => setIsCashCloseDrawerOpen(false)}
        title="Arqueo y Cierre de Caja"
      >
        {visitorCashSummary && (
          <form onSubmit={handleCloseVisitorCashSession} className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-6 text-white">
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">Caja #{visitorCashSummary.session.id}</p>
              <p className="mt-1 text-3xl font-black">{formatCurrency(visitorCashSummary.expectedCash)}</p>
              <p className="mt-2 text-sm text-white/70">Efectivo esperado según cobros registrados en esta sesión.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Efectivo sistema</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.expectedCash)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tarjeta</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.totals.card)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Transferencia</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.totals.transfer)}</p>
              </div>
            </div>

            {Number(visitorCashSummary.blockers.paidTicketsAwaitingExit || 0) > 0 && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-red-700">Cierre bloqueado</p>
                <p className="mt-1 text-sm text-red-900">Autoriza la salida de {visitorCashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) antes de cerrar caja.</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Efectivo contado</label>
                <input name="counted_cash" type="number" min="0" required defaultValue={visitorCashSummary.expectedCash} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tarjeta contado</label>
                <input name="counted_card" type="number" min="0" required defaultValue={visitorCashSummary.totals.card || 0} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Transferencia contado</label>
                <input name="counted_transfer" type="number" min="0" required defaultValue={visitorCashSummary.totals.transfer || 0} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Observación de caja</label>
              <textarea name="notes" rows={3} placeholder="Ej: diferencia informada, voucher pendiente, caja cuadrada." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Traspaso de turno</label>
              <textarea name="handover_notes" rows={3} placeholder="Pendientes para el siguiente turno." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
              <p className="mt-2 text-xs text-slate-500">Si esta caja está vinculada a una bitácora abierta, también quedará cerrada.</p>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setIsCashCloseDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button
                type="submit"
                disabled={isActionLoading || Number(visitorCashSummary.blockers.paidTicketsAwaitingExit || 0) > 0}
                className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                {isActionLoading ? 'Cerrando...' : 'Cerrar Caja'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(visitorPayment)}
        onClose={() => setVisitorPayment(null)}
        title="Cobrar Ticket de Visita"
      >
        {visitorPayment && (
          <form onSubmit={handlePayVisitor} className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-2xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider mb-1">Patente</p>
              <p className="text-3xl font-bold uppercase tracking-wider">{visitorPayment.plate}</p>
              {visitorPayment.space_name && <p className="mt-1 text-sm font-bold text-white/70">{visitorPayment.space_name}</p>}
              <p className="mt-3 text-xs font-bold text-white/70">Cobro por minuto efectivo, sin redondeo al alza.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total</p>
                <p className="mt-1 text-lg font-bold text-slate-900">${Number(visitorPayment.total || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duración</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.duration_minutes} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gracia</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.grace_period_mins} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cobrables</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.billable_mins || 0} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tarifa / min</p>
                <p className="mt-1 text-lg font-bold text-slate-900">${Number(visitorPayment.rate_per_minute || 0).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Método de Pago</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['cash', 'Efectivo'],
                  ['card', 'Tarjeta'],
                  ['transfer', 'Transferencia'],
                ].map(([value, label]) => (
                  <label key={value} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-bold text-slate-600 cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white">
                    <input type="radio" name="method" value={value} defaultChecked={visitorPayment.method === value} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Monto a Cobrar</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  name="amount"
                  type="number"
                  min="0"
                  defaultValue={visitorPayment.amount}
                  readOnly={user.role !== 'admin'}
                  required
                  className={cn(
                    "w-full border border-slate-200 rounded-xl pl-8 pr-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all",
                    user.role === 'admin' ? "bg-slate-50" : "bg-slate-100 text-slate-500"
                  )}
                />
              </div>
              {user.role !== 'admin' && (
                <p className="mt-2 text-xs text-slate-500">Monto bloqueado por cotización legal vigente.</p>
              )}
            </div>

            {user.role === 'admin' && (
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo override si cobra menos</label>
                <textarea name="override_reason" rows={2} placeholder="Requerido solo si el monto es menor a la cotización." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            )}

            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Comprobante</p>
              <p className="text-sm text-blue-900 mt-1">Al registrar el pago se genera un comprobante con patente, tiempos, tarifa por minuto, total y método de pago.</p>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setVisitorPayment(null)} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
                {isActionLoading ? 'Registrando...' : 'Registrar Pago'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(visitorReceipt)}
        onClose={() => setVisitorReceipt(null)}
        title="Comprobante de Pago"
      >
        {visitorReceipt && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 text-white p-6">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Comprobante</p>
              <p className="mt-1 text-2xl font-black">{visitorReceipt.receipt_number}</p>
              <p className="mt-2 text-sm text-white/70">{visitorReceipt.legal_note}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Patente</p>
                <p className="mt-1 text-lg font-bold uppercase">{visitorReceipt.plate}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ticket</p>
                <p className="mt-1 text-lg font-bold">#{visitorReceipt.ticket_id}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Entrada</p>
                <p className="mt-1 text-sm font-bold">{new Date(visitorReceipt.entry_time).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Pago</p>
                <p className="mt-1 text-sm font-bold">{visitorReceipt.paid_at ? new Date(visitorReceipt.paid_at).toLocaleString() : '-'}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              {[
                ['Duración', `${visitorReceipt.duration_mins} min`],
                ['Gracia', `${visitorReceipt.grace_period_mins} min`],
                ['Minutos cobrables', `${visitorReceipt.billable_mins} min`],
                ['Tarifa por minuto', `$${visitorReceipt.rate_per_minute.toLocaleString()}`],
                ['Método', paymentMethodLabels[visitorReceipt.payment_method] || visitorReceipt.payment_method],
                ['Total pagado', `$${visitorReceipt.amount_paid.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
                  <span className="text-sm font-bold text-slate-900">{value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => window.print()} className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Imprimir
              </button>
              <button type="button" onClick={() => handleCompleteVisitor(visitorReceipt.ticket_id)} disabled={isActionLoading} className="flex-[2] py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                Autorizar salida
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.type === 'open-barrier' ? 'Confirmar registro manual' :
            confirmAction?.type === 'force-release' ? 'Forzar liberación de espacio' :
              'Marcar espacio como libre'
        }
        message={
          confirmAction?.type === 'open-barrier'
            ? <>Se registrará la autorización manual de <strong>{confirmAction.space.name}</strong> en auditoría. El sistema no acciona la barrera física.</>
            : confirmAction?.type === 'force-release'
              ? <>Esto registrará una salida de emergencia y dejará <strong>{confirmAction.space.name}</strong> disponible.</>
              : <>Si el espacio está arrendado, es mejor terminar su contrato desde Contratos antes de marcarlo libre.</>
        }
        confirmLabel={
          confirmAction?.type === 'open-barrier' ? 'Registrar Apertura' :
            confirmAction?.type === 'force-release' ? 'Liberar Espacio' :
              'Marcar Libre'
        }
        tone={confirmAction?.type === 'open-barrier' || confirmAction?.type === 'force-release' ? 'danger' : 'default'}
        isLoading={isActionLoading}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
    </div>
  );
};

export default SpacesPage;

