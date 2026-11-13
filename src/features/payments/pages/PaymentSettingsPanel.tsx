import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { paymentSettingsSchema } from '../../../../shared/schemas/gateways';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Badge, Button, Field, Input, LoadingState, Select } from '../../../ui';

type ProviderSettings = {
  provider: 'webpay' | 'mock'; label: string; enabled: boolean; environment: 'integration' | 'production';
  commerce_code: string; has_secret: boolean; uses_integration_credentials: boolean; exit_window_mins: number;
};
type SettingsResponse = { providers: ProviderSettings[]; mock_allowed: boolean; exit_window_mins: number };

function ProviderForm({ settings, onSaved }: { settings: ProviderSettings; onSaved: () => void }) {
  const apiWrite = useApiMutation('features/payments/pages/PaymentSettingsPanel');
  const form = useForm<z.input<typeof paymentSettingsSchema>, unknown, z.output<typeof paymentSettingsSchema>>({
    resolver: zodResolver(paymentSettingsSchema),
    defaultValues: {
      provider: settings.provider, environment: settings.environment, enabled: settings.enabled,
      commerce_code: settings.commerce_code, api_secret: '', exit_window_mins: settings.exit_window_mins,
    },
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const { errors } = form.formState;
  const environment = form.watch('environment');
  const id = `pay-${settings.provider}`;

  const save = form.handleSubmit(async values => {
    setBusy(true); setError(''); setSaved(false);
    try {
      await apiWrite.json('/api/payment-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      form.setValue('api_secret', '');
      setSaved(true);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la configuración'); }
    finally { setBusy(false); }
  });

  return (
    <form noValidate onSubmit={save} aria-label={settings.label} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">{settings.label}</h3>
        <Badge tone={settings.enabled ? 'success' : 'neutral'}>{settings.enabled ? 'Activa' : 'Desactivada'}</Badge>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
        <input type="checkbox" className="h-5 w-5" {...form.register('enabled')} />
        Aceptar pagos con esta forma de pago
      </label>
      {settings.provider === 'webpay' && <>
        <Field label="Ambiente" htmlFor={`${id}-env`}>
          <Select id={`${id}-env`} {...form.register('environment')}>
            <option value="integration">Pruebas (no se cobra dinero real)</option>
            <option value="production">Producción</option>
          </Select>
        </Field>
        {environment === 'integration'
          ? <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">En pruebas se usan las credenciales públicas de Transbank, con tarjetas de prueba. No necesitas ingresar nada más.</p>
          : <>
            <Field label="Código de comercio" htmlFor={`${id}-code`} error={errors.commerce_code?.message} hint="Lo entrega Transbank al contratar Webpay Plus"><Input id={`${id}-code`} autoComplete="off" {...form.register('commerce_code')} /></Field>
            <Field label="Llave secreta" htmlFor={`${id}-secret`} error={errors.api_secret?.message} hint={settings.has_secret ? 'Ya hay una llave guardada. Déjala vacía para conservarla.' : 'Se guarda cifrada y no se vuelve a mostrar.'}>
              <Input id={`${id}-secret`} type="password" autoComplete="new-password" {...form.register('api_secret')} />
            </Field>
          </>}
      </>}
      {settings.provider === 'mock' && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Pasarela de simulación para pruebas y demostraciones. Solo está disponible fuera de producción.</p>}
      <Field label="Minutos para salir después de pagar" htmlFor={`${id}-exit`} error={errors.exit_window_mins?.message} hint="Aplica a los pagos en línea de tickets">
        <Input id={`${id}-exit`} type="number" min={0} {...form.register('exit_window_mins')} />
      </Field>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      {saved && <p role="status" className="text-sm font-medium text-emerald-800">Configuración guardada.</p>}
      <Button type="submit" variant="brand" loading={busy}>Guardar</Button>
    </form>
  );
}

export default function PaymentSettingsPanel() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['payment-settings'], queryFn: ({ signal }) => apiFetchJson<SettingsResponse>('/api/payment-settings', { signal }) });
  return (
    <section aria-labelledby="payment-settings-title" className="space-y-4">
      <div>
        <h2 id="payment-settings-title" className="text-lg font-bold text-slate-900">Pagos en línea</h2>
        <p className="text-sm text-slate-600">El cliente escanea el QR de su ticket (o abre el enlace de su cuota), ve el monto y paga. El ticket se marca como pagado solo cuando la pasarela confirma.</p>
      </div>
      {query.isLoading ? <LoadingState /> : query.error ? <p role="alert" className="text-sm text-red-800">{query.error.message}</p> : (
        <div className="space-y-4">
          {query.data?.providers.map(provider => (
            <div key={provider.provider}><ProviderForm settings={provider} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ['payment-settings'] }); }} /></div>
          ))}
        </div>
      )}
    </section>
  );
}
