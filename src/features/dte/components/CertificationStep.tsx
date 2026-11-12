import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { certificationEnvironmentSchema, certificationSetSchema } from '../../../../shared/schemas/dte';
import { JSON_HEADERS, type DteOnboarding } from '../dteShared';

/**
 * Paso 5: set de pruebas en el ambiente de certificación. Genera boletas de prueba con la referencia SET,
 * las envía a Maullín y espera la respuesta del SII. No son ventas reales.
 */
export function CertificationStep({ onboarding, onChanged }: { onboarding: DteOnboarding; onChanged: () => void }) {
  const envApi = useApiMutation('dte/certification-environment');
  const setApi = useApiMutation('dte/certification-set');
  const sendApi = useApiMutation('dte/send-now');
  const [casesText, setCasesText] = useState('');
  const [casesError, setCasesError] = useState('');
  const [notice, setNotice] = useState('');
  const form = useForm({
    resolver: zodResolver(certificationEnvironmentSchema),
    defaultValues: { resolucion_fecha: onboarding.settings.resolucion_fecha || '', resolucion_numero: onboarding.settings.resolucion_numero ?? 0 },
  });
  const { errors } = form.formState;
  const ready = Boolean(onboarding.settings.resolucion_fecha && onboarding.certificate && onboarding.cafs.some(caf => caf.dte_type === 39 && caf.environment === 'certificacion'));
  const { sent, accepted } = onboarding.certification;

  return (
    <div className="space-y-5">
      <form
        noValidate
        aria-label="Fecha de autorización de pruebas"
        className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
        onSubmit={form.handleSubmit(async values => {
          try {
            await envApi.json('/api/dte/certification-environment', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(values) });
            onChanged();
          } catch { /* se muestra abajo */ }
        })}
      >
        <Field label="Fecha de resolución de pruebas" htmlFor="dte-res-fecha" required hint="La que muestra el portal del SII para tu proceso de certificación" error={errors.resolucion_fecha?.message}>
          <Input id="dte-res-fecha" type="date" invalid={Boolean(errors.resolucion_fecha)} {...form.register('resolucion_fecha')} />
        </Field>
        <Field label="Número de resolución" htmlFor="dte-res-numero" hint="En certificación es 0" error={errors.resolucion_numero?.message as string | undefined}>
          <Input id="dte-res-numero" type="number" min="0" {...form.register('resolucion_numero')} />
        </Field>
        <Button type="submit" variant="secondary" loading={form.formState.isSubmitting}>Guardar</Button>
      </form>
      {envApi.error && <p role="alert" className="text-sm font-semibold text-red-800">{envApi.error.message}</p>}

      <details className="rounded-xl border border-slate-200 p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-slate-800">Usar los casos del set oficial del SII (opcional)</summary>
        <div className="mt-3 space-y-2">
          <p className="text-sm text-slate-600">
            Si no pegas nada se usan casos de ejemplo. Para el set oficial, escribe los casos en este formato:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{`{"cases":[{"id":"4400-1","items":[{"nombre":"Cambio de aceite","cantidad":1,"precio":19900}]}]}`}</pre>
          <label htmlFor="dte-cases" className="block text-xs font-semibold text-slate-700">Casos (JSON)</label>
          <textarea id="dte-cases" rows={5} value={casesText} onChange={event => { setCasesText(event.target.value); setCasesError(''); }} aria-invalid={casesError ? true : undefined} className="w-full rounded-xl border border-slate-300 p-3 font-mono text-base md:text-xs" />
          {casesError && <p role="alert" className="text-xs font-semibold text-red-800">{casesError}</p>}
        </div>
      </details>

      {!ready && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Antes de generar el set: guarda la fecha de resolución, carga el certificado y un CAF de boletas de certificación.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready}
          loading={setApi.isPending}
          onClick={async () => {
            let body: unknown = {};
            if (casesText.trim()) {
              try {
                body = JSON.parse(casesText);
              } catch { setCasesError('El texto no es JSON válido'); return; }
              const parsed = certificationSetSchema.safeParse(body);
              if (!parsed.success) { setCasesError(parsed.error.issues[0]?.message || 'Los casos no son válidos'); return; }
            }
            try {
              const result = await setApi.json<{ generated: number }>('/api/dte/certification-set', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
              setNotice(`${result.generated} documentos de prueba generados y enviados. El SII los procesa en unos minutos.`);
              onChanged();
            } catch { /* se muestra abajo */ }
          }}
        >
          Generar y enviar set de pruebas
        </Button>
        <Button
          variant="secondary"
          loading={sendApi.isPending}
          disabled={!ready}
          onClick={async () => {
            try { await sendApi.json('/api/dte/send-now', { method: 'POST' }); setNotice('Consulta realizada.'); onChanged(); } catch { /* se muestra abajo */ }
          }}
        >
          Consultar respuesta del SII
        </Button>
      </div>
      {(setApi.error || sendApi.error) && <p role="alert" className="text-sm font-semibold text-red-800">{(setApi.error || sendApi.error)?.message}</p>}
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      <p className="text-sm text-slate-700" aria-live="polite">
        Documentos de prueba: <strong>{sent}</strong> enviados, <strong>{accepted}</strong> aceptados por el SII.
      </p>
    </div>
  );
}
