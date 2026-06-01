import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Banknote, Cpu, Database, Download, Eye, EyeOff, FileSpreadsheet, Globe, HardDrive, Lock, RefreshCw, Settings, ShieldCheck, Warehouse } from 'lucide-react';
import { SystemConfig, Totem } from '../types';
import Toast from '../components/ui/Toast';
import { cn } from '../lib/utils';

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
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
      <Settings className="h-6 w-6" />
    </div>
    <p className="text-sm font-bold text-slate-900">{title}</p>
    <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{description}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>
);

const settingsTabs = [
  { id: 'general', label: 'General y Financiera', icon: Settings },
  { id: 'subscription', label: 'SaaS y Suscripción', icon: Banknote },
  { id: 'hardware', label: 'Hardware y Tótems', icon: Cpu },
  { id: 'integrations', label: 'Integraciones (APIs)', icon: Globe },
  { id: 'operations', label: 'Operación', icon: ShieldCheck }
] as const;

const isSettingsTab = (value: string | null): value is typeof settingsTabs[number]['id'] =>
  Boolean(value && settingsTabs.some(tab => tab.id === value));

const formatCurrency = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const formatLimit = (value: number | null | undefined) => value == null ? 'Sin límite' : Number(value).toLocaleString('es-CL');

const SettingsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => isSettingsTab(searchParams.get('tab')) ? searchParams.get('tab')! : 'general');
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [totems, setTotems] = useState<Totem[]>([]);
  const [health, setHealth] = useState<any | null>(null);
  const [lastBackup, setLastBackup] = useState<any | null>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [importTemplates, setImportTemplates] = useState<any[]>([]);
  const [tenantContext, setTenantContext] = useState<any | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ totem: Totem } | null>(null);
  const readinessChecks = health?.readiness?.checks || [];
  const criticalChecks = readinessChecks.filter((check: any) => check.status === 'critical');
  const warningChecks = readinessChecks.filter((check: any) => check.status === 'warning');

  const fetchData = async () => {
    const [cRes, tRes, hRes, bRes, iRes, tenantRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/totems'),
      fetch('/api/health/details'),
      fetch('/api/backups/database'),
      fetch('/api/import/templates'),
      fetch('/api/tenant/context')
    ]);
    setConfig(await cRes.json());
    setTotems(await tRes.json());
    if (hRes.ok) setHealth(await hRes.json());
    if (bRes.ok) {
      const backupBody = await bRes.json();
      setBackups(backupBody.backups || []);
    }
    if (iRes.ok) {
      const importBody = await iRes.json();
      setImportTemplates(importBody.templates || []);
    }
    if (tenantRes.ok) setTenantContext(await tenantRes.json());
  };

  useEffect(() => {
    fetchData();
  }, []);

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

  const handleUpdateConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Configuración actualizada', type: 'success' });
      fetchData();
    }
    setIsActionLoading(false);
  };

  const toggleMaintenance = async (totem: Totem) => {
    const res = await fetch(`/api/totems/${totem.id}`, {
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
    const res = await fetch('/api/backups/database', { method: 'POST' });
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

  if (!config) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      {confirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} role="dialog" aria-modal="true" aria-labelledby="maintenance-dialog-title" className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6">
            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <div className="text-center">
              <h3 id="maintenance-dialog-title" className="text-xl font-bold">¿Activar Modo Mantenimiento?</h3>
              <p className="text-slate-500 mt-2">
                ¿Está seguro de poner el <strong>{confirmModal.totem.name}</strong> en mantenimiento? Los clientes no podrán usar el auto-servicio.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-900 rounded-xl font-bold hover:bg-slate-200 transition-all">Cancelar</button>
              <button onClick={() => toggleMaintenance(confirmModal.totem)} className="flex-1 py-3 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 transition-all">Sí, Activar</button>
            </div>
          </motion.div>
        </div>
      )}

      <div>
        <h2 className="text-3xl font-bold tracking-tight">Configuración del Sistema</h2>
        <p className="text-slate-500 mt-1">Panel de control maestro para parámetros, hardware e integraciones.</p>
      </div>

      <div className="flex border-b border-slate-200 gap-6 md:gap-8 overflow-x-auto" role="tablist" aria-label="Configuración del sistema">
        {settingsTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
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
              <motion.div layoutId="settingsTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
            )}
          </button>
        ))}
      </div>

      <div className="min-h-[500px]">
        {activeTab === 'general' && (
          <form onSubmit={handleUpdateConfig} className="max-w-4xl space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Lock className="w-5 h-5 text-slate-400" /> Reglas de Cobranza
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Días de gracia antes de mora</label>
                    <input type="number" name="grace_days" defaultValue={config.grace_days} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Interés por mora (%)</label>
                    <input type="number" step="0.1" name="late_interest" defaultValue={config.late_interest} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Recuperación estimada de mora (%)</label>
                    <input type="number" min="0" max="100" step="1" name="overdue_recovery_rate" defaultValue={config.overdue_recovery_rate ?? 60} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Warehouse className="w-5 h-5 text-slate-400" /> Información de la Empresa
                </h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Razón Social</label>
                    <input type="text" name="company_name" defaultValue={config.company_name} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT Empresa</label>
                    <input type="text" name="company_rut" defaultValue={config.company_rut} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Dirección Comercial</label>
                    <input type="text" name="company_address" defaultValue={config.company_address} className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-slate-900 outline-none transition-all" />
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" disabled={isActionLoading} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Guardar Cambios Globales
            </button>
          </form>
        )}

        {activeTab === 'subscription' && (
          tenantContext ? (
            <div className="max-w-6xl space-y-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="glass-card p-6 lg:col-span-2">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Tenant actual</p>
                      <h3 className="mt-2 text-2xl font-bold text-slate-900">{tenantContext.tenant.name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{tenantContext.tenant.rut || 'RUT no configurado'} · Rol {tenantContext.membership.role}</p>
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
                    <p className="mt-1 text-sm text-slate-500">
                      Las consultas siguen disponibles. Las acciones de escritura quedan bloqueadas cuando el tenant o la suscripción no están activos.
                    </p>
                  </div>
                </div>

                <div className="glass-card p-6">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Plan contratado</p>
                  <h3 className="mt-2 text-2xl font-bold text-slate-900">{tenantContext.plan.name}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">{tenantContext.plan.code}</p>
                  <p className="mt-5 text-3xl font-black text-slate-900">{formatCurrency(tenantContext.plan.price_clp)}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">mensual</p>
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
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className="text-3xl font-black text-slate-900">{Number(value).toLocaleString('es-CL')}</p>
                      <p className="pb-1 text-xs font-bold text-slate-500">/ {formatLimit(limit as number | null)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="glass-card p-6">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estado tenant</p>
                    <p className="mt-2 text-sm font-bold text-slate-900">{tenantContext.tenant.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estado suscripción</p>
                    <p className="mt-2 text-sm font-bold text-slate-900">{tenantContext.subscription.status}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Periodo vigente</p>
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
                    totem.status === 'online' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                  )}>
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("w-2 h-2 rounded-full", totem.status === 'online' ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{totem.status}</span>
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-bold">{totem.name}</h4>
                  <p className="text-xs text-slate-500">Última señal: {new Date(totem.last_heartbeat).toLocaleTimeString()}</p>
                </div>
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Modo Mantenimiento</p>
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

        {activeTab === 'integrations' && (
          <form onSubmit={handleUpdateConfig} className="max-w-2xl space-y-8">
            <div className="space-y-6">
              <div className="glass-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold">Servicio de Impuestos Internos (SII)</h4>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Integración desacoplada por proveedor</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Usa el mock local solo para demo/piloto. El modo real queda bloqueado hasta implementar y certificar un proveedor SII externo.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Modo emisión</label>
                    <select name="sii_mode" defaultValue={config.sii_mode || 'mock'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:bg-white focus:border-slate-900 outline-none transition-all">
                      <option value="mock">Mock local</option>
                      <option value="disabled">Deshabilitado</option>
                      <option value="real">Proveedor real (bloqueado)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Proveedor</label>
                    <select name="sii_provider" defaultValue={config.sii_provider || 'local_mock'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:bg-white focus:border-slate-900 outline-none transition-all">
                      <option value="local_mock">Local mock</option>
                      <option value="external_provider">Proveedor externo (pendiente)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Ambiente</label>
                    <select name="sii_environment" defaultValue={config.sii_environment || 'demo'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:bg-white focus:border-slate-900 outline-none transition-all">
                      <option value="demo">Demo</option>
                      <option value="production">Producción</option>
                    </select>
                  </div>
                </div>
                <div className="relative">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">API Token / Credenciales SII</label>
                  <div className="relative">
                    <input
                      type={showSecrets['sii'] ? 'text' : 'password'}
                      name="sii_api_key"
                      defaultValue={config.sii_api_key}
                      placeholder="Pendiente de proveedor SII"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:bg-white focus:border-slate-900 outline-none transition-all pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets({ ...showSecrets, sii: !showSecrets['sii'] })}
                      aria-label={showSecrets['sii'] ? 'Ocultar credenciales SII' : 'Mostrar credenciales SII'}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                    >
                      {showSecrets['sii'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="glass-card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                    <Banknote className="w-5 h-5" />
                  </div>
                  <h4 className="font-bold">Conciliación Bancaria (CGVC)</h4>
                </div>
                <div className="relative">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">API Token / Credenciales bancarias</label>
                  <div className="relative">
                    <input
                      type={showSecrets['bank'] ? 'text' : 'password'}
                      name="bank_api_key"
                      defaultValue={config.bank_api_key}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:bg-white focus:border-slate-900 outline-none transition-all pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets({ ...showSecrets, bank: !showSecrets['bank'] })}
                      aria-label={showSecrets['bank'] ? 'Ocultar credenciales bancarias' : 'Mostrar credenciales bancarias'}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900"
                    >
                      {showSecrets['bank'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" disabled={isActionLoading} className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
              Actualizar Credenciales
            </button>
          </form>
        )}

        {activeTab === 'operations' && (
          <div className="max-w-5xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Base de datos</p>
                    <p className="font-bold text-slate-900">{health?.database?.ok ? 'Operativa' : 'Sin diagnóstico'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-4 break-all">{health?.database?.path || 'Sin ruta configurada'}</p>
                <p className="text-xs text-slate-400 mt-2">{health?.database?.migrations ?? 0} migraciones aplicadas</p>
              </div>

              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Storage local</p>
                    <p className="font-bold text-slate-900">{health?.storage?.ok ? 'Lectura y escritura OK' : 'Sin diagnóstico'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-4 break-all">{health?.storage?.path || 'Sin ruta configurada'}</p>
              </div>

              <div className="glass-card p-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 text-slate-700 rounded-xl">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Runtime</p>
                    <p className="font-bold text-slate-900">{health?.runtime?.nodeEnv || 'development'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-4">Seed demo: {health?.runtime?.seedDemo || 'auto'}</p>
              </div>
            </div>

            <div className={cn(
              "glass-card p-6 border-l-4",
              health?.readiness?.productionReady ? "border-l-emerald-500" : "border-l-amber-500"
            )}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-slate-400" />
                    Preparación para producción
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    {health?.readiness?.productionReady ? 'Configuración técnica lista para producción.' : 'Hay advertencias de configuración antes de pasar a producción.'}
                  </p>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                  health?.readiness?.productionReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                )}>
                  {health?.readiness?.productionReady ? 'Listo' : 'Revisar'}
                </span>
              </div>
              {!health?.readiness?.productionReady && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  <div className="rounded-2xl bg-red-50 border border-red-100 p-4">
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Bloqueos críticos</p>
                    <p className="text-2xl font-black text-red-700 mt-1">{criticalChecks.length}</p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Advertencias</p>
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
                      <p className="text-xs text-slate-500 mt-1">{check.message}</p>
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
                    <FileSpreadsheet className="w-5 h-5 text-slate-400" />
                    Plantillas de carga inicial
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">Archivos base para migrar clientes, contratos, saldos, gastos y cartola.</p>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">{importTemplates.length} plantillas</span>
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
                      <p className="text-xs text-slate-500 mt-1">{template.description}</p>
                      <p className="text-[10px] text-slate-400 mt-2 truncate">{template.columns?.join(', ')}</p>
                    </div>
                    <button
                      onClick={() => downloadImportTemplate(template.id)}
                      className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      CSV
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Database className="w-5 h-5 text-slate-400" />
                    Respaldo de base de datos
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">Genera una copia SQLite consistente del estado actual del sistema.</p>
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
                  <p className="text-xs text-emerald-600 mt-1">{Math.round(lastBackup.sizeBytes / 1024)} KB · {new Date(lastBackup.createdAt).toLocaleString()}</p>
                </div>
              )}

              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm">Respaldos recientes</h4>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">{backups.length} disponibles</span>
                </div>
                {backups.length === 0 ? (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
                    <p className="text-sm font-bold text-slate-900">No hay respaldos creados todavía.</p>
                    <p className="mt-1 text-sm text-slate-500">Usa “Crear respaldo” para generar la primera copia descargable de la base de datos local.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden">
                    {backups.map(backup => (
                      <div key={backup.fileName} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{backup.fileName}</p>
                          <p className="text-xs text-slate-500 mt-1">{Math.round(backup.sizeBytes / 1024)} KB · {new Date(backup.createdAt).toLocaleString()}</p>
                          <p className="text-[10px] text-slate-400 mt-1 break-all">{backup.path}</p>
                        </div>
                        <a
                          href={`/api/backups/database/${encodeURIComponent(backup.fileName)}`}
                          className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 inline-flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          Descargar
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


export default SettingsPage;

