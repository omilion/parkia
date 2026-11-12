import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input, RutInput } from '../../../ui';
import { useApiMutation } from '../../../lib/useApiMutation';
import { dteSettingsFormSchema } from '../../../../shared/schemas/dte';
import { JSON_HEADERS, type DteOnboarding } from '../dteShared';

/** Paso 1: datos de la empresa emisora tal como figuran en el SII. */
export function IssuerStep({ onboarding, onSaved }: { onboarding: DteOnboarding; onSaved: () => void }) {
  const api = useApiMutation('dte/settings');
  const s = onboarding.settings;
  const form = useForm({
    resolver: zodResolver(dteSettingsFormSchema),
    defaultValues: {
      rut_emisor: s.rut_emisor || '', razon_social: s.razon_social || '', giro: s.giro || '', acteco: s.acteco.join(', '),
      direccion: s.direccion || '', comuna: s.comuna || '', ciudad: s.ciudad || '', sii_unidad: s.sii_unidad || '',
      codigo_sucursal_sii: s.codigo_sucursal_sii ? String(s.codigo_sucursal_sii) : '', rut_envia: s.rut_envia || '',
      auto_emit_boleta: s.auto_emit_boleta,
    },
  });
  const { errors } = form.formState;
  const locked = onboarding.environment === 'produccion';
  return (
    <form
      noValidate
      aria-label="Datos del emisor"
      className="space-y-4"
      onSubmit={form.handleSubmit(async values => {
        try {
          await api.json('/api/dte/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(values) });
          onSaved();
        } catch { /* el error se muestra bajo el formulario */ }
      })}
    >
      <p className="text-sm text-slate-600">Ingresa los datos exactamente como están inscritos en el SII. Se imprimen en cada boleta y factura.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="RUT de la empresa" htmlFor="dte-rut" required error={errors.rut_emisor?.message}>
          <RutInput id="dte-rut" disabled={locked} invalid={Boolean(errors.rut_emisor)} {...form.register('rut_emisor')} />
        </Field>
        <Field label="Razón social" htmlFor="dte-razon" required error={errors.razon_social?.message}>
          <Input id="dte-razon" invalid={Boolean(errors.razon_social)} {...form.register('razon_social')} />
        </Field>
        <Field label="Giro" htmlFor="dte-giro" required error={errors.giro?.message}>
          <Input id="dte-giro" invalid={Boolean(errors.giro)} {...form.register('giro')} />
        </Field>
        <Field label="Códigos de actividad económica" htmlFor="dte-acteco" required hint="Hasta 4, separados por coma. Ej: 522130, 523010" error={errors.acteco?.message as string | undefined}>
          <Input id="dte-acteco" inputMode="numeric" invalid={Boolean(errors.acteco)} {...form.register('acteco')} />
        </Field>
        <Field label="Dirección" htmlFor="dte-direccion" required error={errors.direccion?.message}>
          <Input id="dte-direccion" invalid={Boolean(errors.direccion)} {...form.register('direccion')} />
        </Field>
        <Field label="Comuna" htmlFor="dte-comuna" required error={errors.comuna?.message}>
          <Input id="dte-comuna" invalid={Boolean(errors.comuna)} {...form.register('comuna')} />
        </Field>
        <Field label="Ciudad" htmlFor="dte-ciudad">
          <Input id="dte-ciudad" {...form.register('ciudad')} />
        </Field>
        <Field label="Unidad del SII" htmlFor="dte-unidad" required hint="Aparece en la boleta como “S.I.I. - SANTIAGO CENTRO”" error={errors.sii_unidad?.message}>
          <Input id="dte-unidad" invalid={Boolean(errors.sii_unidad)} {...form.register('sii_unidad')} />
        </Field>
        <Field label="Código de sucursal SII (opcional)" htmlFor="dte-sucursal" error={errors.codigo_sucursal_sii?.message as string | undefined}>
          <Input id="dte-sucursal" inputMode="numeric" {...form.register('codigo_sucursal_sii')} />
        </Field>
        <Field label="RUT de quien envía (opcional)" htmlFor="dte-envia" hint="Solo si el certificado no trae el RUT del titular" error={errors.rut_envia?.message as string | undefined}>
          <RutInput id="dte-envia" invalid={Boolean(errors.rut_envia)} {...form.register('rut_envia')} />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-slate-900" {...form.register('auto_emit_boleta')} />
        Emitir boleta automáticamente al cobrar un ticket (solo en producción)
      </label>
      {api.error && <p role="alert" className="text-sm font-semibold text-red-800">{api.error.message}</p>}
      <Button type="submit" loading={form.formState.isSubmitting}>Guardar datos del emisor</Button>
    </form>
  );
}
