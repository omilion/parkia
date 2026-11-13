import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, CreditCard, TriangleAlert } from 'lucide-react';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Button } from '../../../ui';

type Provider = { id: 'webpay' | 'mock'; label: string };
type PaymentView = {
  kind: 'ticket' | 'receivable';
  company: string;
  status: 'active' | 'paid' | 'completed' | 'expired';
  amount: number;
  plate?: string;
  due_date?: string | null;
  duration_minutes?: number;
  entry_time?: string;
  discount_amount?: number;
  rate_label?: string;
  exit_window_mins?: number;
  exit_deadline?: string | null;
  providers: Provider[];
};
type Redirect = { url: string; method: 'GET' | 'POST'; fields: Record<string, string> };

const money = (value: number) => `$${Number(value).toLocaleString('es-CL')}`;
const parseUtc = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));

const resultMessages: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  paid: { tone: 'ok', text: '¡Pago recibido! Ya puedes retirarte.' },
  duplicate: { tone: 'ok', text: 'Este ticket ya estaba pagado. Si se te cobró dos veces, el segundo cargo se devolverá automáticamente.' },
  cancelled: { tone: 'warn', text: 'Cancelaste el pago. No se hizo ningún cobro; puedes intentarlo otra vez.' },
  failed: { tone: 'error', text: 'La tarjeta fue rechazada o el pago no se completó. No se hizo ningún cobro; puedes intentarlo otra vez.' },
  pending: { tone: 'warn', text: 'Estamos confirmando tu pago con el banco. Esta página se actualiza sola.' },
  error: { tone: 'error', text: 'No pudimos identificar el pago. Si te cobraron, pide ayuda al personal del estacionamiento.' },
};

/** Entrega al cliente a la pasarela: GET navega; POST envía un formulario con los campos que pide la pasarela. */
function goToGateway(redirect: Redirect) {
  if (redirect.method === 'GET') {
    window.location.assign(redirect.url);
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = redirect.url;
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** Pagina publica de pago: la abre el cliente desde el QR del ticket o desde el enlace de su cuota. */
export default function PublicPaymentPage({ token }: { token: string }) {
  const apiWrite = useApiMutation('features/payments/pages/PublicPaymentPage');
  const result = new URLSearchParams(window.location.search).get('result') || '';
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const attempt = useRef(0);

  const query = useQuery({
    queryKey: ['public-payment', token],
    queryFn: ({ signal }) => apiFetchJson<PaymentView>(`/api/public/pay/${encodeURIComponent(token)}`, { signal }),
    retry: false,
    refetchInterval: result === 'pending' ? 5000 : false,
  });
  const view = query.data;
  const message = result ? resultMessages[result] : undefined;

  const pay = async (provider: Provider['id']) => {
    setBusy(provider); setError('');
    attempt.current += 1;
    try {
      const body = await apiWrite.json<{ redirect: Redirect }>(`/api/public/pay/${encodeURIComponent(token)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${crypto.randomUUID()}-${attempt.current}` },
        body: JSON.stringify({ provider }),
      });
      goToGateway(body.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar el pago');
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">{view?.company ?? 'Pago en línea'}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{view?.kind === 'receivable' ? 'Pagar mi cuota' : 'Pagar mi estacionamiento'}</h1>
        </header>

        {message && (
          <p role="status" className={`flex gap-3 rounded-xl p-4 text-sm font-medium ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-900' : message.tone === 'warn' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-900'}`}>
            {message.tone === 'ok' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" /> : message.tone === 'warn' ? <Clock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" /> : <TriangleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />}
            <span>{message.text}</span>
          </p>
        )}

        {query.isLoading && <p role="status" className="text-sm text-slate-600">Cargando...</p>}
        {query.error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{query.error.message}</p>}

        {view && (
          <section aria-label="Detalle del cobro" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            {view.plate && <p className="text-sm text-slate-600">Patente <strong className="text-lg text-slate-900">{view.plate}</strong></p>}
            {view.kind === 'receivable' && view.due_date && <p className="text-sm text-slate-600">Cuota con vencimiento <strong className="text-slate-900">{view.due_date}</strong></p>}

            {view.status === 'active' && <>
              <div>
                <p className="text-sm text-slate-600">Total a pagar</p>
                <p className="text-4xl font-bold tabular-nums text-slate-900">{money(view.amount)}</p>
                {view.kind === 'ticket' && <p className="mt-1 text-sm text-slate-600">{view.duration_minutes} minutos de estadía{view.discount_amount ? ` · descuento por convenio ${money(view.discount_amount)}` : ''}</p>}
              </div>
              {view.kind === 'ticket' && view.amount > 0 && view.exit_window_mins ? <p className="text-sm text-slate-600">Después de pagar tienes <strong>{view.exit_window_mins} minutos</strong> para salir.</p> : null}
              {view.kind === 'ticket' && view.amount <= 0 && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900">No tienes nada que pagar por ahora: estás dentro del tiempo de gracia.</p>}
              {view.amount > 0 && (view.providers.length === 0
                ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">El pago en línea no está disponible en este momento. Paga en caja.</p>
                : <div className="space-y-2">
                  {view.providers.map(provider => (
                    <Button key={provider.id} size="lg" variant="brand" fullWidth loading={busy === provider.id} disabled={busy !== null} onClick={() => pay(provider.id)} icon={<CreditCard aria-hidden="true" className="h-5 w-5" />}>{provider.label}</Button>
                  ))}
                </div>)}
            </>}

            {view.status === 'paid' && <div className="space-y-1">
              <p className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 aria-hidden="true" className="h-5 w-5" />Pago confirmado</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900">{money(view.amount)}</p>
              {view.exit_deadline && <p className="text-sm text-slate-600">Tienes hasta las <strong>{parseUtc(view.exit_deadline).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</strong> para salir.</p>}
            </div>}
            {view.status === 'completed' && <p className="text-sm text-slate-700">Este ticket ya fue cerrado. ¡Gracias por tu visita!</p>}
            {view.status === 'expired' && <p className="text-sm text-slate-700">Este enlace de pago venció. Pide uno nuevo al estacionamiento.</p>}
          </section>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{error}</p>}
        <p className="text-center text-xs text-slate-500">Pago procesado de forma segura por la pasarela. Parkia no guarda los datos de tu tarjeta.</p>
      </div>
    </main>
  );
}

/** Pantalla de resultado sin ticket identificable (retorno con error de la pasarela). */
export function PaymentResultPage() {
  const result = new URLSearchParams(window.location.search).get('result') || 'error';
  const message = resultMessages[result] ?? resultMessages.error;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Resultado del pago</h1>
        <p role="status" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-900">{message.text}</p>
      </div>
    </main>
  );
}
