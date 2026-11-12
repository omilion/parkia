import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { merchantValidationSchema } from '../../../../shared/schemas/pricing';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Button, Field, Input, PlateInput } from '../../../ui';

type Result = { merchant: string; benefit: string; plate: string };

/** Pantalla pública para que un comercio con convenio valide el ticket de un cliente (sin sesión). */
export default function MerchantValidationPage() {
  const apiWrite = useApiMutation('features/pricing/pages/MerchantValidationPage');
  const form = useForm({
    resolver: zodResolver(merchantValidationSchema),
    defaultValues: { code: '', plate: '' },
  });
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = form.handleSubmit(async values => {
    setBusy(true); setError(''); setResult(null);
    try {
      const body = await apiWrite.json<Result>('/api/public/validar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      setResult(body);
      form.reset({ code: values.code, plate: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo validar el ticket');
    } finally {
      setBusy(false);
    }
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <header>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Parkia · Convenios</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Validar estacionamiento</h1>
          <p className="mt-2 text-sm text-slate-600">Ingresa el código de tu comercio y la patente del cliente para aplicar el beneficio.</p>
        </header>
        <form noValidate onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <Field label="Código del comercio" htmlFor="merchant-code" error={form.formState.errors.code?.message}>
            <Input id="merchant-code" autoCapitalize="characters" autoComplete="off" spellCheck={false} className="uppercase" invalid={Boolean(form.formState.errors.code)} {...form.register('code')} />
          </Field>
          <Field label="Patente del cliente" htmlFor="merchant-plate" error={form.formState.errors.plate?.message}>
            <PlateInput id="merchant-plate" autoComplete="off" placeholder="ABCD12" className="text-xl uppercase" invalid={Boolean(form.formState.errors.plate)} {...form.register('plate')} />
          </Field>
          <Button type="submit" size="lg" variant="brand" fullWidth loading={busy}>Validar ticket</Button>
        </form>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{error}</p>}
        {result && (
          <div role="status" className="flex gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-900">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">Ticket validado</p>
              <p className="text-sm">{result.merchant}: {result.benefit} para la patente {result.plate}.</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
