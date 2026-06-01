import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, Car, CheckCircle2, ClipboardList, DoorOpen, ExternalLink, FileDown, Fingerprint, History, Plus, QrCode, Settings2, ShieldAlert, ShieldCheck, UserPlus, Zap } from 'lucide-react';
import { AccessLog, AccessRate, CashSessionSummary, GuardShiftLog, GuardShiftLogEntry, PaginatedResponse, Space, StaffUser, VisitorPass } from '../types';
import Drawer from '../components/ui/Drawer';
import PaginationControls from '../components/ui/PaginationControls';
import Toast from '../components/ui/Toast';
import { cn } from '../lib/utils';

const ACCESS_AUDIT_PAGE_SIZE = 50;

const shiftNameLabels: Record<GuardShiftLog['shift_name'], string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  night: 'Noche',
  custom: 'Especial',
};

const shiftEntryCategoryLabels: Record<GuardShiftLogEntry['category'], string> = {
  access: 'Acceso',
  visitor: 'Visita',
  incident: 'Incidente',
  maintenance: 'Mantención',
  payment: 'Pago',
  handover: 'Traspaso',
  other: 'Otro',
};

const shiftPriorityLabels: Record<GuardShiftLogEntry['priority'], string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

const statusLabelsForShiftTask: Record<NonNullable<GuardShiftLogEntry['task_status']>, string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  done: 'Cerrada',
  cancelled: 'Anulada',
};

const accessTabIds = ['live', 'visitors', 'shift-log', 'audit', 'rates'] as const;
type AccessTabId = typeof accessTabIds[number];

function getInitialAccessTab() {
  const requestedTab = new URLSearchParams(window.location.search).get('tab');
  return accessTabIds.includes(requestedTab as AccessTabId) ? requestedTab as AccessTabId : 'live';
}

function getAccessPoint(log: Pick<AccessLog, 'plate' | 'space_name'>) {
  const name = (log.space_name || '').toLowerCase();
  const isPedestrian = !log.plate && (name.includes('puerta') || name.includes('peaton') || name.includes('principal'));
  return {
    label: isPedestrian ? 'Puerta peatonal' : 'Barrera vehicular',
    Icon: isPedestrian ? DoorOpen : Car,
    className: isPedestrian ? 'bg-sky-50 text-sky-700' : 'bg-indigo-50 text-indigo-700',
  };
}

function formatCurrency(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString('es-CL')}`;
}

function ShiftFollowUpCard({
  entry,
  onResolve,
  isActionLoading,
}: {
  entry: GuardShiftLogEntry;
  key?: React.Key;
  onResolve: (entry: GuardShiftLogEntry) => void | Promise<void>;
  isActionLoading: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
          Pendiente
        </span>
        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
          {shiftEntryCategoryLabels[entry.category]}
        </span>
        {entry.task_id && (
          <span className="px-2 py-1 bg-sky-50 text-sky-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
            Tarea #{entry.task_id}
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-bold text-slate-900">{entry.title}</p>
        {entry.detail && <p className="text-xs text-slate-600 mt-1">{entry.detail}</p>}
        <p className="text-[11px] text-slate-400 mt-2">
          {entry.shift_date || '-'} · {entry.shift_name ? shiftNameLabels[entry.shift_name] : 'Turno'} · {entry.shift_staff_name || entry.staff_name}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onResolve(entry)}
        disabled={isActionLoading}
        className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <CheckCircle2 className="w-4 h-4" />
        Resolver seguimiento
      </button>
    </div>
  );
}

const AccessPage = () => {
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const isGuard = currentUser?.role === 'guard';
  const canViewAudit = currentUser?.role === 'admin';
  const canManageRates = currentUser?.role === 'admin';
  const [activeTab, setActiveTab] = useState<AccessTabId>(getInitialAccessTab);
  const [liveLogs, setLiveLogs] = useState<AccessLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AccessLog[]>([]);
  const [shiftLogs, setShiftLogs] = useState<GuardShiftLog[]>([]);
  const [selectedShiftLog, setSelectedShiftLog] = useState<GuardShiftLog | null>(null);
  const [shiftEntries, setShiftEntries] = useState<GuardShiftLogEntry[]>([]);
  const [cashSummary, setCashSummary] = useState<CashSessionSummary | null>(null);
  const [shiftFollowUps, setShiftFollowUps] = useState<GuardShiftLogEntry[]>([]);
  const [shiftStatusFilter, setShiftStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [visitorPasses, setVisitorPasses] = useState<VisitorPass[]>([]);
  const [rates, setRates] = useState<AccessRate[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
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
  const [auditTotal, setAuditTotal] = useState(0);

  const inheritedShiftFollowUps = shiftFollowUps.filter(entry => entry.shift_log_id !== selectedShiftLog?.id);
  const activeDeniedLogs = liveLogs.filter(log => log.status === 'denied' && !log.resolved_by_access_log_id);

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

  const fetchData = async () => {
    const [lRes, vRes, rRes, sRes] = await Promise.all([
      fetch('/api/access/live'),
      fetch('/api/visitors/passes'),
      fetch('/api/access/rates'),
      fetch('/api/spaces')
    ]);
    setLiveLogs(await lRes.json());
    setVisitorPasses(await vRes.json());
    setRates(await rRes.json());
    setSpaces(await sRes.json());
  };

  const fetchAudit = async () => {
    const params = new URLSearchParams(auditFilters);
    params.set('page', String(auditPage));
    params.set('pageSize', String(ACCESS_AUDIT_PAGE_SIZE));
    const res = await fetch(`/api/access/audit?${params}`);
    const data = await res.json() as PaginatedResponse<AccessLog>;
    setAuditLogs(data.items || []);
    setAuditTotal(Number(data.total || 0));
  };

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
    const res = await fetch('/api/access/shift-log-follow-ups?status=open');
    if (!res.ok) {
      setShiftFollowUps([]);
      return;
    }
    setShiftFollowUps(await res.json());
  };

  const fetchShiftLogs = async (preferredId?: number, statusOverride = shiftStatusFilter) => {
    const res = await fetch(`/api/access/shift-logs?status=${statusOverride}`);
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
    fetchData();
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (data?.user) setCurrentUser(data.user);
      })
      .catch(() => setCurrentUser(null));
    const interval = setInterval(fetchData, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if ((isGuard && activeTab === 'rates') || (currentUser && !canViewAudit && activeTab === 'audit')) {
      handleTabChange('live');
    }
  }, [activeTab, canViewAudit, currentUser, isGuard]);

  useEffect(() => {
    if (canViewAudit && activeTab === 'audit') fetchAudit();
  }, [activeTab, auditFilters, auditPage, canViewAudit]);

  useEffect(() => {
    if (activeTab === 'shift-log') {
      fetchShiftLogs();
      fetchShiftFollowUps();
    }
  }, [activeTab, shiftStatusFilter]);

  const handleCreatePass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/visitors/passes', {
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

  const handleOverride = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/access/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
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

  const handleUpdateRate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedRate) return;
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch(`/api/access/rates/${selectedRate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Tarifa actualizada correctamente', type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    }
    setIsActionLoading(false);
  };

  const handleOpenShift = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsActionLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/access/shift-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: result.existing ? 'Ya tenías un turno abierto' : 'Turno abierto correctamente', type: 'success' });
      form.reset();
      setShiftStatusFilter('open');
      await fetchShiftLogs(result.shiftLog.id, 'open');
    } else {
      setToast({ message: result.error || 'No se pudo abrir el turno', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleCreateShiftEntry = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedShiftLog) return;
    setIsActionLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const evidence = formData.get('evidence');
    const attachment = evidence instanceof File && evidence.size > 0 ? await fileToPayload(evidence) : undefined;

    const res = await fetch(`/api/access/shift-logs/${selectedShiftLog.id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        follow_up_required: formData.get('follow_up_required') === 'on',
        attachment
      })
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Novedad registrada en la bitácora', type: 'success' });
      form.reset();
      setShiftEvidenceName('');
      await fetchShiftDetail(selectedShiftLog.id);
      await fetchShiftLogs(selectedShiftLog.id);
      await fetchShiftFollowUps();
    } else {
      setToast({ message: result.error || 'No se pudo registrar la novedad', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleResolveShiftEntry = async (entry: GuardShiftLogEntry) => {
    setIsActionLoading(true);
    const res = await fetch(`/api/access/shift-log-entries/${entry.id}/resolve`, {
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

  const handleCloseShift = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedShiftLog) return;
    setIsActionLoading(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const handoverItems = [0, 1, 2].map(index => ({
      title: String(formData.get(`handover_title_${index}`) || '').trim(),
      detail: String(formData.get(`handover_detail_${index}`) || '').trim(),
      category: String(formData.get(`handover_category_${index}`) || 'handover'),
      priority: String(formData.get(`handover_priority_${index}`) || 'medium'),
      related_space_id: String(formData.get(`handover_space_${index}`) || ''),
    })).filter(item => item.title);

    const res = await fetch(`/api/access/shift-logs/${selectedShiftLog.id}/close`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handover_notes: data.handover_notes,
        cash_count_note: data.cash_count_note,
        counted_cash: data.counted_cash,
        counted_transfer: data.counted_transfer,
        counted_card: data.counted_card,
        handover_items: handoverItems,
      })
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Turno cerrado con traspaso registrado', type: 'success' });
      form.reset();
      setShiftStatusFilter('all');
      await fetchShiftLogs(result.shiftLog.id, 'all');
      await fetchShiftFollowUps();
    } else {
      setToast({ message: result.error || 'No se pudo cerrar el turno', type: 'error' });
    }
    setIsActionLoading(false);
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
    const res = await fetch(`/api/visitors/passes/${pass.id}/scan`, {
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Seguridad y Accesos</h2>
          <p className="text-slate-500 mt-1">Monitor en tiempo real, gestión de visitas y auditoría.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => { setDrawerType('visitor'); setIsDrawerOpen(true); }}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
          >
            <UserPlus className="w-5 h-5" />
            Nuevo Pase Visita
          </button>
          <button
            onClick={() => { setDrawerType('override'); setIsDrawerOpen(true); }}
            className="px-6 py-3 bg-red-600 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-red-700 transition-all"
          >
            <Zap className="w-5 h-5" />
            Registrar Autorizacion Manual
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 md:gap-8 overflow-x-auto" role="tablist" aria-label="Seguridad y accesos">
        {[
          { id: 'live', label: 'Monitor en Vivo', icon: ShieldCheck },
          { id: 'visitors', label: 'Gestión de Visitas', icon: QrCode },
          { id: 'shift-log', label: 'Bitácora de Turno', icon: ClipboardList },
          ...(canViewAudit ? [{ id: 'audit', label: 'Auditoría Histórica', icon: History }] : []),
          ...(canManageRates ? [{ id: 'rates', label: 'Configuración de Tarifas', icon: Settings2 }] : [])
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id as AccessTabId)}
              role="tab"
              aria-selected={activeTab === tab.id}
            className={cn(
              "pb-4 text-sm font-bold transition-all relative flex items-center gap-2 whitespace-nowrap",
              activeTab === tab.id ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="accessTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {activeTab === 'live' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">Actividad en Vivo</h3>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  Sincronizado
                </div>
              </div>
              <div className="space-y-4">
                {liveLogs.map((log, i) => {
                  const accessPoint = getAccessPoint(log);
                  return (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={cn(
                        "glass-card p-4 flex items-center justify-between group hover:border-slate-300 transition-all",
                        log.status === 'denied' && "border-red-100 bg-red-50/30"
                      )}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                        )}>
                          {(log.client_name || log.visitor_name || '?').charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate">
                            {log.client_name || log.visitor_name || 'Desconocido'}
                            {log.plate && <span className="text-slate-500 font-mono ml-2">({log.plate})</span>}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            {log.method === 'fingerprint' && <Fingerprint className="w-3 h-3" />}
                            {log.method === 'qr' && <QrCode className="w-3 h-3" />}
                            {log.method === 'manual' && <Zap className="w-3 h-3" />}
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", accessPoint.className)}>
                              <accessPoint.Icon className="w-3 h-3" />
                              {accessPoint.label}
                            </span>
                            <span>{log.space_name || 'Acceso principal'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                        )}>
                          {log.status === 'authorized' ? 'Autorizado' : 'Denegado'}
                        </span>
                        {log.reason && (
                          <p className="text-[10px] text-red-500 font-bold mt-1 max-w-[150px] truncate">{log.reason}</p>
                        )}
                        {log.resolved_by_access_log_id && (
                          <p className="text-[10px] text-emerald-600 font-bold mt-1">Resuelto por autorizacion #{log.resolved_by_access_log_id}</p>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-bold">Alertas de Seguridad</h3>
              <div className="space-y-4">
                {activeDeniedLogs.map(log => (
                  <div key={log.id} className="p-4 bg-red-50 border border-red-100 rounded-2xl space-y-3 animate-pulse">
                    <div className="flex items-center gap-3 text-red-600">
                      <ShieldAlert className="w-5 h-5" />
                      <p className="text-sm font-bold uppercase tracking-wider">Acceso Denegado</p>
                    </div>
                    <p className="text-sm font-bold text-red-900">
                      {log.client_name || log.visitor_name}
                      {log.plate && <span className="ml-2 font-mono">({log.plate})</span>}
                    </p>
                    <p className="text-xs text-red-700 font-medium">{log.reason}</p>
                    <button
                      onClick={() => { setSelectedLog(log); setDrawerType('override'); setIsDrawerOpen(true); }}
                      className="w-full py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
                    >
                      Resolver con Autorizacion Manual
                    </button>
                  </div>
                ))}
                {activeDeniedLogs.length === 0 && (
                  <div className="p-8 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                    <ShieldCheck className="w-8 h-8 text-emerald-200 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-400">Sin alertas activas</p>
                  </div>
                )}
              </div>

              <div className="glass-card p-6 space-y-4">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Controles Rápidos</h4>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => { setSelectedLog(null); setDrawerType('override'); setIsDrawerOpen(true); }}
                    className="w-full py-3 bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-800 transition-all"
                  >
                    <Car className="w-4 h-4" /> Registrar Acceso Vehicular
                  </button>
                  <button
                    onClick={() => { setSelectedLog(null); setDrawerType('override'); setIsDrawerOpen(true); }}
                    className="w-full py-3 bg-white border border-sky-200 text-sky-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-sky-50 transition-all"
                  >
                    <DoorOpen className="w-4 h-4" /> Registrar Acceso Peatonal
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'visitors' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-bold">Pases QR generados localmente</p>
              <p className="text-xs mt-1">El sistema no envía mensajes automáticamente en este flujo. Copia el token QR y compártelo por el canal operativo definido.</p>
            </div>
            <div className="glass-card overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Visitante</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Validez</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visitorPasses.map(pass => (
                    <tr key={pass.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold">{pass.name}</p>
                        <p className="text-xs text-slate-500 font-mono">{pass.rut}</p>
                        <p className="text-xs text-slate-500">{pass.phone || 'Sin telefono'}{pass.plate ? ` · ${pass.plate}` : ''}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">
                          {pass.type}
                        </span>
                        <p className="mt-1 text-xs text-slate-500">{pass.company || 'Sin empresa'}</p>
                        <p className="text-[10px] text-slate-400">Autoriza: {pass.authorized_by || '-'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs font-bold text-slate-900">{new Date(pass.valid_from).toLocaleDateString()}</p>
                        <p className="text-[10px] text-slate-500">{new Date(pass.valid_from).toLocaleTimeString()} - {new Date(pass.valid_to).toLocaleTimeString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          pass.status === 'waiting' ? "bg-amber-100 text-amber-600" :
                            pass.status === 'inside' ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"
                        )}>
                          {pass.status === 'waiting' ? 'En Espera' : pass.status === 'inside' ? 'En el Interior' : 'Completado'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {pass.status !== 'completed' && (
                          <button
                            onClick={() => scanVisitorQr(pass)}
                            disabled={isActionLoading}
                            title={pass.status === 'inside' ? 'Registrar salida por QR' : 'Registrar ingreso por QR'}
                            className="p-2 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg shadow-sm transition-all disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => copyVisitorQr(pass)}
                          title="Copiar token QR para compartir manualmente"
                          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-white rounded-lg shadow-sm transition-all"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <PaginationControls
                page={auditPage}
                pageSize={ACCESS_AUDIT_PAGE_SIZE}
                total={auditTotal}
                onPageChange={setAuditPage}
              />
            </div>
          </div>
        )}

        {activeTab === 'shift-log' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Turno seleccionado</p>
                  <p className="text-2xl font-black mt-1">{selectedShiftLog ? shiftNameLabels[selectedShiftLog.shift_name] : '-'}</p>
                  <p className="text-xs text-slate-500 mt-1">{selectedShiftLog?.staff_name || 'Sin turno activo'}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Novedades</p>
                  <p className="text-2xl font-black mt-1">{selectedShiftLog?.entries_count || 0}</p>
                  <p className="text-xs text-slate-500 mt-1">Registradas en el turno</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pendientes</p>
                  <p className={cn("text-2xl font-black mt-1", (selectedShiftLog?.pending_follow_ups || 0) > 0 ? "text-amber-600" : "text-emerald-600")}>
                    {selectedShiftLog?.pending_follow_ups || 0}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">Requieren seguimiento</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Caja esperada</p>
                  <p className="text-2xl font-black mt-1">{formatCurrency(cashSummary?.expectedCash)}</p>
                  <p className="text-xs text-slate-500 mt-1">{cashSummary?.tickets.length || 0} ticket(s) cobrados</p>
                </div>
              </div>

              {!selectedShiftLog && (
                <form onSubmit={handleOpenShift} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold">Abrir bitácora de turno</h3>
                    <p className="text-sm text-slate-500">Registra el contexto inicial antes de tomar la operación.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha</label>
                      <input type="date" name="shift_date" defaultValue={new Date().toISOString().slice(0, 10)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Turno</label>
                      <select name="shift_name" defaultValue="custom" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none">
                        {Object.entries(shiftNameLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Estado inicial</label>
                      <textarea name="opening_notes" rows={3} placeholder="Ej: Recibo turno con 2 visitas activas, barrera norte operativa, cámara patio con intermitencia." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                    </div>
                  </div>
                  <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50">
                    <Plus className="w-4 h-4" /> Abrir Turno
                  </button>
                </form>
              )}

              {inheritedShiftFollowUps.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-amber-950">Pendientes heredados</h3>
                    <p className="text-sm text-amber-700">Seguimientos abiertos de turnos anteriores que siguen requiriendo acción.</p>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {inheritedShiftFollowUps.map(entry => (
                      <ShiftFollowUpCard key={entry.id} entry={entry} onResolve={handleResolveShiftEntry} isActionLoading={isActionLoading} />
                    ))}
                  </div>
                </div>
              )}

              {selectedShiftLog && (
                <div className="space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">Bitácora #{selectedShiftLog.id}</h3>
                        <p className="text-sm text-slate-500">
                          {selectedShiftLog.shift_date} · {shiftNameLabels[selectedShiftLog.shift_name]} · {selectedShiftLog.status === 'open' ? 'Abierta' : 'Cerrada'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => downloadServerCsv(`/api/access/shift-logs/${selectedShiftLog.id}/export.csv`)}
                          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-2"
                          title="Exportar bitácora de turno"
                        >
                          <FileDown className="w-4 h-4" />
                          Exportar CSV
                        </button>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider w-fit",
                          selectedShiftLog.status === 'open' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        )}>
                          {selectedShiftLog.status === 'open' ? 'En curso' : 'Cerrada'}
                        </span>
                      </div>
                    </div>

                    {selectedShiftLog.opening_notes && (
                      <div className="p-4 bg-slate-50 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Recepción de turno</p>
                        <p className="text-sm text-slate-700">{selectedShiftLog.opening_notes}</p>
                      </div>
                    )}

                    {cashSummary && (
                      <div className="p-4 bg-slate-50 rounded-xl space-y-4">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700">
                              <Banknote className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Caja operacional</p>
                              <p className="text-sm font-bold text-slate-900">
                                {cashSummary.session.status === 'open' ? 'Abierta' : 'Cerrada'} · Caja #{cashSummary.session.id}
                              </p>
                            </div>
                          </div>
                          <div className="text-left md:text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Efectivo esperado</p>
                            <p className="text-xl font-black text-slate-900">{formatCurrency(cashSummary.expectedCash)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Efectivo</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.cash)}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Transferencia</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.transfer)}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tarjeta</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.card)}</p>
                          </div>
                        </div>
                        {(cashSummary.blockers.paidTicketsAwaitingExit > 0 || cashSummary.warnings.activeVisitorTickets > 0 || cashSummary.warnings.unresolvedDeniedExits > 0) && (
                          <div className="flex flex-wrap gap-2">
                            {cashSummary.blockers.paidTicketsAwaitingExit > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-bold">
                                {cashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagados sin salida
                              </span>
                            )}
                            {cashSummary.warnings.activeVisitorTickets > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">
                                {cashSummary.warnings.activeVisitorTickets} visita(s) activa(s)
                              </span>
                            )}
                            {cashSummary.warnings.unresolvedDeniedExits > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">
                                {cashSummary.warnings.unresolvedDeniedExits} salida(s) denegada(s)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedShiftLog.status === 'open' && (
                      <form onSubmit={handleCreateShiftEntry} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Categoría</label>
                            <select name="category" defaultValue="incident" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
                              {Object.entries(shiftEntryCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Prioridad</label>
                            <select name="priority" defaultValue="medium" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
                              {Object.entries(shiftPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Espacio relacionado</label>
                            <select name="related_space_id" defaultValue="" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none">
                              <option value="">Sin espacio</option>
                              {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                            </select>
                          </div>
                          <div className="md:col-span-3">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Título</label>
                            <input name="title" required minLength={3} placeholder="Ej: Visita sin pase QR requiere validación" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none" />
                          </div>
                          <div className="md:col-span-3">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Detalle operativo</label>
                            <textarea name="detail" rows={3} placeholder="Qué pasó, quién fue avisado, patente/RUT si aplica y qué queda pendiente." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm outline-none" />
                          </div>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 md:min-w-[280px] cursor-pointer hover:bg-white">
                            <span className="truncate">{shiftEvidenceName || 'Adjuntar evidencia opcional'}</span>
                            <span className="text-xs text-slate-400">PDF/JPG/PNG</span>
                            <input
                              type="file"
                              name="evidence"
                              accept="application/pdf,image/jpeg,image/png"
                              className="sr-only"
                              onChange={(event) => setShiftEvidenceName(event.currentTarget.files?.[0]?.name || '')}
                            />
                          </label>
                          <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
                            <input type="checkbox" name="follow_up_required" className="w-4 h-4 accent-slate-900" />
                            Requiere seguimiento
                          </label>
                          <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                            <Plus className="w-4 h-4" /> Registrar Novedad
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="space-y-3">
                    {shiftEntries.map(entry => (
                      <div key={entry.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                              {shiftEntryCategoryLabels[entry.category]}
                            </span>
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                              entry.priority === 'critical' ? "bg-red-100 text-red-700" :
                                entry.priority === 'high' ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-700"
                            )}>
                              {shiftPriorityLabels[entry.priority]}
                            </span>
                            {entry.follow_up_required && (
                              <span className={cn(
                                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                                entry.resolved_at ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                              )}>
                                {entry.resolved_at ? 'Seguimiento resuelto' : 'Seguimiento pendiente'}
                              </span>
                            )}
                            {entry.task_id && (
                              <span className="px-2 py-1 rounded-lg bg-sky-50 text-sky-700 text-[10px] font-bold uppercase tracking-wider">
                                Tarea #{entry.task_id} · {entry.task_status ? statusLabelsForShiftTask[entry.task_status] : 'Activa'}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{entry.title}</p>
                            {entry.detail && <p className="text-sm text-slate-600 mt-1">{entry.detail}</p>}
                            {entry.attachment_id && (
                              <a
                                href={`/api/access/shift-log-entries/${entry.id}/attachments/${entry.attachment_id}/download`}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Evidencia: {entry.attachment_file_name || 'archivo adjunto'}
                              </a>
                            )}
                            <p className="text-xs text-slate-400 mt-2">
                              {new Date(entry.created_at).toLocaleString()} · {entry.staff_name}
                              {entry.related_space_name ? ` · ${entry.related_space_name}` : ''}
                            </p>
                          </div>
                        </div>
                        {entry.follow_up_required && selectedShiftLog.status === 'open' && (
                          <button
                            onClick={() => handleResolveShiftEntry(entry)}
                            title={entry.resolved_at ? 'Reabrir seguimiento' : 'Marcar seguimiento resuelto'}
                            className={cn(
                              "px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 w-fit",
                              entry.resolved_at ? "bg-white border border-slate-200 text-slate-600" : "bg-emerald-600 text-white"
                            )}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {entry.resolved_at ? 'Reabrir' : 'Resolver'}
                          </button>
                        )}
                      </div>
                    ))}
                    {shiftEntries.length === 0 && (
                      <div className="p-8 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                        <ClipboardList className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                        <p className="text-sm font-bold text-slate-400">Sin novedades registradas</p>
                      </div>
                    )}
                  </div>

                  {selectedShiftLog.status === 'open' && (
                    <form onSubmit={handleCloseShift} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                      <div>
                        <h3 className="text-lg font-bold">Cerrar y traspasar turno</h3>
                        <p className="text-sm text-slate-500">Deja instrucciones concretas para quien recibe.</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          'Visitas dentro del recinto revisadas',
                          'Seguimientos pendientes identificados',
                          'Barrera vehicular y puerta peatonal verificadas',
                          'Incidentes críticos traspasados'
                        ].map(item => (
                          <label key={item} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                            <input type="checkbox" required className="w-4 h-4 accent-slate-900" />
                            {item}
                          </label>
                        ))}
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pendientes estructurados para traspaso</p>
                          <p className="text-xs text-slate-500 mt-1">Cada fila con título crea una novedad pendiente y una tarea operacional.</p>
                        </div>
                        {[0, 1, 2].map(index => (
                          <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <input
                              name={`handover_title_${index}`}
                              placeholder={`Pendiente ${index + 1}`}
                              className="md:col-span-4 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none"
                            />
                            <select name={`handover_category_${index}`} defaultValue="handover" className="md:col-span-2 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none">
                              {Object.entries(shiftEntryCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <select name={`handover_priority_${index}`} defaultValue="medium" className="md:col-span-2 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none">
                              {Object.entries(shiftPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <select name={`handover_space_${index}`} defaultValue="" className="md:col-span-2 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none">
                              <option value="">Sin espacio</option>
                              {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                            </select>
                            <input
                              name={`handover_detail_${index}`}
                              placeholder="Acción esperada"
                              className="md:col-span-2 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none"
                            />
                          </div>
                        ))}
                      </div>
                      <textarea name="handover_notes" required minLength={3} rows={4} placeholder="Resumen de incidentes, visitas aún dentro, barreras/cámaras a vigilar y pendientes abiertos." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cierre de caja</p>
                          <p className="text-xs text-slate-500 mt-1">Efectivo esperado: {formatCurrency(cashSummary?.expectedCash)}.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Efectivo contado</label>
                            <input type="number" min={0} name="counted_cash" defaultValue={cashSummary?.expectedCash || 0} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Transferencias</label>
                            <input type="number" min={0} name="counted_transfer" defaultValue={cashSummary?.totals.transfer || 0} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                          </div>
                          <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tarjetas</label>
                            <input type="number" min={0} name="counted_card" defaultValue={cashSummary?.totals.card || 0} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                          </div>
                        </div>
                        <input name="cash_count_note" placeholder="Observación de cuadratura, diferencias o voucher faltante" className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none" />
                      </div>
                      <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                        Cerrar Turno
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">Seguimientos abiertos</h3>
                    <p className="text-xs text-slate-500">{shiftFollowUps.length} pendiente(s) activos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadServerCsv('/api/access/export/shift-log-follow-ups.csv?status=open')}
                      className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-slate-900"
                      title="Exportar seguimientos abiertos"
                    >
                      <FileDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={fetchShiftFollowUps} className="text-xs font-bold text-slate-500 hover:text-slate-900">Actualizar</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {shiftFollowUps.slice(0, 4).map(entry => (
                    <ShiftFollowUpCard key={entry.id} entry={entry} onResolve={handleResolveShiftEntry} isActionLoading={isActionLoading} />
                  ))}
                  {shiftFollowUps.length === 0 && (
                    <div className="p-5 border-2 border-dashed border-slate-100 rounded-2xl text-center">
                      <p className="text-sm font-bold text-slate-400">Sin seguimientos abiertos</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">Turnos</h3>
                <select value={shiftStatusFilter} onChange={(e) => setShiftStatusFilter(e.target.value as 'open' | 'closed' | 'all')} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="open">Abiertos</option>
                  <option value="closed">Cerrados</option>
                  <option value="all">Todos</option>
                </select>
              </div>

              <form onSubmit={handleOpenShift} className="bg-slate-900 text-white rounded-2xl p-4 space-y-3">
                <p className="text-sm font-bold">Nuevo turno</p>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" name="shift_date" defaultValue={new Date().toISOString().slice(0, 10)} className="min-w-0 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none" />
                  <select name="shift_name" defaultValue="custom" className="min-w-0 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none">
                    {Object.entries(shiftNameLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <textarea name="opening_notes" rows={2} placeholder="Recepción breve..." className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none placeholder:text-white/50" />
                <button type="submit" disabled={isActionLoading} className="w-full py-2 bg-white text-slate-900 rounded-xl text-xs font-bold disabled:opacity-50">
                  Abrir Bitácora
                </button>
              </form>

              <div className="space-y-3">
                {shiftLogs.map(log => (
                  <button
                    key={log.id}
                    onClick={() => fetchShiftDetail(log.id)}
                    className={cn(
                      "w-full text-left bg-white border rounded-2xl p-4 transition-all",
                      selectedShiftLog?.id === log.id ? "border-slate-900 shadow-sm" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{shiftNameLabels[log.shift_name]} · {log.shift_date}</p>
                        <p className="text-xs text-slate-500">{log.staff_name}</p>
                      </div>
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                        log.status === 'open' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      )}>
                        {log.status === 'open' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
                      <span>{log.entries_count} novedades</span>
                      <span>{log.pending_follow_ups} pendientes</span>
                    </div>
                  </button>
                ))}
                {shiftLogs.length === 0 && (
                  <div className="p-6 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                    <p className="text-sm font-bold text-slate-400">No hay turnos para este filtro</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {canViewAudit && activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Usuario / RUT</label>
                <input
                  type="text"
                  placeholder="Buscar..."
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.user}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, user: e.target.value });
                    setAuditPage(1);
                  }}
                />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Estado</label>
                <select
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.type}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, type: e.target.value });
                    setAuditPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="authorized">Autorizados</option>
                  <option value="denied">Denegados</option>
                </select>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Desde</label>
                <input
                  type="date"
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.start}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, start: e.target.value });
                    setAuditPage(1);
                  }}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={fetchAudit}
                  className="flex-1 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all"
                >
                  Filtrar
                </button>
                <button
                  onClick={exportAuditCsv}
                  disabled={auditTotal === 0}
                  title="Exportar auditoría filtrada"
                  aria-label="Exportar auditoría filtrada"
                  className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all disabled:opacity-50"
                >
                  <FileDown className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="glass-card overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Fecha/Hora</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Identidad</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Método</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Autorizado Por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-xs font-medium text-slate-500">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold">
                        {log.client_name || log.visitor_name || 'Desconocido'}
                        {log.plate && <span className="text-slate-500 font-mono ml-2">({log.plate})</span>}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">
                          {log.method}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                        )}>
                          {log.status === 'authorized' ? 'Autorizado' : 'Denegado'}
                        </span>
                        {log.resolved_by_access_log_id && (
                          <p className="mt-1 text-[10px] font-bold text-emerald-600">
                            Resuelto por autorizacion #{log.resolved_by_access_log_id}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500 italic">
                        {log.authorized_by || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {canManageRates && activeTab === 'rates' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {rates.length === 0 && (
              <div className="md:col-span-3 glass-card p-6 flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-base font-bold text-slate-900">Sin tarifas configuradas</h4>
                  <p className="text-sm text-slate-500 mt-1">Las tarifas base se crean automáticamente al iniciar el sistema.</p>
                </div>
                <button
                  onClick={fetchData}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  Actualizar
                </button>
              </div>
            )}
            {rates.map(rate => (
              <div key={rate.id} className="glass-card p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="p-3 bg-slate-100 rounded-2xl">
                    <Settings2 className="w-6 h-6 text-slate-600" />
                  </div>
                  <button
                    onClick={() => { setSelectedRate(rate); setDrawerType('rate'); setIsDrawerOpen(true); }}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                </div>
                <div>
                  <h4 className="text-lg font-bold">{rate.type}</h4>
                  <p className="text-sm text-slate-500">Cobro por minuto efectivo, sin redondeo al alza</p>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tarifa / Min</p>
                    <p className="text-xl font-bold">${Number(rate.rate_per_minute || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gracia (Mins)</p>
                    <p className="text-xl font-bold">{rate.grace_period_mins}m</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={
          drawerType === 'visitor' ? 'Nuevo Pase de Visita' :
            drawerType === 'override' ? 'Registro Manual de Emergencia' : 'Configurar Tarifa'
        }
      >
        {drawerType === 'visitor' && (
          <form onSubmit={handleCreatePass} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nombre Completo</label>
                <input type="text" name="name" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT</label>
                <input type="text" name="rut" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Teléfono</label>
                <input type="text" name="phone" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Patente</label>
                <input type="text" name="plate" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm uppercase focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Empresa</label>
                <input type="text" name="company" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo Visitante</label>
                <select name="type" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                  <option value="provider">Proveedor</option>
                  <option value="family">Familiar</option>
                  <option value="maintenance">Mantenimiento</option>
                  <option value="other">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Autorizado por</label>
                <input type="text" name="authorized_by" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo de Visita</label>
                <textarea name="reason" rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Válido Desde</label>
                <input type="datetime-local" name="valid_from" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Válido Hasta</label>
                <input type="datetime-local" name="valid_to" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>
            <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Generar Pase QR
            </button>
          </form>
        )}

        {drawerType === 'override' && (
          <form onSubmit={handleOverride} className="space-y-6">
            <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
              <ShieldAlert className="w-6 h-6" />
              <p className="text-sm font-bold">Esta acción quedará registrada permanentemente en la auditoría a nombre de {currentUser?.name || 'Guardia'}. El sistema no acciona puertas ni barreras físicas.</p>
            </div>

            <div className="space-y-4">
              {selectedLog && (
                <div className="p-4 bg-slate-50 rounded-2xl">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Intento Fallido</p>
                  <p className="text-sm font-bold">{selectedLog.client_name || selectedLog.visitor_name}</p>
                  <p className="text-xs text-red-500 font-bold">{selectedLog.reason}</p>
                  <p className="text-[10px] text-slate-400 mt-1">Se enlazará la autorización manual con el acceso denegado #{selectedLog.id}.</p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Acceso vehicular / espacio</label>
                <select name="space_id" required defaultValue={selectedLog?.space_id || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                  <option value="">Seleccione barrera vehicular...</option>
                  {spaces.map(s => (
                    <option key={s.id} value={s.id}>Barrera vehicular - {s.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500">La puerta peatonal se identifica visualmente en el monitor; este flujo registra autorización manual contra un espacio auditado.</p>
              </div>

              {!selectedLog && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo de movimiento</label>
                  <select name="access_type" defaultValue="entry" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                    <option value="entry">Entrada</option>
                    <option value="exit">Salida</option>
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo de Autorizacion Manual</label>
                <textarea name="reason" required rows={4} placeholder="Ej: Cliente indica que pagó, se dirige a finanzas..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>

            <input type="hidden" name="client_id" value={selectedLog?.client_id || ''} />

            <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl shadow-red-100 hover:bg-red-700 transition-all disabled:opacity-50">
              Registrar Autorizacion Manual
            </button>
          </form>
        )}

        {canManageRates && drawerType === 'rate' && selectedRate && (
          <form onSubmit={handleUpdateRate} className="space-y-6">
            <div className="space-y-4">
              <h4 className="text-lg font-bold">{selectedRate.type}</h4>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tarifa por Minuto ($)</label>
                <input type="number" name="rate_per_minute" min={0} defaultValue={selectedRate.rate_per_minute || Math.floor(selectedRate.rate_per_hour / 60)} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
                <p className="mt-2 text-xs text-slate-500">Modalidad legal: minuto efectivo. Parkia no redondea el cobro al alza.</p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tiempo de Gracia (Minutos)</label>
                <input type="number" name="grace_period_mins" defaultValue={selectedRate.grace_period_mins} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>
            <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Guardar Cambios
            </button>
          </form>
        )}
      </Drawer>
    </div>
  );
};

export default AccessPage;

