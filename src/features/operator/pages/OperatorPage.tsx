import { useApiMutation } from '../../../lib/useApiMutation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ticketLookupSchema, type TicketLookup } from '../../../../shared/schemas/tickets';
import { useEffect, useState } from 'react';

import { ArrowDownToLine, ArrowUpFromLine, Search } from 'lucide-react';
import type { Branch, CashSessionSummary, Space, VisitorQuote, VisitorTicket } from '../../../types';
import { apiFetchJson } from '../../../lib/api';
import { Button, Input, PlateInput, Select, Sheet } from '../../../ui';
import { CashCountStep } from './CashCountStep';

type Lookup = { ticket: VisitorTicket; quote?: VisitorQuote | null };
const money = (amount: number) => `$${Number(amount).toLocaleString('es-CL')}`;
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export default function OperatorPage() {
  const apiWrite = useApiMutation("features/operator/pages");
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const plateForm = useForm<TicketLookup>({ resolver: zodResolver(ticketLookupSchema), defaultValues: { plate: '' } });
  const plate = plateForm.watch('plate');
  const setPlate = (value: string) => plateForm.setValue('plate', value);
  const [sheet, setSheet] = useState<'entry' | 'exit' | 'cash' | null>(null);
  const [ticket, setTicket] = useState<VisitorTicket | null>(null);
  const [quote, setQuote] = useState<VisitorQuote | null>(null);
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cash, setCash] = useState<CashSessionSummary | null>(null);
  const [cashStep, setCashStep] = useState(0);
  const [counts, setCounts] = useState({ cash: '', card: '', transfer: '' });
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const queryClient = useQueryClient();
  const branchQuery = useQuery({ queryKey: ['branches'], queryFn: ({ signal }) => apiFetchJson<Branch[]>('/api/branches', { signal }) });
  const branches = (branchQuery.data ?? []).filter(item => item.status === 'active');
  useEffect(() => { if (branchQuery.data) setBranch(current => branchQuery.data.some(item => item.status === 'active' && String(item.id) === current) ? current : String(branchQuery.data.find(item => item.status === 'active')?.id || '')); }, [branchQuery.data]);
  const spacesQuery = useQuery({ queryKey: ['operator', 'spaces', branch], enabled: Boolean(branch), queryFn: ({ signal }) => apiFetchJson<Space[]>(`/api/spaces?branch_id=${encodeURIComponent(branch)}`, { signal }) });
  const ticketsQuery = useQuery({ queryKey: ['operator', 'tickets', branch], enabled: Boolean(branch), queryFn: ({ signal }) => apiFetchJson<VisitorTicket[]>(`/api/visitors?branch_id=${encodeURIComponent(branch)}`, { signal }) });
  const spaces = spacesQuery.data ?? [];
  const tickets = ticketsQuery.data ?? [];
  const dataError = branchQuery.error?.message || spacesQuery.error?.message || ticketsQuery.error?.message || '';
  const refresh = (id: string) => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['operator', 'spaces', id] }), queryClient.invalidateQueries({ queryKey: ['operator', 'tickets', id] }),
    queryClient.invalidateQueries({ queryKey: ['spaces'] }),
  ]);
  const open = (kind: 'entry' | 'exit') => { setSheet(kind); plateForm.reset({ plate: '' }); setTicket(null); setQuote(null); setError(''); setMessage(''); };
  const createEntry = async ({ plate }: TicketLookup) => { if (!branch || !plate || busy) return;
    setBusy(true); setError('');
    try {
      const result = await apiWrite.json<{ticket: {ticketId: number; plate: string}}>('/api/visitors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate, branch_id: Number(branch) }),
      });
      setSheet(null); setMessage(`Entrada registrada: ${result.ticket.plate}, ticket #${result.ticket.ticketId}.`);
      await refresh(branch).catch(() => setError('La operacion se realizo, pero no se pudo actualizar la lista.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar la entrada'); }
    finally { setBusy(false); }
  };
  const selectTicket = async (selected: VisitorTicket) => {
    setBusy(true); setError(''); setTicket(null); setQuote(null);
    try {
      const nextQuote = selected.status === 'active' ? await apiFetchJson<VisitorQuote>(`/api/visitors/${selected.id}/quote`) : null;
      setTicket(selected); setQuote(nextQuote);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo calcular el cobro'); }
    finally { setBusy(false); }
  };
  const findTicket = async ({ plate }: TicketLookup) => { if (!plate || busy) return;
    setBusy(true); setError(''); setTicket(null); setQuote(null);
    try {
      const result = await apiFetchJson<Lookup>(`/api/visitors/lookup?${new URLSearchParams({ plate })}`);
      const nextQuote = result.ticket.status === 'active' ? await apiFetchJson<VisitorQuote>(`/api/visitors/${result.ticket.id}/quote`) : null;
      setTicket(result.ticket); setQuote(nextQuote);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se encontró el ticket'); }
    finally { setBusy(false); }
  };
  const pay = async () => {
    if (!ticket || !quote || busy) return;
    setBusy(true); setError('');
    try {
      await apiWrite.json(`/api/visitors/${ticket.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, amount: quote.total, quote_id: quote.id }) });
      setTicket({ ...ticket, status: 'paid' }); setQuote(null); setMessage('Pago registrado. Autoriza la salida cuando corresponda.');
      await refresh(branch).catch(() => setError('La operacion se realizo, pero no se pudo actualizar la lista.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el pago'); }
    finally { setBusy(false); }
  };
  const complete = async () => {
    if (!ticket || busy) return;
    setBusy(true); setError('');
    try {
      await apiWrite.json(`/api/visitors/${ticket.id}/complete`, { method: 'POST' });
      setSheet(null); setTicket(null); setMessage(`Salida registrada para ${ticket.plate}.`); await refresh(branch).catch(() => setError('La operacion se realizo, pero no se pudo actualizar la lista.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar la salida'); }
    finally { setBusy(false); }
  };
  const openCash = async () => {
    if (!branch || busy) return;
    setSheet('cash'); setCash(null); setCashStep(0); setCounts({ cash: '', card: '', transfer: '' }); setError(''); setMessage(''); setBusy(true);
    try { setCash(await apiFetchJson<CashSessionSummary>(`/api/visitors/cash/current?branch_id=${encodeURIComponent(branch)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo obtener la caja'); }
    finally { setBusy(false); }
  };
  const closeCash = async () => {
    if (!cash || busy || [counts.cash, counts.card, counts.transfer].some((value: string) => value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) return;
    setBusy(true); setError('');
    try {
      const result = await apiWrite.json<{ closure: { difference_cash: number } }>('/api/visitors/cash/current/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash_session_id: cash.session.id, counted_cash: Number(counts.cash), counted_card: Number(counts.card), counted_transfer: Number(counts.transfer) }),
      });
      setCash(null); setSheet(null); setMessage(`Caja cerrada. Diferencia de efectivo: ${money(result.closure.difference_cash)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar la caja'); }
    finally { setBusy(false); }
  };
  const available = spaces.filter(space => space.status === 'available').length;
  const shown = tickets.filter(item => normalize(item.plate).includes(normalize(search)));
  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Operar</h1><p className="mt-1 text-sm text-slate-600">Entradas, cobros y salidas de visitas</p></header>
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3 sm:items-end">
      <label className="text-sm font-semibold text-slate-700">Sucursal<Select value={branch} onChange={event => setBranch(event.target.value)} className="mt-1" disabled={!branches.length}>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <p className="text-sm text-slate-700"><strong className="text-lg">{available} / {spaces.length}</strong> plazas libres</p>
      <p className="text-sm font-semibold text-slate-700" role="status">{online ? 'Con conexión' : 'Sin conexión'}</p>
    </div>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{message}</p>}
    {(error || dataError) && !sheet && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{error || dataError}</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Button size="lg" variant="brand" onClick={() => open('entry')} disabled={!branch || !online} icon={<ArrowDownToLine aria-hidden="true" />}>Entrada</Button><Button size="lg" onClick={() => open('exit')} disabled={!branch || !online} icon={<ArrowUpFromLine aria-hidden="true" />}>Salida / Cobrar</Button></div>
    <Button variant="secondary" size="lg" fullWidth disabled={!branch || !online} onClick={openCash}>Ver caja y cierre</Button>
    <section className="space-y-3"><h2 className="text-lg font-bold">Vehículos dentro</h2><label className="block text-sm font-semibold text-slate-700">Buscar patente<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Patente" className="mt-1 uppercase" /></label>
      {shown.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No hay tickets que mostrar.</p> : <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">{shown.map(item => <li key={item.id}><button type="button" disabled={!online} onClick={() => { open('exit'); setPlate(normalize(item.plate)); void selectTicket(item); }} className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"><span><strong className="block text-base">{item.plate}</strong><span className="text-sm text-slate-600">{item.space_name || 'Sin plaza'} · {item.status === 'paid' ? 'Pagado' : 'Pendiente'}</span></span><span className="text-sm font-semibold text-indigo-700">Ver</span></button></li>)}</ul>}
    </section>
    <Sheet open={sheet !== null} onClose={() => { if (!busy) setSheet(null); }} title={sheet === 'entry' ? 'Registrar entrada' : sheet === 'cash' ? 'Caja y cierre' : 'Salida y cobro'} dismissible={!busy}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{plateForm.formState.errors.plate && <p role="alert" className="text-sm text-red-800">{plateForm.formState.errors.plate.message}</p>}
        {sheet === 'cash' ? <div className="space-y-4">
          {busy && !cash && <p role="status" className="text-sm">Cargando caja...</p>}
          {cash && <>
            <p className="text-sm font-semibold text-slate-700">Caja #{cash.session.id} - {cash.session.branch_name || branches.find(item => String(item.id) === branch)?.name}</p>
            {cashStep === 0 && <><div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-700">Efectivo esperado</p><p className="text-3xl font-bold">{money(cash.expectedCash)}</p><p className="mt-2 text-sm text-slate-600">{cash.blockers.paidTicketsAwaitingExit} tickets pagados pendientes de salida</p></div><Button size="lg" fullWidth onClick={() => setCashStep(1)} disabled={cash.blockers.paidTicketsAwaitingExit > 0}>Continuar al conteo</Button></>}
            {cashStep === 1 && <CashCountStep initial={counts} onBack={() => setCashStep(0)} onReview={values => { setCounts({ cash: String(values.cash), card: String(values.card), transfer: String(values.transfer) }); setCashStep(2); }} />}
            {cashStep === 2 && <><div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm"><p>Efectivo contado: <strong>{money(Number(counts.cash))}</strong></p><p>Tarjeta contada: <strong>{money(Number(counts.card))}</strong></p><p>Transferencia contada: <strong>{money(Number(counts.transfer))}</strong></p><p>Diferencia de efectivo: <strong>{money(Number(counts.cash) - cash.expectedCash)}</strong></p></div><Button size="lg" variant="brand" fullWidth loading={busy} onClick={closeCash}>Confirmar cierre de caja</Button><Button variant="secondary" fullWidth disabled={busy} onClick={() => setCashStep(1)}>Corregir conteo</Button></>}
          </>}
        </div> : sheet === 'entry' ? <form onSubmit={plateForm.handleSubmit(createEntry)} className="space-y-4"><label className="block text-sm font-semibold">Patente<PlateInput {...plateForm.register('plate')} aria-invalid={Boolean(plateForm.formState.errors.plate)} required className="mt-1 text-xl uppercase" placeholder="ABCD12" /></label><p className="text-sm text-slate-600">Se asignará automáticamente una plaza disponible de la sucursal.</p><Button type="submit" size="lg" variant="brand" fullWidth loading={busy} disabled={!plate}>Registrar entrada</Button></form> : <>
          {!ticket && <form onSubmit={plateForm.handleSubmit(findTicket)} className="space-y-4"><label className="block text-sm font-semibold">Patente<PlateInput {...plateForm.register('plate')} aria-invalid={Boolean(plateForm.formState.errors.plate)} required className="mt-1 text-xl uppercase" placeholder="ABCD12" /></label><Button type="submit" size="lg" fullWidth loading={busy} icon={<Search aria-hidden="true" />}>Buscar ticket</Button></form>}
          {ticket && <div className="space-y-4"><div className="rounded-xl bg-slate-50 p-4"><p className="font-bold">{ticket.plate}</p><p className="text-sm text-slate-600">{ticket.space_name || 'Sin plaza'} · Entrada: {new Date(ticket.entry_time.replace(' ', 'T') + (ticket.entry_time.includes('Z') ? '' : 'Z')).toLocaleString('es-CL')}</p></div>
            {quote ? <><div className="rounded-xl bg-indigo-50 p-5"><p className="text-sm font-semibold text-indigo-800">Total a cobrar</p><p className="mt-1 text-4xl font-bold tabular-nums text-indigo-900">{money(quote.total)}</p><p className="mt-2 text-sm text-indigo-800">{quote.duration_minutes} minutos · {quote.grace_period_mins} minutos de gracia</p></div><label className="block text-sm font-semibold">Medio de pago<Select value={method} onChange={e => setMethod(e.target.value)} className="mt-1"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></Select></label><Button size="lg" variant="brand" fullWidth loading={busy} onClick={pay}>Registrar pago</Button></> : <><p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Ticket pagado. Puedes registrar la salida.</p><Button size="lg" variant="brand" fullWidth loading={busy} onClick={complete}>Registrar salida</Button></>}
            <Button fullWidth variant="secondary" onClick={() => { setTicket(null); setQuote(null); }}>Buscar otro ticket</Button>
          </div>}
        </>}
      </div>
    </Sheet>
  </div>;
}
