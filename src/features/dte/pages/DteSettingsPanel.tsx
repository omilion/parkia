import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { Badge, LoadingState } from '../../../ui';
import { cn } from '../../../lib/utils';
import { CafStep } from '../components/CafStep';
import { CertificateStep } from '../components/CertificateStep';
import { CertificationStep } from '../components/CertificationStep';
import { ConnectionStep } from '../components/ConnectionStep';
import { DteDocuments } from '../components/DteDocuments';
import { GoLiveStep } from '../components/GoLiveStep';
import { IssuerStep } from '../components/IssuerStep';
import { dteOnboardingQueryKey, fetchDteOnboarding, type DteOnboarding, type DteStepKey } from '../dteShared';

const STEP_META: Record<DteStepKey, { title: string; summary: (onboarding: DteOnboarding) => string }> = {
  emisor: { title: 'Datos de la empresa emisora', summary: o => o.settings.razon_social || 'Pendiente' },
  certificate: { title: 'Certificado digital', summary: o => o.certificate ? `${o.certificate.subjectName || 'Cargado'} · vence en ${o.certificate.daysLeft} días` : 'Pendiente' },
  connection: { title: 'Prueba de conexión con el SII', summary: o => o.connection.ok ? 'El SII autenticó el certificado' : o.connection.ok === false ? 'La última prueba falló' : 'Pendiente' },
  caf: { title: 'Folios autorizados (CAF)', summary: o => { const total = o.cafs.filter(c => c.dte_type === 39 && c.environment === o.environment).reduce((sum, c) => sum + c.remaining, 0); return total ? `${total} folios de boleta disponibles` : 'Pendiente'; } },
  test_document: { title: 'Set de pruebas de certificación', summary: o => o.certification.accepted ? `${o.certification.accepted} documentos aceptados por el SII` : o.certification.sent ? 'Esperando respuesta del SII' : 'Pendiente' },
  production: { title: 'Pasar a producción', summary: o => o.environment === 'produccion' ? 'Emitiendo documentos reales' : 'Pendiente' },
};

/** Asistente de facturación electrónica: seis pasos desde el RUT de la empresa hasta emitir en producción. */
export default function DteSettingsPanel() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: dteOnboardingQueryKey, queryFn: ({ signal }) => fetchDteOnboarding(signal) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['dte'] }); };
  const onboarding = query.data;
  const [open, setOpen] = useState<DteStepKey | null>(null);
  const firstPending = onboarding?.steps.find(step => !step.done)?.key ?? null;

  // La primera vez se abre el primer paso pendiente.
  useEffect(() => {
    if (onboarding && open === null) setOpen(firstPending);
  }, [onboarding, open, firstPending]);

  if (query.isPending) return <LoadingState label="Cargando facturación electrónica" />;
  if (query.error || !onboarding) return <p role="alert" className="text-sm font-semibold text-red-800">{query.error?.message || 'No se pudo cargar la facturación electrónica'}</p>;

  const done = onboarding.steps.filter(step => step.done).length;
  const content: Record<DteStepKey, ReactNode> = {
    emisor: <IssuerStep onboarding={onboarding} onSaved={refresh} />,
    certificate: <CertificateStep onboarding={onboarding} onChanged={refresh} />,
    connection: <ConnectionStep onboarding={onboarding} onChanged={refresh} />,
    caf: <CafStep onboarding={onboarding} onChanged={refresh} />,
    test_document: <CertificationStep onboarding={onboarding} onChanged={refresh} />,
    production: <GoLiveStep onboarding={onboarding} onChanged={refresh} />,
  };

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Facturación electrónica (SII)</h2>
          <p className="mt-1 text-sm text-slate-600">Cada empresa usa su propio certificado y sus propios folios.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={onboarding.environment === 'produccion' ? 'success' : 'warning'}>
            {onboarding.environment === 'produccion' ? 'Producción' : 'Ambiente de certificación'}
          </Badge>
          <span className="text-sm font-semibold text-slate-700" aria-live="polite">{done} de {onboarding.steps.length} pasos</span>
        </div>
      </header>

      <div role="progressbar" aria-label="Avance de la configuración" aria-valuemin={0} aria-valuemax={onboarding.steps.length} aria-valuenow={done} className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${(done / onboarding.steps.length) * 100}%` }} />
      </div>

      {onboarding.alerts.length > 0 && (
        <ul aria-label="Alertas de facturación" className="space-y-2">
          {onboarding.alerts.map(alert => (
            <li key={alert.code} className={cn('flex items-start gap-2 rounded-xl p-3 text-sm font-semibold', alert.level === 'error' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900')}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {alert.message}
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-3">
        {onboarding.steps.map((step, index) => {
          const meta = STEP_META[step.key];
          const isOpen = open === step.key;
          const panelId = `dte-step-${step.key}`;
          return (
            <li key={step.key} className="rounded-2xl border border-slate-200 bg-white">
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : step.key)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left"
                >
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold', step.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700')}>
                    {step.done ? <Check className="h-4 w-4" aria-label="Paso completado" /> : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900">{meta.title}</span>
                    <span className="block truncate text-sm text-slate-600">{meta.summary(onboarding)}</span>
                  </span>
                  <ChevronDown className={cn('h-5 w-5 shrink-0 text-slate-500 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                </button>
              </h3>
              {isOpen && <div id={panelId} role="region" aria-label={meta.title} className="border-t border-slate-100 p-4 sm:p-5">{content[step.key]}</div>}
            </li>
          );
        })}
      </ol>

      <DteDocuments />
    </div>
  );
}
