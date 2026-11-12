import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { goLiveSchema } from '../../../../shared/schemas/dte';
import { formatDate, JSON_HEADERS, type DteOnboarding } from '../dteShared';

/** Paso 6: pasar a producción. Desde aquí cada cobro de ticket emite una boleta real. */
export function GoLiveStep({ onboarding, onChanged }: { onboarding: DteOnboarding; onChanged: () => void }) {
  const api = useApiMutation('dte/go-live');
  const form = useForm({
    resolver: zodResolver(goLiveSchema),
    defaultValues: { resolucion_numero: '', resolucion_fecha: '', confirm: false as unknown as true },
  });
  const { errors } = form.formState;

  if (onboarding.environment === 'produccion') {
    return (
      <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
        La empresa emite en producción desde el {formatDate(onboarding.settings.live_since)} (resolución N° {onboarding.settings.resolucion_numero} del {formatDate(onboarding.settings.resolucion_fecha)}).
        {onboarding.settings.auto_emit_boleta ? ' Cada ticket cobrado genera su boleta.' : ' La emisión automática está desactivada.'}
      </p>
    );
  }

  const missing = [
    !onboarding.certification.accepted && 'el SII debe aceptar al menos una boleta de prueba',
    !onboarding.cafs.some(caf => caf.dte_type === 39 && caf.environment === 'produccion') && 'carga un CAF de boletas de producción',
    !onboarding.productionAllowed && 'la producción no está habilitada en este servidor (contacta al administrador de la plataforma)',
  ].filter(Boolean) as string[];

  return (
    <form
      noValidate
      aria-label="Pasar a producción"
      className="space-y-4"
      onSubmit={form.handleSubmit(async values => {
        try {
          await api.json('/api/dte/go-live', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(values) });
          onChanged();
        } catch { /* se muestra abajo */ }
      })}
    >
      <p className="text-sm text-slate-600">
        Hazlo solo cuando el SII ya te haya autorizado como emisor de boletas. A partir de este momento los documentos son reales y tienen validez tributaria.
      </p>
      {missing.length > 0 && (
        <ul role="status" className="list-disc space-y-1 rounded-xl bg-amber-50 p-4 pl-8 text-sm text-amber-900">
          {missing.map(item => <li key={item}>Falta: {item}</li>)}
        </ul>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Número de resolución del SII" htmlFor="dte-live-numero" required error={errors.resolucion_numero?.message as string | undefined}>
          <Input id="dte-live-numero" type="number" min="1" invalid={Boolean(errors.resolucion_numero)} {...form.register('resolucion_numero')} />
        </Field>
        <Field label="Fecha de la resolución" htmlFor="dte-live-fecha" required error={errors.resolucion_fecha?.message}>
          <Input id="dte-live-fecha" type="date" invalid={Boolean(errors.resolucion_fecha)} {...form.register('resolucion_fecha')} />
        </Field>
      </div>
      <div>
        <label className="flex min-h-11 items-start gap-3 text-sm font-semibold text-slate-800">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-slate-900" aria-invalid={errors.confirm ? true : undefined} {...form.register('confirm')} />
          Confirmo que completé el proceso de certificación con el SII y que los datos de la resolución son correctos.
        </label>
        {errors.confirm && <p role="alert" className="mt-1 text-xs font-medium text-red-800">{errors.confirm.message as string}</p>}
      </div>
      {api.error && <p role="alert" className="text-sm font-semibold text-red-800">{api.error.message}</p>}
      <Button type="submit" loading={form.formState.isSubmitting} disabled={missing.length > 0}>Pasar a producción</Button>
    </form>
  );
}
