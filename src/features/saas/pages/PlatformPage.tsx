import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Building2, Eye, Ban, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { FieldError } from '../../../ui/FieldError';
import { LoadingState } from '../../../ui';

type PlatformTenantItem = {
  id: number;
  name: string;
  rut: string | null;
  status: 'active' | 'suspended' | 'archived';
  created_at: string | null;
  plan: {
    code: string;
    name: string;
    max_branches: number | null;
    max_spaces: number | null;
    max_users: number | null;
    monthly_ticket_limit: number | null;
  };
  subscription: {
    id: number | null;
    status: string;
    current_period_end: string | null;
    grace_until: string | null;
    suspended_at: string | null;
  };
  sii: {
    environment: string;
    certification_status: string;
  };
  usage: {
    branches: number;
    spaces: number;
    users: number;
    ticketsThisMonth: number;
  };
};

const impersonateReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Indica el motivo de soporte (mínimo 5 caracteres)').max(300),
  minutes: z.coerce.number().int().min(5).max(120),
});

type ImpersonateReasonValues = z.output<typeof impersonateReasonSchema>;

function formatUsage(used: number, max: number | null) {
  return max === null ? `${used} / ∞` : `${used} / ${max}`;
}

export default function PlatformPage({ onRefreshAuth }: { onRefreshAuth?: () => Promise<void> | void }) {
  const queryClient = useQueryClient();
  const apiWrite = useApiMutation('PlatformPage.tsx');
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tenantsQuery = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: ({ signal }) => apiFetchJson<{ tenants: PlatformTenantItem[] }>('/api/platform/tenants', { signal }),
  });

  const form = useForm<ImpersonateReasonValues>({
    resolver: zodResolver(impersonateReasonSchema) as any,
    defaultValues: { reason: '', minutes: 30 },
  });

  const handleToggleStatus = async (tenant: PlatformTenantItem) => {
    setActionError(null);
    const nextStatus = tenant.status === 'suspended' ? 'active' : 'suspended';
    const res = await apiWrite.request(`/api/platform/tenants/${tenant.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error || 'No se pudo actualizar el estado de la empresa');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
  };

  const onSubmitImpersonate = form.handleSubmit(async (values) => {
    if (!selectedTenant) return;
    setActionError(null);
    const res = await apiWrite.request('/api/platform/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: selectedTenant.id,
        reason: values.reason,
        minutes: values.minutes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setActionError(data.error || 'No se pudo iniciar la suplantación');
      return;
    }
    setSelectedTenant(null);
    form.reset();
    await queryClient.invalidateQueries();
    if (onRefreshAuth) await onRefreshAuth();
    window.location.href = '/';
  });

  if (tenantsQuery.isPending) return <LoadingState label="Cargando panel de plataforma" />;

  if (tenantsQuery.error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
          <div className="flex items-center gap-2 font-bold">
            <ShieldAlert className="h-5 w-5" />
            <span>Acceso restringido o error al cargar plataforma</span>
          </div>
          <p className="mt-2 text-sm">{tenantsQuery.error.message}</p>
        </div>
      </div>
    );
  }

  const tenants = tenantsQuery.data?.tenants || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Plataforma Parkia</h1>
          <p className="text-sm text-slate-600">
            Administración de empresas, consumo por plan, estado SII y soporte auditado.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800">
          <Building2 className="h-4 w-4" />
          {tenants.length} empresa(s)
        </span>
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900">
          {actionError}
        </div>
      )}

      <div className="space-y-4">
        {tenants.map((tenant) => (
          <div
            key={tenant.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
          >
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{tenant.name}</h2>
                {tenant.rut && <span className="text-xs font-mono text-slate-600">{tenant.rut}</span>}
                <span
                  className={
                    tenant.status === 'suspended'
                      ? 'rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-800'
                      : 'rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800'
                  }
                >
                  {tenant.status === 'suspended' ? 'Suspendida' : 'Activa'}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  Plan {tenant.plan.name} · Suscripción: {tenant.subscription.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                <span>Sucursales: <strong>{formatUsage(tenant.usage.branches, tenant.plan.max_branches)}</strong></span>
                <span>Plazas: <strong>{formatUsage(tenant.usage.spaces, tenant.plan.max_spaces)}</strong></span>
                <span>Usuarios: <strong>{formatUsage(tenant.usage.users, tenant.plan.max_users)}</strong></span>
                <span>Tickets mes: <strong>{formatUsage(tenant.usage.ticketsThisMonth, tenant.plan.monthly_ticket_limit)}</strong></span>
                <span>SII: <strong>{tenant.sii.environment} ({tenant.sii.certification_status})</strong></span>
                {tenant.subscription.current_period_end && (
                  <span>Período hasta: <strong>{tenant.subscription.current_period_end}</strong></span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setSelectedTenant(tenant);
                }}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
              >
                <Eye className="h-4 w-4" />
                Entrar como soporte
              </button>
              <button
                type="button"
                disabled={apiWrite.isPending}
                onClick={() => void handleToggleStatus(tenant)}
                className="min-h-11 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {tenant.status === 'suspended' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    Reactivar
                  </>
                ) : (
                  <>
                    <Ban className="h-4 w-4 text-red-700" />
                    Suspender
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedTenant && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="impersonate-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 id="impersonate-modal-title" className="text-lg font-bold text-slate-900">
              Entrar como soporte a {selectedTenant.name}
            </h2>
            <p className="text-xs text-slate-600">
              Esta acción queda registrada en el historial de auditoría de la empresa y tiene tiempo límite.
            </p>
            <form onSubmit={onSubmitImpersonate} className="space-y-4">
              <div>
                <label htmlFor="imp-reason" className="block text-xs font-bold text-slate-700 mb-1">
                  Motivo de soporte
                </label>
                <textarea
                  id="imp-reason"
                  rows={3}
                  {...form.register('reason')}
                  placeholder="Ej: Revisión de emisión de boletas SII solicitada por ticket #412"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
                <FieldError error={form.formState.errors.reason} />
              </div>
              <div>
                <label htmlFor="imp-minutes" className="block text-xs font-bold text-slate-700 mb-1">
                  Duración máxima (minutos)
                </label>
                <input
                  id="imp-minutes"
                  type="number"
                  min={5}
                  max={120}
                  {...form.register('minutes')}
                  className="w-full min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
                <FieldError error={form.formState.errors.minutes} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTenant(null);
                    form.reset();
                  }}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={apiWrite.isPending}
                  className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Iniciar suplantación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

