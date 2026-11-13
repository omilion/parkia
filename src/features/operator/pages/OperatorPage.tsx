import { useApiMutation, ApiMutationError } from '../../../lib/useApiMutation';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ticketLookupSchema, type TicketLookup } from '../../../../shared/schemas/tickets';
import { useEffect, useState } from 'react';

import { ArrowDownToLine, ArrowUpFromLine, Printer, Search } from 'lucide-react';
import type { Branch, CashSessionSummary, VisitorQuote, VisitorTicket } from '../../../types';
import { apiFetchJson } from '../../../lib/api';
import { Button, Input, PlateInput, Select, Sheet } from '../../../ui';
import { CashCountStep } from './CashCountStep';
import { TicketAdjustments } from './TicketAdjustments';
import { vehicleTypes, vehicleTypeLabels } from '../../../../shared/schemas/pricing';
import { loadMeta, saveMeta } from '../offline/db';
import { NoLocalPlanError, quoteTicketLocally, type LocalQuote } from '../offline/localQuote';
import { findTicketByPlate } from '../offline/projection';
import { newClientUuid, newTicketToken } from '../offline/queue';
import type { ProjectedTicket } from '../offline/types';
import { useOperatorOffline } from '../offline/useOperatorOffline';
import { entryTicketDocument, exitReceiptDocument, type ReceiptDocument } from '../printing/document';
import { PrinterPanel } from '../printing/PrinterPanel';
import { usePrinter } from '../printing/printer';

type Quote = (VisitorQuote & { offline?: false }) | LocalQuote;
type Lookup = { ticket: VisitorTicket; quote?: VisitorQuote | null };
const money = (amount: number) => `$${Number(amount).toLocaleString('es-CL')}`;
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const parseEntry = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));

/** Un ticket que viene del servidor (consulta por patente) con la forma que usa la pantalla. */
const fromServer = (ticket: VisitorTicket): ProjectedTicket => ({
  id: ticket.id, plate: ticket.plate, status: ticket.status === 'completed' ? 'paid' : ticket.status, entry_time: ticket.entry_time,
  vehicle_type: 'car', rate_plan_id: null, space_id: ticket.space_id ?? null, space_name: ticket.space_name ?? null, public_token: null,
  amount: ticket.amount, paid_at: ticket.paid_at ?? null, exit_deadline: null, validations: [], pending_sync: false, entry_uuid: null,
});

const isNetworkError = (error: unknown) => error instanceof ApiMutationError && error.status === 0;
const operationLabel = (type: string) => (type === 'entry' ? 'Entrada' : type === 'payment' ? 'Cobro' : 'Salida');

export default function OperatorPage() {
  const apiWrite = useApiMutation("features/operator/pages");
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const plateForm = useForm<TicketLookup>({ resolver: zodResolver(ticketLookupSchema), defaultValues: { plate: '' } });
  const plate = plateForm.watch('plate');
  const setPlate = (value: string) => plateForm.setValue('plate', value);
  const [sheet, setSheet] = useState<'entry' | 'exit' | 'cash' | null>(null);
  const [ticket, setTicket] = useState<ProjectedTicket | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [method, setMethod] = useState('cash');
  const [vehicleType, setVehicleType] = useState<string>('car');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cash, setCash] = useState<CashSessionSummary | null>(null);
  const [cashStep, setCashStep] = useState(0);
  const [counts, setCounts] = useState({ cash: '', card: '', transfer: '' });
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printable, setPrintable] = useState<{ label: string; doc: ReceiptDocument } | null>(null);
  const [printNote, setPrintNote] = useState('');
  const { state: printerState, printer } = usePrinter();

  const branchId = branch ? Number(branch) : null;
  const { state: offline, enqueue, flush, refresh, discard, markOffline } = useOperatorOffline(branchId);
  const { online, snapshot, tickets, pendingCount, rejected, syncing, authError } = offline;

  // Las sucursales se guardan en el dispositivo para poder elegir una al abrir la app sin red.
  const [cachedBranches, setCachedBranches] = useState<Branch[]>([]);
  useEffect(() => { void loadMeta<Branch[]>('branches').then(stored => { if (stored) setCachedBranches(stored); }); }, []);
  const branchQuery = useQuery({ queryKey: ['branches'], queryFn: ({ signal }) => apiFetchJson<Branch[]>('/api/branches', { signal }) });
  useEffect(() => { if (branchQuery.data) void saveMeta('branches', branchQuery.data); }, [branchQuery.data]);
  const branchList = branchQuery.data ?? cachedBranches;
  const branches = branchList.filter(item => item.status === 'active');
  useEffect(() => { if (branchList.length) setBranch(current => branchList.some(item => item.status === 'active' && String(item.id) === current) ? current : String(branchList.find(item => item.status === 'active')?.id || '')); }, [branchList]);

  const spaces = snapshot?.spaces ?? [];
  const companyName = snapshot?.company?.name ?? 'Parkia';
  const branchName = branches.find(item => String(item.id) === branch)?.name ?? snapshot?.branch.name ?? '';
  const timeZone = snapshot?.branch.time_zone ?? 'America/Santiago';
  const methodLabels: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };

  /** Deja el documento listo para reimprimir y, si hay térmica conectada con impresión automática, lo imprime. */
  const announce = async (label: string, doc: ReceiptDocument) => {
    setPrintable({ label, doc }); setPrintNote('');
    try {
      const result = await printer.autoPrint(doc);
      if (result?.note) setPrintNote(result.note);
    } catch (e) { setPrintNote(`No se pudo imprimir: ${e instanceof Error ? e.message : 'error desconocido'}`); }
  };
  const printNow = async () => {
    if (!printable) return;
    setPrintNote('');
    try { const result = await printer.print(printable.doc); if (result.note) setPrintNote(result.note); }
    catch (e) { setPrintNote(`No se pudo imprimir: ${e instanceof Error ? e.message : 'error desconocido'}`); }
  };
  const entryDocument = (data: { plate: string; token: string | null; spaceName: string | null; vehicle: string; entryAt: Date }) => entryTicketDocument({
    company: companyName, branch: branchName, plate: data.plate, entryAt: data.entryAt, spaceName: data.spaceName,
    vehicleLabel: vehicleTypeLabels[data.vehicle] ?? 'Auto', payUrl: data.token ? `${window.location.origin}/pagar/${data.token}` : null, timeZone,
  });
  /** Comprobante de pago. Con conexión trae la boleta electrónica (y su timbre) si ya se emitió. */
  const exitDocument = async (target: ProjectedTicket, current: Quote, payMethod: string, withServerData: boolean) => {
    let name = companyName;
    let rut = snapshot?.company?.rut ?? null;
    let boleta: { folio: number; typeLabel: string; tedPngBase64: string | null } | null = null;
    if (withServerData) {
      try {
        const data = await apiFetchJson<{ company: { name: string; rut: string | null }; boleta: { folio: number; dte_type: number; ted_png_base64: string | null } | null }>(`/api/operator/tickets/${target.id}/receipt`);
        name = data.company.name; rut = data.company.rut;
        if (data.boleta) boleta = { folio: data.boleta.folio, typeLabel: data.boleta.dte_type === 41 ? 'Boleta Exenta Electrónica' : 'Boleta Electrónica', tedPngBase64: data.boleta.ted_png_base64 };
      } catch { /* sin datos del servidor se imprime el comprobante simple */ }
    }
    return exitReceiptDocument({
      company: name, companyRut: rut, branch: branchName, plate: target.plate, entryAt: parseEntry(target.entry_time), paidAt: new Date(),
      durationMins: current.duration_minutes, amount: current.total, methodLabel: methodLabels[payMethod] ?? payMethod, timeZone, boleta,
    });
  };
  const dataError = branchQuery.error && !cachedBranches.length ? branchQuery.error.message : '';
  const open = (kind: 'entry' | 'exit') => { setSheet(kind); plateForm.reset({ plate: '' }); setVehicleType('car'); setTicket(null); setQuote(null); setError(''); setMessage(''); };

  /** Un ticket que el servidor aun no conoce (o con operaciones sin enviar) se opera siempre en local. */
  const serverKnows = (target: ProjectedTicket) => online && target.id > 0 && !target.pending_sync;
  const ref = (target: ProjectedTicket) => (target.entry_uuid ? { entry_uuid: target.entry_uuid } : { id: target.id });

  const createEntryOffline = async (rawPlate: string) => {
    if (!branchId) return;
    const normalized = normalize(rawPlate);
    if (tickets.some(item => normalize(item.plate) === normalized)) { setError('La patente ya tiene un ticket activo'); return; }
    const token = newTicketToken();
    await enqueue({
      client_uuid: newClientUuid(), type: 'entry', plate: rawPlate, vehicle_type: vehicleType as 'car' | 'moto' | 'truck', branch_id: branchId,
      occurred_at: new Date().toISOString(), public_token: token,
    });
    setSheet(null);
    void announce('ticket de entrada', entryDocument({ plate: normalized, token, spaceName: null, vehicle: vehicleType, entryAt: new Date() }));
    setMessage(`Entrada registrada sin conexión: ${rawPlate}. Se enviará al servidor cuando vuelva la red.`);
  };

  const createEntry = async ({ plate }: TicketLookup) => { if (!branch || !plate || busy) return;
    setBusy(true); setError('');
    try {
      if (!online) { await createEntryOffline(plate); return; }
      try {
        const result = await apiWrite.json<{ticket: {ticketId: number; plate: string; spaceName: string | null; public_token?: string}}>('/api/visitors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate, branch_id: Number(branch), vehicle_type: vehicleType }),
        });
        setSheet(null); setMessage(`Entrada registrada: ${result.ticket.plate}, ticket #${result.ticket.ticketId}.`);
        void announce('ticket de entrada', entryDocument({ plate: result.ticket.plate, token: result.ticket.public_token ?? null, spaceName: result.ticket.spaceName ?? null, vehicle: vehicleType, entryAt: new Date() }));
        await refresh();
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        markOffline();
        await createEntryOffline(plate);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar la entrada'); }
    finally { setBusy(false); }
  };

  const quoteLocally = (target: ProjectedTicket) => quoteTicketLocally(target, snapshot?.plans ?? [], branchId ?? 0);

  const selectTicket = async (selected: ProjectedTicket) => {
    setBusy(true); setError(''); setTicket(null); setQuote(null);
    try {
      if (selected.status !== 'active') { setTicket(selected); return; }
      if (serverKnows(selected)) {
        try {
          const nextQuote = await apiFetchJson<VisitorQuote>(`/api/visitors/${selected.id}/quote`);
          setTicket(selected); setQuote(nextQuote);
          return;
        } catch (e) {
          if (!(e instanceof TypeError)) throw e;
          markOffline();
        }
      }
      setTicket(selected); setQuote(quoteLocally(selected));
    } catch (e) { setError(e instanceof NoLocalPlanError ? e.message : e instanceof Error ? e.message : 'No se pudo calcular el cobro'); }
    finally { setBusy(false); }
  };

  const findTicket = async ({ plate }: TicketLookup) => { if (!plate || busy) return;
    setBusy(true); setError(''); setTicket(null); setQuote(null);
    try {
      const local = findTicketByPlate(tickets, plate);
      if (online && !local?.pending_sync) {
        try {
          const result = await apiFetchJson<Lookup>(`/api/visitors/lookup?${new URLSearchParams({ plate })}`);
          const found = tickets.find(item => item.id === result.ticket.id) ?? fromServer(result.ticket);
          const nextQuote = result.ticket.status === 'active' ? await apiFetchJson<VisitorQuote>(`/api/visitors/${result.ticket.id}/quote`) : null;
          setTicket(found); setQuote(nextQuote);
          return;
        } catch (e) {
          if (!(e instanceof TypeError)) throw e;
          markOffline();
        }
      }
      if (!local) throw new Error('No se encontró el ticket en este dispositivo. Sin conexión solo se pueden buscar los tickets descargados.');
      setTicket(local); setQuote(local.status === 'active' ? quoteLocally(local) : null);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se encontró el ticket'); }
    finally { setBusy(false); }
  };

  const payOffline = async (target: ProjectedTicket, current: Quote) => {
    await enqueue({ client_uuid: newClientUuid(), type: 'payment', ticket: ref(target), method: 'cash', amount: current.total, occurred_at: new Date().toISOString() });
    setTicket({ ...target, status: 'paid', pending_sync: true }); setQuote(null);
    setMessage('Cobro en efectivo guardado sin conexión. Se enviará al servidor cuando vuelva la red.');
    void announce('comprobante', await exitDocument(target, current, 'cash', false));
  };

  const pay = async () => {
    if (!ticket || !quote || busy) return;
    setBusy(true); setError('');
    try {
      if (quote.offline || !serverKnows(ticket)) {
        if (method !== 'cash') { setError('Sin conexión solo se puede cobrar en efectivo: la tarjeta necesita conexión.'); return; }
        await payOffline(ticket, quote);
        return;
      }
      try {
        await apiWrite.json(`/api/visitors/${ticket.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, amount: quote.total, quote_id: quote.id }) });
        setTicket({ ...ticket, status: 'paid' }); setQuote(null); setMessage('Pago registrado. Autoriza la salida cuando corresponda.');
        void exitDocument(ticket, quote, method, true).then(doc => announce('comprobante', doc));
        await refresh();
      } catch (e) {
        if (!isNetworkError(e) || method !== 'cash') throw e;
        // No se sabe si el servidor alcanzo a registrarlo: se guarda localmente y, si ya estaba pagado, la sincronizacion lo marca para revision.
        markOffline();
        await payOffline(ticket, quote);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el pago'); }
    finally { setBusy(false); }
  };

  const completeOffline = async (target: ProjectedTicket) => {
    await enqueue({ client_uuid: newClientUuid(), type: 'exit', ticket: ref(target), occurred_at: new Date().toISOString() });
    setSheet(null); setTicket(null); setMessage(`Salida registrada sin conexión para ${target.plate}. Se enviará cuando vuelva la red.`);
  };

  const complete = async () => {
    if (!ticket || busy) return;
    setBusy(true); setError('');
    try {
      if (!serverKnows(ticket)) { await completeOffline(ticket); return; }
      try {
        await apiWrite.json(`/api/visitors/${ticket.id}/complete`, { method: 'POST' });
        setSheet(null); setTicket(null); setMessage(`Salida registrada para ${ticket.plate}.`); await refresh();
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        markOffline();
        await completeOffline(ticket);
      }
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
  const withWarnings = offline.ops.filter(op => op.status === 'applied' && op.warnings.length > 0);
  const describeOp = (op: (typeof rejected)[number]) => {
    const operation = op.operation;
    const target = operation.type === 'entry'
      ? ` ${operation.plate}`
      : (() => { const found = tickets.find(item => (operation.ticket.entry_uuid && item.entry_uuid === operation.ticket.entry_uuid) || item.id === operation.ticket.id); return found ? ` ${found.plate}` : ''; })();
    return `${operationLabel(operation.type)}${target} · ${new Date(op.created_at).toLocaleString('es-CL')}`;
  };
  const operatesLocally = ticket ? Boolean(quote?.offline) || !serverKnows(ticket) : false;

  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Operar</h1><p className="mt-1 text-sm text-slate-600">Entradas, cobros y salidas de visitas</p></header>
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3 sm:items-end">
      <label className="text-sm font-semibold text-slate-700">Sucursal<Select value={branch} onChange={event => setBranch(event.target.value)} className="mt-1" disabled={!branches.length}>{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
      <p className="text-sm text-slate-700"><strong className="text-lg">{available} / {spaces.length}</strong> plazas libres</p>
      <p className={`text-sm font-semibold ${online ? 'text-slate-700' : 'text-amber-800'}`} role="status">
        {online ? (syncing ? 'Sincronizando...' : 'Con conexión') : 'Sin conexión'}
        {pendingCount > 0 ? ` · ${pendingCount} ${pendingCount === 1 ? 'operación pendiente' : 'operaciones pendientes'} de envío` : ''}
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" onClick={() => setPrinterOpen(true)} icon={<Printer aria-hidden="true" className="h-4 w-4" />}>Impresora{printerState.connected ? `: ${printerState.name}` : ''}</Button>
      {printable && <Button variant="secondary" size="sm" onClick={() => { void printNow(); }}>Imprimir {printable.label}</Button>}
    </div>
    {printNote && <p role="status" className="text-sm font-medium text-amber-900">{printNote}</p>}
    {online && pendingCount > 0 && !syncing && <div><Button variant="secondary" size="sm" onClick={() => { void flush(); }}>Enviar ahora</Button></div>}
    {!online && <p className="rounded-xl bg-amber-50 p-4 text-sm font-medium text-amber-900">Trabajando sin conexión. Puedes registrar entradas, cobrar en efectivo y dar salidas con los datos descargados; todo se enviará solo al volver la red. {snapshot ? '' : 'Este dispositivo aún no descargó los datos de la sucursal: conéctate una vez para poder cobrar sin red.'}</p>}
    {authError && pendingCount > 0 && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">Tu sesión venció y hay {pendingCount} operaciones guardadas sin enviar. Cierra sesión y vuelve a ingresar para enviarlas; no se pierden.</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{message}</p>}
    {(error || dataError) && !sheet && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">{error || dataError}</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Button size="lg" variant="brand" onClick={() => open('entry')} disabled={!branch} icon={<ArrowDownToLine aria-hidden="true" />}>Entrada</Button><Button size="lg" onClick={() => open('exit')} disabled={!branch} icon={<ArrowUpFromLine aria-hidden="true" />}>Salida / Cobrar</Button></div>
    <Button variant="secondary" size="lg" fullWidth disabled={!branch || !online || pendingCount > 0} onClick={openCash}>Ver caja y cierre</Button>
    {pendingCount > 0 && <p className="-mt-3 text-sm text-slate-600">La caja se cierra cuando todas las operaciones guardadas se hayan enviado.</p>}

    {(rejected.length > 0 || withWarnings.length > 0) && <section aria-label="Operaciones con problemas" className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-lg font-bold text-amber-900">Operaciones que requieren revisión</h2>
      <ul className="space-y-3">
        {rejected.map(op => <li key={op.client_uuid} className="rounded-xl bg-white p-3 text-sm"><p className="font-bold text-slate-900">{describeOp(op)}</p><p className="mt-1 text-red-800">{op.last_error ?? 'El servidor rechazó la operación'}</p><p className="mt-1 text-slate-600">El servidor no la aplicó. Avisa a un administrador y, cuando esté resuelta, descártala.</p><Button size="sm" variant="secondary" className="mt-2" onClick={() => { void discard(op.client_uuid); }}>Descartar</Button></li>)}
        {withWarnings.map(op => <li key={op.client_uuid} className="rounded-xl bg-white p-3 text-sm"><p className="font-bold text-slate-900">{describeOp(op)}</p><ul className="mt-1 list-disc pl-5 text-amber-900">{op.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></li>)}
      </ul>
    </section>}

    <section className="space-y-3"><h2 className="text-lg font-bold">Vehículos dentro</h2><label className="block text-sm font-semibold text-slate-700">Buscar patente<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Patente" className="mt-1 uppercase" /></label>
      {shown.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-slate-600">No hay tickets que mostrar.</p> : <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">{shown.map(item => <li key={`${item.id}-${item.entry_uuid ?? ''}`}><button type="button" onClick={() => { open('exit'); setPlate(normalize(item.plate)); void selectTicket(item); }} className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"><span><strong className="block text-base">{item.plate}</strong><span className="text-sm text-slate-600">{item.space_name || 'Sin plaza'} · {item.status === 'paid' ? 'Pagado' : 'Pendiente'}{item.pending_sync ? ' · Sin enviar' : ''}</span></span><span className="text-sm font-semibold text-indigo-700">Ver</span></button></li>)}</ul>}
    </section>
    <PrinterPanel open={printerOpen} onClose={() => setPrinterOpen(false)} sampleDocument={entryDocument({ plate: 'PRUEBA1', token: null, spaceName: 'A-01', vehicle: 'car', entryAt: new Date() })} />
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
        </div> : sheet === 'entry' ? <form onSubmit={plateForm.handleSubmit(createEntry)} className="space-y-4"><label className="block text-sm font-semibold">Patente<PlateInput {...plateForm.register('plate')} aria-invalid={Boolean(plateForm.formState.errors.plate)} required className="mt-1 text-xl uppercase" placeholder="ABCD12" /></label><label className="block text-sm font-semibold">Tipo de vehículo<Select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className="mt-1">{vehicleTypes.map(type => <option key={type} value={type}>{vehicleTypeLabels[type]}</option>)}</Select></label><p className="text-sm text-slate-600">{online ? 'Se asignará automáticamente una plaza disponible de la sucursal.' : 'Sin conexión: la entrada se guarda en este dispositivo y la plaza se asigna al enviarla.'}</p><Button type="submit" size="lg" variant="brand" fullWidth loading={busy} disabled={!plate}>Registrar entrada</Button></form> : <>
          {!ticket && <form onSubmit={plateForm.handleSubmit(findTicket)} className="space-y-4"><label className="block text-sm font-semibold">Patente<PlateInput {...plateForm.register('plate')} aria-invalid={Boolean(plateForm.formState.errors.plate)} required className="mt-1 text-xl uppercase" placeholder="ABCD12" /></label><Button type="submit" size="lg" fullWidth loading={busy} icon={<Search aria-hidden="true" />}>Buscar ticket</Button></form>}
          {ticket && <div className="space-y-4"><div className="rounded-xl bg-slate-50 p-4"><p className="font-bold">{ticket.plate}</p><p className="text-sm text-slate-600">{ticket.space_name || 'Sin plaza'} · Entrada: {parseEntry(ticket.entry_time).toLocaleString('es-CL')}{ticket.pending_sync ? ' · Sin enviar al servidor' : ''}</p></div>
            {quote ? <><div className="rounded-xl bg-indigo-50 p-5"><p className="text-sm font-semibold text-indigo-800">Total a cobrar</p><p className="mt-1 text-4xl font-bold tabular-nums text-indigo-900">{money(quote.total)}</p><p className="mt-2 text-sm text-indigo-800">{quote.duration_minutes} minutos · {quote.grace_period_mins} minutos de gracia</p>{quote.discount_amount ? <p className="mt-1 text-sm text-indigo-800">Descuento por convenio: {money(quote.discount_amount)}</p> : null}{quote.offline && <p className="mt-2 text-sm font-semibold text-amber-800">Cotizado en este dispositivo, sin conexión. El servidor lo confirma al enviarlo.</p>}</div><label className="block text-sm font-semibold">Medio de pago<Select value={operatesLocally ? 'cash' : method} onChange={e => setMethod(e.target.value)} className="mt-1" disabled={operatesLocally}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></Select></label>{operatesLocally && <p className="text-sm text-slate-600">Sin conexión solo se puede cobrar en efectivo.</p>}<Button size="lg" variant="brand" fullWidth loading={busy} onClick={() => { void pay(); }}>Registrar pago</Button></> : <><p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Ticket pagado. Puedes registrar la salida.</p><Button size="lg" variant="brand" fullWidth loading={busy} onClick={complete}>Registrar salida</Button></>}
            {ticket.status === 'active' && serverKnows(ticket) && quote && !quote.offline && <TicketAdjustments ticketId={ticket.id} disabled={busy} onChanged={() => selectTicket(ticket)} />}
            <Button fullWidth variant="secondary" onClick={() => { setTicket(null); setQuote(null); }}>Buscar otro ticket</Button>
          </div>}
        </>}
      </div>
    </Sheet>
  </div>;
}
