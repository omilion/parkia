import { useApiMutation } from '../../../lib/useApiMutation';
import { IntegrationSettingsForm } from '../components/IntegrationSettingsForm';
import type { IntegrationSettingsValues } from '../../../../shared/schemas/settings';
import { useSettingsData } from '../useSettingsData';
import { GeneralSettingsForm } from '../components/GeneralSettingsForm';
import { Button, Dialog, LoadingState, PageHeader } from '../../../ui';
import React, { Suspense, lazy, useEffect, useState } from 'react';

// El asistente de facturación electrónica se descarga solo al abrir su sección.
const DteSettingsPanel = lazy(() => import('../../dte/pages/DteSettingsPanel'));
const TariffsPanel = lazy(() => import('../../pricing/pages/TariffsPanel'));
const PaymentSettingsPanel = lazy(() => import('../../payments/pages/PaymentSettingsPanel'));
import { AnimatePresence } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { Banknote, Cpu, Database, Download, FileSpreadsheet, Globe, HardDrive, Lock, RefreshCw, Settings, ShieldCheck } from 'lucide-react';
import { Totem } from '../../../types';
import Toast from '../../../components/ui/Toast';
import { cn } from '../../../lib/utils';

const SettingsEmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="glass-card p-8 text-center">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
      <Settings className="h-6 w-6" />
    </div>
    <p className="text-sm font-bold text-slate-900">{title}</p>
    <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

const settingsTabs = [
  { id: 'general', label: 'General y Financiera', icon: Settings },
  { id: 'subscription', label: 'SaaS y Suscripción', icon: Banknote },
  { id: 'hardware', label: 'Hardware y Tótems', icon: Cpu },
  { id: 'tariffs', label: 'Tarifas y Convenios', icon: Banknote },
  { id: 'payments', label: 'Pagos en Línea', icon: Banknote },
  { id: 'sii', label: 'Facturación SII', icon: FileSpreadsheet },
  { id: 'integrations', label: 'Integraciones (APIs)', icon: Globe },
  { id: 'operations', label: 'Operación', icon: ShieldCheck }
] as const;

const isSettingsTab = (value: string | null): value is typeof settingsTabs[number]['id'] =>
  Boolean(value && settingsTabs.some(tab => tab.id === value));

const formatCurrency = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const formatLimit = (value: number | null | undefined) => value == null ? 'Sin límite' : Number(value).toLocaleString('es-CL');

const SettingsPage = () => {
  const apiWrite = useApiMutation("features/settings/pages");
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => isSettingsTab(searchParams.get('tab')) ? searchParams.get('tab')! : 'general');
  const [lastBackup, setLastBackup] = useState<any | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ totem: Totem } | null>(null);
  const settingsQuery = useSettingsData();
  const { fetchData, setBackups } = settingsQuery;
  const config = settingsQuery.data?.config;
  const totems = settingsQuery.data?.totems ?? [];
  const health = settingsQuery.data?.health;
  const backups = settingsQuery.data?.backups ?? [];
  const importTemplates = settingsQuery.data?.importTemplates ?? [];
  const tenantContext = settingsQuery.data?.tenantContext;
  const readinessChecks = health?.readiness?.checks || [];
  const criticalChecks = readinessChecks.filter((check: any) => check.status === 'critical');
  const warningChecks = readinessChecks.filter((check: any) => check.status === 'warning');
  // Respaldos e infraestructura son de la instalacion completa: el backend los
  // restringe a administradores de plataforma (PARKIA_PLATFORM_ADMINS).
  const isPlatformAdmin = Boolean(tenantContext?.is_platform_admin);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (isSettingsTab(tab) && tab !== activeTab) setActiveTab(tab);
  }, [activeTab, searchParams]);

  const handleTabChange = (tabId: typeof settingsTabs[number]['id']) => {
    setActiveTab(tabId);
    const next = new URLSearchParams(searchParams);
    if (tabId === 'general') {
      next.delete('tab');
    } else {
      next.set('tab', tabId);
    }
    setSearchParams(next, { replace: true });
  };

  const handleUpdateConfig = async (data: IntegrationSettingsValues) => {
    setIsActionLoading(true);

    const res = await apiWrite.request('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Configuración actualizada', type: 'success' });
      fetchData();
    } else {
      const body = await res.json().catch(() => ({}));
      setToast({ message: body.error || 'No se pudo actualizar la configuración', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const toggleMaintenance = async (totem: Totem) => {
    const res = await apiWrite.request(`/api/totems/${totem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maintenance_mode: !totem.maintenance_mode })
    });
    if (res.ok) {
      setToast({ message: `Tótem ${!totem.maintenance_mode ? 'en mantenimiento' : 'operativo'}`, type: 'success' });
      setConfirmModal(null);
      fetchData();
    }
  };

  const createDatabaseBackup = async () => {
    setIsActionLoading(true);
    const res = await apiWrite.request('/api/backups/database', { method: 'POST' });
    const body = await res.json();
    if (res.ok) {
      setLastBackup(body.backup);
      setBackups(prev => [body.backup, ...prev.filter(item => item.fileName !== body.backup.fileName)].slice(0, 20));
      setToast({ message: 'Respaldo de base de datos creado', type: 'success' });
    } else {
      setToast({ message: body.error || 'No se pudo crear el respaldo', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const downloadImportTemplate = async (templateId: string) => {
    try {
      const res = await fetch(`/api/import/templates/${templateId}.csv`);
      if (!res.ok) throw new Error('No se pudo descargar la plantilla');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${templateId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo descargar la plantilla', type: 'error' });
    }
  };

  const readFileAsText = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsText(file);
  });

  const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const uploadImportTemplate = async (template: any, file: File | null | undefined) => {
    if (!file) return;
    if (!String(file.name).toLowerCase().endsWith('.csv')) {
      setToast({ message: 'La carga inicial debe ser un archivo CSV', type: 'error' });
      return;
    }

    setIsActionLoading(true);
    try {
      let endpoint = template.importEndpoint;
      let body: Record<string, unknown>;
      if (template.id === 'clients') {
        endpoint = '/api/clients/import';
        body = { csvText: await readFileAsText(file) };
      } else if (template.id === 'bank-movements') {
        endpoint = '/api/finance/bank-movements/import';
        body = { fileName: file.name, dataBase64: await readFileAsBase64(file) };
      } else {
        throw new Error('Esta plantilla no tiene importación operativa');
      }

      const res = await apiWrite.request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'No se pudo importar el archivo');
      setToast({ message: `Importación completada: ${result.imported ?? 0} registros nuevos, ${result.skipped ?? 0} omitidos.`, type: 'success' });
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo importar el archivo', type: 'error' });
    } finally {
      setIsActionLoading(false);
    }
  };

  const restoreDatabaseBackup = async (fileName: string) => {
    const confirmation = window.prompt(`Escribe el nombre exacto del respaldo para restaurar:\n${fileName}`);
    if (confirmation !== fileName) {
      if (confirmation !== null) setToast({ message: 'Confirmación de restauración cancelada', type: 'error' });
      return;
    }

    setIsActionLoading(true);
    try {
      const res = await apiWrite.request(`/api/backups/database/${encodeURIComponent(fileName)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: fileName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo restaurar el respaldo');
      if (body.safetyBackup) {
        setBackups(prev => [body.safetyBackup, ...prev.filter(item => item.fileName !== body.safetyBackup.fileName)].slice(0, 20));
      }
      setToast({ message: 'Respaldo restaurado. Reinicia el servidor para asegurar que todas las conexiones usen la base restaurada.', type: 'success' });
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo restaurar el respaldo', type: 'error' });
    } finally {
      setIsActionLoading(false);
    }
  };

  if (settingsQuery.isPending) return <LoadingState label="Cargando configuracion" />;
  if (!config) return <div role="alert" className="p-6 text-red-800">{settingsQuery.error?.message || 'No se pudo cargar la configuracion'}<Button onClick={() => fetchData()}>Reintentar</Button></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8"><AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>
<Dialog open={Boolean(confirmModal)} title="Activar modo mantenimiento" onClose={() => setConfirmModal(null)} footer={<div className="flex gap-3"><Button variant="secondary" onClick={() => setConfirmModal(null)}>Cancelar</Button><Button onClick={() => confirmModal && toggleMaintenance(confirmModal.totem)}>Activar mantenimiento</Button></div>}>
        <p className="text-sm text-slate-700">El autoservicio de <strong>{confirmModal?.totem.name}</strong> quedara deshabilitado mientras dure el mantenimiento.</p>
      </Dialog><PageHeader title={<>Configuración del Sistema</>} description={<>Panel de control maestro para parámetros, hardware e integraciones.</>} /><div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[220px_minmax(0,1fr)]"><nav aria-label="Secciones de configuracion" className="grid content-start gap-2">{settingsTabs.map(tab=><button key={tab.id} type="button" aria-current={activeTab===tab.id?'page':undefined} onClick={()=>handleTabChange(tab.id)} className={cn('min-h-11 rounded-xl px-4 py-3 text-left text-sm font-semibold',activeTab===tab.id?'bg-indigo-50 text-indigo-800':'bg-white text-slate-700 hover:bg-slate-100')}>{tab.label}</button>)}</nav><div className="min-h-[500px]">
        {activeTab === 'general' && (
          <GeneralSettingsForm config={config} onSaved={() => setToast({ message: 'Configuracion actualizada', type: 'success' })} />
        )}

        {activeTab === 'subscription' && (
          tenantContext ? (
            <div className="max-w-6xl space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="glass-card p-6 lg:col-span-2">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Tenant actual</p>
                      <h3 className="mt-2 text-2xl font-bold text-slate-900">{tenantContext.tenant.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{tenantContext.tenant.rut || 'RUT no configurado'} · Rol {tenantContext.membership.role}</p>
                    </div>
                    <span className={cn(
                      "inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider",
                      tenantContext.canOperate ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    )}>
                      {tenantContext.canOperate ? 'Operativo' : 'Bloqueado'}
                    </span>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">Control SaaS activo</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Las consultas siguen disponibles. Las acciones de escritura quedan bloqueadas cuando el tenant o la suscripción no están activos.
                    </p>
                  </div>
                </div>

                <div className="glass-card p-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Plan contratado</p>
                  <h3 className="mt-2 text-2xl font-bold text-slate-900">{tenantContext.plan.name}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-600">{tenantContext.plan.code}</p>
                  <p className="mt-5 text-3xl font-black text-slate-900">{formatCurrency(tenantContext.plan.price_clp)}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-600">mensual</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Sucursales', tenantContext.usage.branches, tenantContext.limits.branches],
                  ['Estacionamientos', tenantContext.usage.spaces, tenantContext.limits.spaces],
                  ['Usuarios', tenantContext.usage.users, tenantContext.limits.users],
                  ['Tickets del mes', tenantContext.usage.ticketsThisMonth, tenantContext.limits.ticketsThisMonth],
                ].map(([label, value, limit]) => (
                  <div key={String(label)} className="glass-card p-5">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{label}</p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className="text-3xl font-black text-slate-900">{Number(value).toLocaleString('es-CL')}</p>
                      <p className="pb-1 text-xs font-bold text-slate-600">/ {formatLimit(limit as number | null)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="glass-card p-6">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Estado tenant</p>
                    <p className="mt-2 text-sm font-bold text-slate-900">{tenantContext.tenant.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Estado suscripción</p>
                    <p className="mt-2 text-sm font-bold text-slate-900">{tenantContext.subscription.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Periodo vigente</p>
                    <p className="mt-2 text-sm font-bold text-slate-900">
                      {tenantContext.subscription.current_period_start || '-'} a {tenantContext.subscription.current_period_end || '-'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <SettingsEmptyState
              title="Tenant no configurado."
              description="El usuario actual no tiene un tenant SaaS activo asociado. Revisa membresías y suscripción antes de operar."
            />
          )
        )}

        {activeTab === 'hardware' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {totems.length === 0 && (
              <div className="md:col-span-2 lg:col-span-3">
                <SettingsEmptyState
                  title="Sin tótems registrados."
                  description="Cuando se configure hardware de autoservicio, aparecerá aquí su estado, última señal y modo mantenimiento."
                />
              </div>
            )}
            {totems.map(totem => (
              <div key={totem.id} className={cn(
                "glass-card p-6 space-y-6 transition-all",
                totem.maintenance_mode && "border-amber-200 bg-amber-50/30"
              )}>
                <div className="flex justify-between items-start">
                  <div className={cn(
                    "p-3 rounded-2xl",
                    totem.status === 'online' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                  )}>
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", totem.status === 'online' ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{totem.status}</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-bold">{totem.name}</h4>
                  <p className="text-xs text-slate-600">Última señal: {new Date(totem.last_heartbeat).toLocaleTimeString()}</p>
                </div>
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Modo Mantenimiento</p>
                    <p className="text-xs font-bold text-slate-900">{totem.maintenance_mode ? 'Activado' : 'Desactivado'}</p>
                  </div>
                  <button
                    onClick={() => totem.maintenance_mode ? toggleMaintenance(totem) : setConfirmModal({ totem })}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-all",
                      totem.maintenance_mode ? "bg-amber-500" : "bg-slate-200"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      totem.maintenance_mode ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'payments' && (
          <Suspense fallback={<LoadingState />}><PaymentSettingsPanel /></Suspense>
        )}

        {activeTab === 'tariffs' && (
          <Suspense fallback={<LoadingState />}><TariffsPanel /></Suspense>
        )}

        {activeTab === 'sii' && (
          <Suspense fallback={<LoadingState />}><DteSettingsPanel /></Suspense>
        )}

        {activeTab === 'integrations' && (
          <IntegrationSettingsForm config={config} onSubmit={handleUpdateConfig} isSaving={isActionLoading} />
        )}

        {activeTab === 'operations' && (
          <div className="max-w-5xl space-y-6">
            {isPlatformAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-800 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Base de datos</p>
                    <p className="font-bold text-slate-900">{health?.database?.ok ? 'Operativa' : 'Sin diagnóstico'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-4 break-all">{health?.database?.path || 'Sin ruta configurada'}</p>
                <p className="text-xs text-slate-600 mt-2">{health?.database?.migrations ?? 0} migraciones aplicadas</p>
              </div>

              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Storage local</p>
                    <p className="font-bold text-slate-900">{health?.storage?.ok ? 'Lectura y escritura OK' : 'Sin diagnóstico'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-4 break-all">{health?.storage?.path || 'Sin ruta configurada'}</p>
              </div>

              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Runtime</p>
                    <p className="font-bold text-slate-900">{health?.runtime?.nodeEnv || 'development'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-4">Seed demo: {health?.runtime?.seedDemo || 'auto'}</p>
              </div>
            </div>
            )}

            <div className={cn(
              "glass-card p-6 border-l-4",
              health?.readiness?.productionReady ? "border-l-emerald-500" : "border-l-amber-500"
            )}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-slate-600" />
                    {isPlatformAdmin ? 'Preparación para producción' : 'Preparación de la empresa'}
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {isPlatformAdmin
                      ? (health?.readiness?.productionReady ? 'Configuración técnica lista para producción.' : 'Hay advertencias de configuración antes de pasar a producción.')
                      : (health?.readiness?.productionReady ? 'Los datos de tu empresa están completos para operar.' : 'Hay datos de tu empresa por completar antes de operar formalmente.')}
                  </p>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold uppercase",
                  health?.readiness?.productionReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                )}>
                  {health?.readiness?.productionReady ? 'Listo' : 'Revisar'}
                </span>
              </div>
              {!health?.readiness?.productionReady && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
                    <p className="text-xs font-bold text-red-500 uppercase tracking-wider">Bloqueos críticos</p>
                    <p className="text-2xl font-black text-red-700 mt-1">{criticalChecks.length}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
                    <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">Advertencias</p>
                    <p className="text-2xl font-black text-amber-700 mt-1">{warningChecks.length}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(health?.readiness?.checks || []).map((check: any) => (
                  <div key={check.id} className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50">
                    <div className={cn(
                      "w-2.5 h-2.5 rounded-full mt-1.5 shrink-0",
                      check.status === 'ok' ? "bg-emerald-500" : check.status === 'critical' ? "bg-red-500" : "bg-amber-500"
                    )} />
                    <div>
                      <p className="text-sm font-bold text-slate-800">{check.label}</p>
                      <p className="text-xs text-slate-600 mt-1">{check.message}</p>
                      {check.action && check.status !== 'ok' && (
                        <p className="text-xs text-slate-700 mt-2 font-semibold">{check.action}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-slate-600" />
                    Plantillas de carga inicial
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">Archivos base para migrar plazas, clientes, abonados, tarifas, saldos, gastos y cartola.</p>
                </div>
                <span className="text-xs font-bold text-slate-600 uppercase">{importTemplates.length} plantillas</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {importTemplates.length === 0 && (
                  <div className="md:col-span-2">
                    <SettingsEmptyState
                      title="Plantillas no disponibles."
                      description="Si el servidor no entrega plantillas, actualiza el estado. Cuando estén disponibles podrás descargar CSV base para carga inicial."
                      action={
                        <button
                          type="button"
                          onClick={fetchData}
                          disabled={isActionLoading}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-50"
                        >
                          Actualizar estado
                        </button>
                      }
                    />
                  </div>
                )}
                {importTemplates.map(template => (
                  <div key={template.id} className="border border-slate-100 rounded-2xl p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900">{template.label}</p>
                      <p className="text-xs text-slate-600 mt-1">{template.description}</p>
                      <span className={cn(
                        "mt-2 inline-flex rounded-full px-2 py-1 text-xs font-bold uppercase",
                        template.importSupported ? "bg-emerald-50 text-emerald-700" : "bg-slate-50 text-slate-600"
                      )}>
                        {template.importSupported ? 'Importación disponible' : 'Plantilla referencial'}
                      </span>
                      <p className="text-xs text-slate-600 mt-2 truncate">{template.columns?.join(', ')}</p>
                    </div>
                    <div className="shrink-0 flex flex-col gap-2">
                      <button
                        onClick={() => downloadImportTemplate(template.id)}
                        className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        CSV
                      </button>
                      {template.importSupported && (
                        <label className={cn(
                          "px-3 py-2 rounded-xl border border-emerald-200 text-emerald-700 text-xs font-bold hover:bg-emerald-50 text-center cursor-pointer",
                          isActionLoading && "pointer-events-none opacity-50"
                        )}>
                          Cargar
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            disabled={isActionLoading}
                            onChange={(event) => {
                              uploadImportTemplate(template, event.target.files?.[0]);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!isPlatformAdmin && (
              <div className="glass-card p-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Database className="w-5 h-5 text-slate-600" />
                  Respaldo de base de datos
                </h3>
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Gestionado por el equipo de plataforma de Parkia.</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Los respaldos incluyen la base de datos completa del servicio, por lo que solo un administrador de plataforma puede crearlos, descargarlos o restaurarlos. Si necesitas recuperar información de tu empresa, contacta a soporte.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isPlatformAdmin && (
            <div className="glass-card p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Database className="w-5 h-5 text-slate-600" />
                    Respaldo de base de datos
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">Genera una copia SQLite consistente del estado actual del sistema.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={fetchData}
                    disabled={isActionLoading}
                    className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Actualizar estado
                  </button>
                  <button
                    onClick={createDatabaseBackup}
                    disabled={isActionLoading}
                    className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isActionLoading ? 'Creando...' : 'Crear respaldo'}
                  </button>
                </div>
              </div>

              {lastBackup && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                  <p className="text-sm font-bold text-emerald-800">{lastBackup.fileName}</p>
                  <p className="text-xs text-emerald-700 mt-1 break-all">{lastBackup.path}</p>
                  <p className="text-xs text-emerald-800 mt-1">{Math.round(lastBackup.sizeBytes / 1024)} KB · {new Date(lastBackup.createdAt).toLocaleString()}</p>
                </div>
              )}

              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm">Respaldos recientes</h4>
                  <span className="text-xs font-bold text-slate-600 uppercase">{backups.length} disponibles</span>
                </div>
                {backups.length === 0 ? (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                    <p className="text-sm font-bold text-slate-900">No hay respaldos creados todavía.</p>
                    <p className="mt-1 text-sm text-slate-600">Usa “Crear respaldo” para generar la primera copia descargable de la base de datos local.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
                    {backups.map(backup => (
                      <div key={backup.fileName} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{backup.fileName}</p>
                          <p className="text-xs text-slate-600 mt-1">{Math.round(backup.sizeBytes / 1024)} KB · {new Date(backup.createdAt).toLocaleString()}</p>
                          <p className="text-xs text-slate-600 mt-1 break-all">{backup.path}</p>
                        </div>
                        <div className="shrink-0 flex flex-wrap gap-2">
                          {String(backup.fileName).endsWith('.sqlite') && (
                            <button
                              type="button"
                              onClick={() => restoreDatabaseBackup(backup.fileName)}
                              disabled={isActionLoading}
                              className="px-3 py-2 rounded-xl border border-amber-200 text-amber-700 text-xs font-bold hover:bg-amber-50 disabled:opacity-50"
                            >
                              Restaurar
                            </button>
                          )}
                          <a
                            href={`/api/backups/database/${encodeURIComponent(backup.fileName)}`}
                            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-2"
                          >
                            <Download className="w-4 h-4" />
                            Descargar
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        )}
      </div></div></div>
  );
};

export default SettingsPage;
