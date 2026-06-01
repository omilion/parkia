import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Banknote, Box, CheckCircle2, ClipboardList, Clock, CreditCard, Download, FileSpreadsheet, FileText, RefreshCw, Shield, ShieldAlert, ShieldCheck, Ticket, X, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardData, StaffUser } from '../types';
import Toast from '../components/ui/Toast';
import { apiFetchJson } from '../lib/api';
import { cn } from '../lib/utils';

const EmptyState = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex min-h-[128px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
    <p className="text-sm font-bold text-slate-600">{title}</p>
    <p className="mt-1 max-w-xs text-xs text-slate-400">{detail}</p>
  </div>
);

const formatPaymentDate = (value: string | null) => {
  if (!value) return 'Sin fecha';
  const normalizedValue = value.includes('T') ? value : `${value}T00:00:00`;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-CL');
};

const formatAccessTime = (value: string | null | undefined) => {
  if (!value) return '--:--';
  const normalizedValue = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatAccessDate = (value: string | null | undefined) => {
  if (!value) return 'Sin fecha';
  const normalizedValue = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-CL');
};

const toCount = (value: unknown, fallback = 0) => {
  const count = Number(value);
  return Number.isFinite(count) ? count : fallback;
};

const formatCurrency = (value: number | null | undefined) =>
  `$${Number(value || 0).toLocaleString('es-CL')}`;

const Dashboard = ({ user }: { user: StaffUser }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [newEndDate, setNewEndDate] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [creatingAlertTaskId, setCreatingAlertTaskId] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<'ok' | 'degraded'>('degraded');

  const fetchData = () => {
    apiFetchJson<DashboardData>('/api/dashboard')
      .then(setData)
      .catch(error => setToast({ message: error.message || 'No se pudo cargar el dashboard', type: 'error' }));
    fetch('/api/health')
      .then(res => res.json())
      .then(body => setSystemStatus(body.status === 'ok' ? 'ok' : 'degraded'))
      .catch(() => setSystemStatus('degraded'));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Polling every 30s
    return () => clearInterval(interval);
  }, []);

  const handleRenew = async () => {
    if (!selectedContract || !newEndDate) return;
    const res = await fetch(`/api/contracts/${selectedContract.id}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_end_date: newEndDate })
    });
    if (res.ok) {
      setToast({ message: 'Contrato renovado exitosamente', type: 'success' });
      setIsRenewModalOpen(false);
      fetchData();
    }
  };

  const handleCreateAlertTask = async (alertId: string) => {
    setCreatingAlertTaskId(alertId);
    try {
      const body = await apiFetchJson<{ existing: boolean }>(`/api/dashboard/alerts/${alertId}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      setToast({
        message: body.existing ? 'La alerta ya tenía una tarea activa' : 'Tarea creada desde alerta',
        type: 'success'
      });
      fetchData();
    } catch (error: any) {
      setToast({ message: error.message || 'Error de red al crear la tarea', type: 'error' });
    } finally {
      setCreatingAlertTaskId(null);
    }
  };

  if (!data) return <div className="p-8">Cargando dashboard...</div>;

  const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];
  const canSeeFinance = user.role === 'admin' || user.role === 'finance';
  const operationsDaily = data.operations_daily;
  const access = data.access as any;
  const liveAccessFallback = Array.isArray((data as any).live_access) ? (data as any).live_access : [];
  const todayAccess = Array.isArray(access.today_access)
    ? access.today_access
    : Array.isArray(access.todayAccess)
      ? access.todayAccess
      : liveAccessFallback;
  const recentAccess = Array.isArray(access.recent_access)
    ? access.recent_access
    : Array.isArray(access.recentAccess)
      ? access.recentAccess
      : liveAccessFallback;
  const isAuthorizedAccess = (log: any) => ['authorized', 'granted', 'allowed', 'ok'].includes(String(log?.status || '').toLowerCase());
  const isDeniedAccess = (log: any) => ['denied', 'rejected', 'unauthorized', 'blocked'].includes(String(log?.status || '').toLowerCase()) || !isAuthorizedAccess(log);
  const isEntryAccess = (log: any) => log?.access_type === 'entry' || log?.type === 'entry' || log?.direction === 'entry';
  const isExitAccess = (log: any) => log?.access_type === 'exit' || log?.type === 'exit' || log?.direction === 'exit';
  const computedTodayEntries = todayAccess.filter((log: any) => isAuthorizedAccess(log) && isEntryAccess(log)).length;
  const computedTodayExits = todayAccess.filter((log: any) => isAuthorizedAccess(log) && isExitAccess(log)).length;
  const computedTodayDenied = todayAccess.filter((log: any) => isDeniedAccess(log)).length;
  const todayEntries = toCount(access.today_entries ?? access.entries, computedTodayEntries);
  const todayExits = toCount(access.today_exits ?? access.exits, computedTodayExits);
  const todayDenied = toCount(access.today_denied ?? access.denied, computedTodayDenied);
  const accessTodayTotal = toCount(
    access.today_total
    ?? access.todayTotal
    ?? access.daily_total,
    todayAccess.length || todayEntries + todayExits + todayDenied
  );
  const occupancyData = [
    { name: 'Ocupado', value: data.occupancy.occupied },
    { name: 'Libre', value: data.occupancy.total - data.occupancy.occupied },
  ];
  const hasOccupancyData = data.occupancy.total > 0 && occupancyData.some(item => item.value > 0);
  const accessChartData = (Array.isArray(access.hourly_peaks) ? access.hourly_peaks : [])
    .map((item: any) => ({
      ...item,
      hour: toCount(item.hour, -1),
      count: toCount(item.count, 0)
    }))
    .filter((item: any) => item.hour >= 0)
    .map((item: any) => ({
      ...item,
      hourLabel: `${String(item.hour).padStart(2, '0')}:00`
    }));
  const hasAccessChartData = accessChartData.length > 0 && accessChartData.some(item => item.count > 0);
  const hasTodayAccess = accessTodayTotal > 0 || todayAccess.length > 0 || hasAccessChartData;
  const occupancyPercent = data.occupancy.total > 0 ? Math.round((data.occupancy.occupied / data.occupancy.total) * 100) : 0;
  const revenueProgress = data.revenue.target > 0 ? Math.min(100, Math.round((data.revenue.total_collected / data.revenue.target) * 100)) : 0;
  const revenueTrendLabel = data.revenue.trend > 0 ? `+${data.revenue.trend}%` : `${data.revenue.trend}%`;
  const revenueTrendTone = data.revenue.trend > 0 ? 'text-emerald-600' : data.revenue.trend < 0 ? 'text-red-600' : 'text-slate-500';
  const revenueTrendMessage = data.revenue.trend > 0
    ? 'Recaudación sobre el mes anterior.'
    : data.revenue.trend < 0
      ? 'Recaudación bajo el mes anterior.'
      : 'Recaudación sin variación frente al mes anterior.';
  const availableParking = data.occupancy.available_parking || [];
  const availableParkingCount = data.occupancy.parking_free ?? availableParking.length;

  const renderAvailableSpaces = (spaces: typeof availableParking, emptyLabel: string) => {
    const visibleSpaces = spaces.slice(0, 4);
    if (spaces.length === 0) {
      return <p className="text-xs text-slate-400 mt-2">{emptyLabel}</p>;
    }

    return (
      <div className="mt-2 space-y-1">
        {visibleSpaces.map(space => (
          <Link
            key={space.id}
            to={`/spaces?spaceId=${space.id}`}
            className="block truncate rounded-lg bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            title={[space.name, space.location, space.level].filter(Boolean).join(' · ')}
          >
            {space.name}
          </Link>
        ))}
        {spaces.length > visibleSpaces.length && (
          <Link to="/spaces" className="block text-xs font-bold text-indigo-600 hover:text-indigo-700">
            +{spaces.length - visibleSpaces.length} más
          </Link>
        )}
      </div>
    );
  };

  const accessSummaryCards = [
    { label: 'Total', value: accessTodayTotal, icon: Shield, tone: 'bg-slate-900 text-white' },
    { label: 'Entradas', value: todayEntries, icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-600' },
    { label: 'Salidas', value: todayExits, icon: ArrowUpRight, tone: 'bg-blue-50 text-blue-600' },
    { label: 'Denegados', value: todayDenied, icon: ShieldAlert, tone: 'bg-red-50 text-red-600' },
  ];

  const operationsCards = operationsDaily ? [
    {
      label: canSeeFinance ? 'Ingresos visitas' : 'Tickets cobrados',
      value: canSeeFinance ? formatCurrency(operationsDaily.visitorRevenue.total) : operationsDaily.visitorRevenue.count.toLocaleString('es-CL'),
      detail: canSeeFinance ? `${operationsDaily.visitorRevenue.count} ticket(s) cobrados` : 'Detalle monetario reservado',
      icon: canSeeFinance ? Banknote : Ticket,
      tone: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: 'Diferencia caja',
      value: canSeeFinance ? formatCurrency(operationsDaily.cashClosures.differenceCash) : operationsDaily.cashClosures.withDifference.toLocaleString('es-CL'),
      detail: canSeeFinance ? `${operationsDaily.cashClosures.count} cierre(s)` : 'Cierres con diferencia',
      icon: CreditCard,
      tone: Math.abs(operationsDaily.cashClosures.differenceCash) > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700',
    },
    {
      label: 'Tickets activos',
      value: operationsDaily.tickets.active.toLocaleString('es-CL'),
      detail: `${operationsDaily.tickets.paidAwaitingExit} pagado(s) sin salida`,
      icon: Ticket,
      tone: operationsDaily.tickets.paidAwaitingExit > 0 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Ocupación',
      value: operationsDaily.occupancy.total > 0 ? `${Math.round((operationsDaily.occupancy.occupied / operationsDaily.occupancy.total) * 100)}%` : '0%',
      detail: `${operationsDaily.occupancy.available} disponible(s)`,
      icon: Box,
      tone: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: 'Denegados',
      value: operationsDaily.access.denied.toLocaleString('es-CL'),
      detail: `${operationsDaily.access.unresolvedDeniedExits} salida(s) sin resolver`,
      icon: ShieldAlert,
      tone: operationsDaily.access.unresolvedDeniedExits > 0 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700',
    },
  ] : [];

  const renderAccessLog = (log: any, timeCaption = 'Hoy') => {
    const denied = isDeniedAccess(log);
    const accessLabel = isEntryAccess(log) ? 'Entrada' : isExitAccess(log) ? 'Salida' : 'Acceso';
    const person = log.client_name || log.visitor_name || log.person_name || log.name || 'Sin identificación';
    const detail = [log.plate, log.method, log.gate_name || log.gate].filter(Boolean).join(' · ');

    return (
      <div key={log.id || `${log.timestamp}-${person}`} className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50">
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          denied ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
        )}>
          {denied ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-bold text-slate-900">{person}</p>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
              denied ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
            )}>
              {denied ? 'Denegado' : 'OK'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {accessLabel}{detail ? ` · ${detail}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs font-bold text-slate-900">{formatAccessTime(log.timestamp)}</p>
          <p className="text-[10px] font-semibold text-slate-400">{timeCaption}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 max-w-7xl mx-auto">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Panel de control</h2>
          <p className="text-slate-500 mt-1">Bienvenido de vuelta, {user.name}.</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Estado del sistema</p>
          <div className="flex items-center gap-2 mt-1">
            <div className={cn("w-2 h-2 rounded-full animate-pulse", systemStatus === 'ok' ? 'bg-emerald-500' : 'bg-amber-500')} />
            <span className="text-sm font-bold text-slate-900">{systemStatus === 'ok' ? 'Operativo' : 'Revisar'}</span>
          </div>
        </div>
      </div>

      {data.alerts.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3">
            <h3 className="font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Alertas prioritarias
            </h3>
            <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full uppercase">{data.alerts.length} activas</span>
          </div>
          <div className="divide-y divide-slate-100">
            {data.alerts.map(alert => (
              <div key={alert.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                    alert.severity === 'critical' ? "bg-red-50 text-red-600" :
                      alert.severity === 'warning' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                  )}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">{alert.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{alert.detail}</p>
                  </div>
                </div>
                <div className="shrink-0 flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <Link
                    to={alert.href}
                    className="flex-1 md:flex-none px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors text-center"
                  >
                    {alert.actionLabel}
                  </Link>
                  {alert.taskId ? (
                    <Link
                      to={alert.href.startsWith('/tasks') ? alert.href : `/tasks?source=dashboard_alert&taskId=${alert.taskId}`}
                      className="flex-1 md:flex-none px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors text-center inline-flex items-center justify-center gap-2"
                    >
                      <ClipboardList className="w-4 h-4" />
                      Ver tarea
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleCreateAlertTask(alert.id)}
                      disabled={creatingAlertTaskId === alert.id}
                      className="flex-1 md:flex-none px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors text-center disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    >
                      <ClipboardList className="w-4 h-4" />
                      {creatingAlertTaskId === alert.id ? 'Creando...' : 'Crear tarea'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Occupancy Card */}
        <div className="glass-card p-6 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Ocupación Global</h3>
              <p className="text-3xl font-black mt-1">{occupancyPercent}%</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Box className="w-6 h-6" />
            </div>
          </div>
          <div className="h-40 min-h-40 w-full min-w-0">
            {hasOccupancyData ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={160} minHeight={160}>
                <PieChart>
                  <Pie
                    data={occupancyData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={60}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {occupancyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Sin espacios registrados" detail="Cuando existan espacios activos, aquí se mostrará la ocupación global." />
            )}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estacionamientos disponibles</p>
              <p className="text-lg font-bold text-slate-900">{availableParkingCount}</p>
              {renderAvailableSpaces(availableParking, 'Sin estacionamientos disponibles')}
            </div>
          </div>
        </div>

        {/* Revenue Card */}
        {canSeeFinance && (
          <div className="glass-card p-6 flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Recaudación del mes</h3>
                <p className="text-3xl font-black mt-1">${data.revenue.total_collected.toLocaleString()}</p>
              </div>
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                <CreditCard className="w-6 h-6" />
              </div>
            </div>
            <div className="flex-1 flex flex-col justify-center">
              <div className="flex justify-between items-end mb-2">
                <p className="text-xs font-bold text-slate-500">Meta: ${data.revenue.target.toLocaleString()}</p>
                <p className={cn("text-xs font-bold", revenueTrendTone)}>{revenueTrendLabel} vs mes ant.</p>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${revenueProgress}%` }}
                  className="h-full bg-emerald-500 rounded-full"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-2 text-center">Progreso basado en contratos activos</p>
            </div>
            <div className={cn("mt-6 p-4 rounded-2xl flex items-center gap-3", data.revenue.trend < 0 ? "bg-red-50" : "bg-emerald-50")}>
              <ArrowUpRight className={cn("w-5 h-5", data.revenue.trend < 0 ? "text-red-600" : "text-emerald-600")} />
              <p className={cn("text-xs font-medium", data.revenue.trend < 0 ? "text-red-900" : "text-emerald-900")}>{revenueTrendMessage}</p>
            </div>
          </div>
        )}
      </div>

      {operationsDaily && (
        <section className="glass-card overflow-hidden">
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Ejecutivo diario</h3>
                <p className="mt-1 text-sm text-slate-500">{operationsDaily.date} · Caja, visitas, ocupación y alertas del día.</p>
              </div>
              {canSeeFinance && (
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/dashboard/export/operations-daily.csv?date=${operationsDaily.date}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    <FileText className="h-4 w-4" />
                    CSV
                  </a>
                  <a href={`/api/dashboard/export/operations-daily.xlsx?date=${operationsDaily.date}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    <FileSpreadsheet className="h-4 w-4" />
                    XLSX
                  </a>
                  <a href={`/api/dashboard/export/operations-daily.pdf?date=${operationsDaily.date}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    <Download className="h-4 w-4" />
                    PDF
                  </a>
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {operationsCards.map(card => {
                const Icon = card.icon;
                return (
                  <div key={card.label} className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{card.label}</p>
                      <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", card.tone)}>
                        <Icon className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="mt-3 text-2xl font-black text-slate-900">{card.value}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{card.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
            <div className="border-b border-slate-100 p-5 sm:p-6 lg:col-span-3 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-slate-900">Alertas operativas</h4>
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{operationsDaily.alerts.length} activas</span>
              </div>
              <div className="mt-4 space-y-2">
                {operationsDaily.alerts.length > 0 ? operationsDaily.alerts.map(alert => (
                  <div key={alert.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">{alert.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{alert.detail}</p>
                  </div>
                )) : (
                  <EmptyState title="Sin alertas operativas" detail="La caja, visitas y salidas no registran bloqueos críticos para el día." />
                )}
              </div>
            </div>

            <div className="p-5 sm:p-6 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-slate-900">Caja por cajera</h4>
                <Banknote className="h-5 w-5 text-emerald-500" />
              </div>
              {canSeeFinance && operationsDaily.byCashier.length > 0 ? (
                <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-100">
                  {operationsDaily.byCashier.slice(0, 5).map(row => (
                    <div key={row.cashierName} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{row.cashierName}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{row.tickets} ticket(s)</p>
                      </div>
                      <p className="text-sm font-black text-emerald-600">{formatCurrency(row.total)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title={canSeeFinance ? 'Sin cobros por cajera' : 'Detalle reservado'} detail={canSeeFinance ? 'Cuando existan pagos de visitas, aparecerán agrupados por responsable.' : 'El rol actual ve operación sin desglose monetario.'} />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Access Operations */}
      <section className="glass-card overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Operación de accesos hoy</h3>
                  <p className="mt-1 text-sm text-slate-500">Resumen operativo, gráfico horario y actividad del día en una sola vista.</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start rounded-full bg-slate-50 px-3 py-1.5">
              <span className={cn("h-2 w-2 rounded-full", hasTodayAccess ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {hasTodayAccess ? 'Actualizado hoy' : 'Sin operación hoy'}
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {accessSummaryCards.map(item => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", item.tone)}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-black text-slate-900">{item.value.toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
          <div className="border-b border-slate-100 p-5 sm:p-6 lg:col-span-3 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Flujo horario</h4>
                <p className="mt-1 text-xs text-slate-500">Picos de accesos agrupados por hora del día.</p>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-600">Hoy</span>
            </div>
            <div className="h-64 min-h-64 w-full min-w-0">
              {hasAccessChartData ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={180} minHeight={240}>
                  <AreaChart data={accessChartData} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorAccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" stroke="#4f46e5" fillOpacity={1} fill="url(#colorAccess)" strokeWidth={3} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="Sin flujo horario hoy" detail="Cuando se registren entradas, salidas o rechazos, aparecerán agrupados por hora." />
              )}
            </div>
          </div>

          <div className="p-5 sm:p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Actividad de hoy</h4>
                <p className="mt-1 text-xs text-slate-500">Últimos eventos operativos del día.</p>
              </div>
              <Zap className="h-5 w-5 text-indigo-500" />
            </div>
            {todayAccess.length > 0 ? (
              <div className="max-h-[336px] space-y-1 overflow-y-auto pr-1">
                {todayAccess.slice(0, 8).map((log: any) => renderAccessLog(log))}
              </div>
            ) : (
              <div className="space-y-4">
                <EmptyState title="Sin actividad de hoy" detail="Aún no se registran accesos para la fecha actual." />
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h5 className="text-xs font-bold uppercase tracking-widest text-slate-500">Últimos registros históricos</h5>
                    <span className="text-[10px] font-bold text-slate-400">{recentAccess.length} registros</span>
                  </div>
                  {recentAccess.length > 0 ? (
                    <div className="space-y-1">
                      {recentAccess.slice(0, 5).map((log: any) => renderAccessLog(log, formatAccessDate(log.timestamp)))}
                    </div>
                  ) : (
                    <p className="px-2 py-4 text-center text-xs text-slate-400">No hay registros históricos disponibles.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bottom Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Expiring Contracts */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold flex items-start gap-2">
              <Clock className="mt-0.5 w-5 h-5 text-amber-500" />
              <span className="flex flex-col leading-tight">
                <span>Contratos por vencer</span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  (activos con término en los próximos 30 días)
                </span>
              </span>
            </h3>
            <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full uppercase">Atención</span>
          </div>
          <div className="glass-card overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto">
              {data.expiring_contracts.length > 0 ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 font-bold text-slate-500 text-[10px] uppercase tracking-wider">Cliente</th>
                      <th className="px-4 py-3 font-bold text-slate-500 text-[10px] uppercase tracking-wider">Vence</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.expiring_contracts.map((contract) => {
                      const daysLeft = Math.ceil((new Date(contract.end_date!).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                      return (
                        <tr key={contract.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-4">
                            <p className="font-bold text-slate-900">{contract.client_name}</p>
                            <p className="text-[10px] text-slate-500">{contract.space_name}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                              daysLeft < 0 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                            )}>
                              {daysLeft < 0 ? 'Vencido' : `en ${daysLeft} días`}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              onClick={() => { setSelectedContract(contract); setIsRenewModalOpen(true); }}
                              className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-12 text-center">
                  <p className="text-slate-400 text-sm italic">No hay contratos próximos a vencer.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recent Payments */}
        {canSeeFinance && (
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Banknote className="w-5 h-5 text-emerald-500" />
                Últimos Pagos
              </h3>
              <Link to="/finance" className="text-[10px] font-bold text-indigo-600 hover:underline uppercase">Ver todo</Link>
            </div>
            <div className="glass-card p-2 space-y-1">
              {data.recent_payments.length > 0 ? (
                data.recent_payments.map((payment) => (
                  <Link key={payment.id} to={`/finance?tab=payments&paymentId=${payment.id}`} className="flex items-center gap-4 p-3 hover:bg-slate-50 rounded-xl transition-colors">
                    <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900 truncate">{payment.client_name}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{payment.method || 'Manual'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">${payment.amount.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">{formatPaymentDate(payment.payment_date)}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState title="Sin pagos recientes" detail="Los pagos confirmados aparecerán aquí cuando Finanzas registre movimientos." />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Renew Modal */}
      <AnimatePresence>
        {isRenewModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsRenewModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-bold">Renovación rápida</h3>
                    <p className="text-slate-500 mt-1">Extiende la vigencia del contrato.</p>
                  </div>
                  <button onClick={() => setIsRenewModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente</span>
                    <span className="text-xs font-bold text-slate-900">{selectedContract?.client_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Espacio</span>
                    <span className="text-xs font-bold text-slate-900">{selectedContract?.space_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencimiento actual</span>
                    <span className="text-xs font-bold text-slate-900">{selectedContract?.end_date}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nueva Fecha de Término</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-600 rounded-2xl outline-none transition-all"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setIsRenewModalOpen(false)}
                    className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleRenew}
                    className="flex-1 px-6 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-colors"
                  >
                    Confirmar Renovación
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;

