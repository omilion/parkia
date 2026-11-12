import { useApiMutation } from '../../../lib/useApiMutation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';

import React, { useEffect, useState } from 'react';

import { AccessLog, AccessRate, Branch, CashSessionSummary, GuardShiftLog, GuardShiftLogEntry, PaginatedResponse, Space, StaffUser, VisitorPass } from '../../../types';

import { ACCESS_AUDIT_PAGE_SIZE, getInitialAccessTab } from '../pages/accessShared';
import type { AccessTabId } from '../pages/accessShared';
import type { AccessOverrideFormValues, CloseShiftValues, OpenShiftFormValues, ShiftEntryFieldsValues, UpdateAccessRateValues, VisitorPassFormValues } from '../../../../shared/schemas/access';
export function useAccessController(user: StaffUser){
  const apiWrite = useApiMutation("features/access/hooks");

  const currentUser = user;
  const isGuard = currentUser?.role === 'guard';
  const canViewAudit = currentUser?.role === 'admin';
  const canManageRates = currentUser?.role === 'admin';
  const [activeTab, setActiveTab] = useState<AccessTabId>(getInitialAccessTab);
  const [shiftLogs, setShiftLogs] = useState<GuardShiftLog[]>([]);
  const [selectedShiftLog, setSelectedShiftLog] = useState<GuardShiftLog | null>(null);
  const [shiftEntries, setShiftEntries] = useState<GuardShiftLogEntry[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSessionSummary | null>(null);
  const [shiftFollowUps, setShiftFollowUps] = useState<GuardShiftLogEntry[]>([]);
  const [shiftStatusFilter, setShiftStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<'visitor' | 'override' | 'rate'>('visitor');
  const [selectedRate, setSelectedRate] = useState<AccessRate | null>(null);
  const [selectedLog, setSelectedLog] = useState<AccessLog | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [shiftEvidenceName, setShiftEvidenceName] = useState('');

  const [auditFilters, setAuditFilters] = useState({
    start: new URLSearchParams(window.location.search).get('start') || '',
    end: '',
    type: new URLSearchParams(window.location.search).get('type') || '',
    user: ''
  });
  const [auditPage, setAuditPage] = useState(1);

  const queryClient = useQueryClient();
  const branchUrl = (url: string) => selectedBranchId === 'all' ? url : `${url}${url.includes('?') ? '&' : '?'}branch_id=${selectedBranchId}`;
  const accessQuery = useQuery({ queryKey: ['access', 'live', selectedBranchId], refetchInterval: activeTab === 'live' ? 5000 : false, queryFn: async ({ signal }) => {
    const [liveLogs, visitorPasses, rates, spaces, branches] = await Promise.all([
      apiFetchJson<AccessLog[]>(branchUrl('/api/access/live'), { signal }), apiFetchJson<VisitorPass[]>(branchUrl('/api/visitors/passes'), { signal }),
      apiFetchJson<AccessRate[]>('/api/access/rates', { signal }), apiFetchJson<Space[]>(branchUrl('/api/spaces'), { signal }), apiFetchJson<Branch[]>('/api/branches', { signal }),
    ]);
    return { liveLogs, visitorPasses, rates, spaces, branches };
  } });
  const auditParams = new URLSearchParams(auditFilters);
  if (selectedBranchId !== 'all') auditParams.set('branch_id', selectedBranchId);
  auditParams.set('page', String(auditPage)); auditParams.set('pageSize', String(ACCESS_AUDIT_PAGE_SIZE));
  const auditQuery = useQuery({ queryKey: ['access', 'audit', auditParams.toString()], enabled: canViewAudit && activeTab === 'audit', queryFn: ({ signal }) => apiFetchJson<PaginatedResponse<AccessLog>>(`/api/access/audit?${auditParams}`, { signal }) });
  const liveLogs = accessQuery.data?.liveLogs ?? [];
  const visitorPasses = accessQuery.data?.visitorPasses ?? [];
  const rates = accessQuery.data?.rates ?? [];
  const spaces = accessQuery.data?.spaces ?? [];
  const branches = accessQuery.data?.branches ?? [];
  const auditLogs = auditQuery.data?.items ?? [];
  const auditTotal = auditQuery.data?.total ?? 0;
  const isLoading = accessQuery.isPending;
  const loadError = accessQuery.error?.message || auditQuery.error?.message || '';
  const fetchData = () => queryClient.invalidateQueries({ queryKey: ['access'] });
  const fetchAudit = () => queryClient.invalidateQueries({ queryKey: ['access', 'audit'] });
  const inheritedShiftFollowUps = shiftFollowUps.filter(entry => entry.shift_log_id !== selectedShiftLog?.id);
  const activeDeniedLogs = liveLogs.filter(log => log.status === 'denied' && !log.resolved_by_access_log_id);

  const withBranch = (url: string) => {
    if (selectedBranchId === 'all') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}branch_id=${selectedBranchId}`;
  };

  const fileToPayload = (file: File) => new Promise<{ fileName: string, mimeType: string, dataBase64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const [, dataBase64] = result.split(',');
      resolve({ fileName: file.name, mimeType: file.type, dataBase64 });
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const fetchShiftDetail = async (id: number) => {
    const res = await fetch(`/api/access/shift-logs/${id}`);
    if (!res.ok) {
      setSelectedShiftLog(null);
      setShiftEntries([]);
      setCashSummary(null);
      return;
    }
    const data = await res.json();
    setSelectedShiftLog(data.shiftLog);
    setShiftEntries(data.entries);
    setCashSummary(data.cash || null);
  };

  const fetchShiftFollowUps = async () => {
    const res = await fetch(withBranch('/api/access/shift-log-follow-ups?status=open'));
    if (!res.ok) {
      setShiftFollowUps([]);
      return;
    }
    setShiftFollowUps(await res.json());
  };

  const fetchShiftLogs = async (preferredId?: number, statusOverride = shiftStatusFilter) => {
    const res = await fetch(withBranch(`/api/access/shift-logs?status=${statusOverride}`));
    const logs = await res.json();
    setShiftLogs(logs);

    const nextLog = logs.find((log: GuardShiftLog) => log.id === preferredId)
      || logs.find((log: GuardShiftLog) => log.id === selectedShiftLog?.id)
      || logs[0];

    if (nextLog) {
      await fetchShiftDetail(nextLog.id);
    } else {
      setSelectedShiftLog(null);
      setShiftEntries([]);
      setCashSummary(null);
    }
    await fetchShiftFollowUps();
  };

  useEffect(() => {
    if ((isGuard && activeTab === 'rates') || (currentUser && !canViewAudit && activeTab === 'audit')) {
      handleTabChange('live');
    }
  }, [activeTab, canViewAudit, currentUser, isGuard]);

  useEffect(() => {
    if (activeTab === 'shift-log') {
      fetchShiftLogs();
      fetchShiftFollowUps();
    }
  }, [activeTab, shiftStatusFilter, selectedBranchId]);

  const handleCreatePass = async (values: VisitorPassFormValues) => {
    setIsActionLoading(true);
    const data = selectedBranchId !== 'all' ? { ...values, branch_id: selectedBranchId } : values;

    const res = await apiWrite.request('/api/visitors/passes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Pase QR generado. Copia el token QR para compartirlo por el canal operativo disponible.', type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      const err = await res.json().catch(() => ({}));
      setToast({ message: err.error || 'No se pudo generar el pase QR', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleOverride = async (data: AccessOverrideFormValues) => {
    setIsActionLoading(true);

    const res = await apiWrite.request('/api/access/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        client_id: selectedLog?.client_id || null,
        denied_access_log_id: selectedLog?.id || undefined,
        authorized_by: currentUser?.name || 'Guardia'
      })
    });

    if (res.ok) {
      const body = await res.json();
      setToast({ message: body.message || 'Autorizacion manual registrada', type: 'success' });
      setIsDrawerOpen(false);
      setSelectedLog(null);
      fetchData();
      if (activeTab === 'audit') fetchAudit();
    } else {
      const err = await res.json().catch(() => ({}));
      setToast({ message: err.error || 'No se pudo registrar la autorizacion manual', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleUpdateRate = async (data: UpdateAccessRateValues) => {
    if (!selectedRate) return;
    setIsActionLoading(true);

    const res = await apiWrite.request(`/api/access/rates/${selectedRate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Tarifa actualizada correctamente', type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      const err = await res.json().catch(() => ({}));
      setToast({ message: err.error || 'No se pudo actualizar la tarifa', type: 'error' });
    }
    setIsActionLoading(false);
  };

  /** Devuelve true si el turno quedó abierto, para limpiar el formulario. */
  const handleOpenShift = async (values: OpenShiftFormValues): Promise<boolean> => {
    setIsActionLoading(true);
    const data = selectedBranchId !== 'all' ? { ...values, branch_id: selectedBranchId } : values;

    const res = await apiWrite.request('/api/access/shift-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: result.existing ? 'Ya tenías un turno abierto' : 'Turno abierto correctamente', type: 'success' });
      setShiftStatusFilter('open');
      await fetchShiftLogs(result.shiftLog.id, 'open');
      setIsActionLoading(false);
      return true;
    }
    setToast({ message: result.error || 'No se pudo abrir el turno', type: 'error' });
    setIsActionLoading(false);
    return false;
  };

  /** Devuelve true si la novedad quedó registrada, para limpiar el formulario. */
  const handleCreateShiftEntry = async (data: ShiftEntryFieldsValues, evidence: File | null): Promise<boolean> => {
    if (!selectedShiftLog) return false;
    setIsActionLoading(true);
    const attachment = evidence && evidence.size > 0 ? await fileToPayload(evidence) : undefined;

    const res = await apiWrite.request(`/api/access/shift-logs/${selectedShiftLog.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        attachment
      })
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Novedad registrada en la bitácora', type: 'success' });
      setShiftEvidenceName('');
      await fetchShiftDetail(selectedShiftLog.id);
      await fetchShiftLogs(selectedShiftLog.id);
      await fetchShiftFollowUps();
      setIsActionLoading(false);
      return true;
    }
    setToast({ message: result.error || 'No se pudo registrar la novedad', type: 'error' });
    setIsActionLoading(false);
    return false;
  };

  const handleResolveShiftEntry = async (entry: GuardShiftLogEntry) => {
    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/access/shift-log-entries/${entry.id}/resolve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: !entry.resolved_at })
    });

    if (res.ok) {
      if (selectedShiftLog) await fetchShiftDetail(selectedShiftLog.id);
      await fetchShiftLogs(selectedShiftLog?.id);
      await fetchShiftFollowUps();
    } else {
      const result = await res.json();
      setToast({ message: result.error || 'No se pudo actualizar el seguimiento', type: 'error' });
    }
    setIsActionLoading(false);
  };

  /** Devuelve true si el turno quedó cerrado. */
  const handleCloseShift = async (payload: CloseShiftValues): Promise<boolean> => {
    if (!selectedShiftLog) return false;
    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/access/shift-logs/${selectedShiftLog.id}/close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Turno cerrado con traspaso registrado', type: 'success' });
      setShiftStatusFilter('all');
      await fetchShiftLogs(result.shiftLog.id, 'all');
      await fetchShiftFollowUps();
      setIsActionLoading(false);
      return true;
    }
    setToast({ message: result.error || 'No se pudo cerrar el turno', type: 'error' });
    setIsActionLoading(false);
    return false;
  };

  const copyVisitorQr = async (pass: VisitorPass) => {
    try {
      await navigator.clipboard.writeText(pass.qr_token);
      setToast({ message: `QR de ${pass.name} copiado al portapapeles`, type: 'success' });
    } catch {
      setToast({ message: pass.qr_token, type: 'success' });
    }
  };

  const scanVisitorQr = async (pass: VisitorPass) => {
    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/visitors/passes/${pass.id}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      setToast({ message: body.message || 'Pase QR validado', type: 'success' });
      await fetchData();
    } else {
      setToast({ message: body.error || 'No se pudo validar el pase QR', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const exportAuditCsv = async () => {
    const escapeCsv = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const methodLabels: Record<string, string> = {
      fingerprint: 'Huella',
      card: 'Tarjeta',
      qr: 'QR',
      manual: 'Manual',
    };
    const statusLabels: Record<string, string> = {
      authorized: 'Autorizado',
      denied: 'Denegado',
    };
    const params = new URLSearchParams(auditFilters);
    if (selectedBranchId !== 'all') params.set('branch_id', selectedBranchId);
    const res = await fetch(`/api/access/audit?${params}`);
    const logs = await res.json() as AccessLog[];
    const rows = [
      ['ID', 'Fecha y hora', 'Persona', 'Patente', 'Espacio', 'Método', 'Estado', 'Motivo', 'Autorizado por'],
      ...logs.map(log => [
        log.id,
        log.timestamp,
        log.client_name || log.visitor_name || 'Desconocido',
        log.plate || '',
        log.space_name || '',
        methodLabels[log.method] || log.method,
        statusLabels[log.status] || log.status,
        log.reason || '',
        log.authorized_by || '',
      ]),
    ];
    const blob = new Blob([rows.map(row => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria-accesos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadServerCsv = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    link.click();
  };

  const handleTabChange = (tabId: AccessTabId) => {
    if (isGuard && tabId === 'rates') return;
    if (!canViewAudit && tabId === 'audit') return;
    setActiveTab(tabId);
    const params = new URLSearchParams(window.location.search);
    if (tabId === 'live') {
      params.delete('tab');
    } else {
      params.set('tab', tabId);
    }
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/access?${query}` : '/access');
  };

return {
    user,
    currentUser,
    canViewAudit,
    canManageRates,
    activeTab,
    shiftLogs,
    selectedShiftLog,
    shiftEntries,
    cashSummary,
    shiftFollowUps,
    shiftStatusFilter,
    setShiftStatusFilter,
    selectedBranchId,
    setSelectedBranchId,
    isDrawerOpen,
    setIsDrawerOpen,
    drawerType,
    setDrawerType,
    selectedRate,
    setSelectedRate,
    selectedLog,
    setSelectedLog,
    toast,
    setToast,
    isActionLoading,
    shiftEvidenceName,
    setShiftEvidenceName,
    auditFilters,
    setAuditFilters,
    auditPage,
    setAuditPage,
    liveLogs,
    visitorPasses,
    rates,
    spaces,
    branches,
    auditLogs,
    auditTotal,
    isLoading,
    loadError,
    fetchData,
    fetchAudit,
    inheritedShiftFollowUps,
    activeDeniedLogs,
    withBranch,
    fetchShiftDetail,
    fetchShiftFollowUps,
    handleCreatePass,
    handleOverride,
    handleUpdateRate,
    handleOpenShift,
    handleCreateShiftEntry,
    handleResolveShiftEntry,
    handleCloseShift,
    copyVisitorQr,
    scanVisitorQr,
    exportAuditCsv,
    downloadServerCsv,
    handleTabChange
  };
}
