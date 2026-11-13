import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Button } from '../../../ui';

/** Pasarela simulada (solo desarrollo y pruebas): permite aprobar, rechazar o anular un pago sin dinero real. */
export default function SimulatedGatewayPage({ token }: { token: string }) {
  const apiWrite = useApiMutation('features/payments/pages/SimulatedGatewayPage');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['simulated-payment', token],
    queryFn: ({ signal }) => apiFetchJson<{ company: string; amount: number; status: string }>(`/api/public/payments/simulated/${encodeURIComponent(token)}`, { signal }),
    retry: false,
  });

  const decide = async (outcome: 'approve' | 'reject' | 'cancel') => {
    setBusy(outcome); setError('');
    try {
      const body = await apiWrite.json<{ location: string }>(`/api/public/payments/simulated/${encodeURIComponent(token)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }),
      });
      window.location.assign(body.location);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la decisión');
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-5 rounded-2xl border-2 border-dashed border-amber-400 bg-white p-6">
        <p className="rounded-lg bg-amber-100 p-2 text-center text-xs font-bold uppercase tracking-wider text-amber-900">Pasarela simulada · no se cobra dinero real</p>
        <h1 className="text-xl font-bold text-slate-900">Pago de prueba</h1>
        {query.isLoading && <p role="status" className="text-sm text-slate-600">Cargando...</p>}
        {query.error && <p role="alert" className="text-sm font-medium text-red-800">{query.error.message}</p>}
        {query.data && <>
          <p className="text-sm text-slate-600">{query.data.company}</p>
          <p className="text-4xl font-bold tabular-nums text-slate-900">${Number(query.data.amount).toLocaleString('es-CL')}</p>
          <div className="space-y-2">
            <Button size="lg" variant="brand" fullWidth loading={busy === 'approve'} disabled={busy !== null} onClick={() => decide('approve')}>Aprobar pago</Button>
            <Button size="lg" variant="secondary" fullWidth loading={busy === 'reject'} disabled={busy !== null} onClick={() => decide('reject')}>Rechazar tarjeta</Button>
            <Button size="lg" variant="ghost" fullWidth loading={busy === 'cancel'} disabled={busy !== null} onClick={() => decide('cancel')}>Volver sin pagar</Button>
          </div>
        </>}
        {error && <p role="alert" className="text-sm font-medium text-red-800">{error}</p>}
      </div>
    </main>
  );
}
