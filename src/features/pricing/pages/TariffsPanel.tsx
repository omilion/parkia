import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import {
  agreementKindLabels, agreementKinds, agreementSchema, planVehicleTypes, pricingModes, quoteSimulationSchema,
  ratePlanSchema, vehicleTypeLabels,
} from '../../../../shared/schemas/pricing';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { Badge, Button, EmptyState, Field, Input, LoadingState, Select, Sheet, Textarea } from '../../../ui';

type PlanRule = { weekdays: number[] | null; from: string; to: string; priority: number; price_per_minute: number | null; first_block_price: number | null; block_price: number | null };
type Plan = {
  id: number; group_id: number; version: number; name: string; branch_id: number | null; vehicle_type: string; mode: 'per_minute' | 'elapsed_blocks';
  grace_mins: number; daily_cap: number | null; first_block_minutes: number | null; block_minutes: number | null;
  valid_from: string | null; valid_to: string | null; status: string; change_note: string | null; rules: PlanRule[];
};
type Agreement = { id: number; name: string; code: string; kind: string; value: number; cap_amount: number | null; branch_id: number | null; status: 'active' | 'inactive'; notes: string | null; validations_count: number };
type SimulationResult = { subtotal: number; durationMins: number; billableMins: number; lines: Array<{ label?: string; description?: string; minutes?: number; amount: number }>; days?: Array<{ date: string; subtotal: number; capped?: boolean }> };

const WEEKDAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']] as const;
const modeLabels: Record<string, string> = { per_minute: 'Por minuto efectivo', elapsed_blocks: 'Por tramos vencidos' };
const money = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const emptyRule = { weekdays: null, from: '00:00', to: '24:00', priority: 0, price_per_minute: 50, first_block_price: null, block_price: null };
const blankPlan = { name: '', branch_id: null, vehicle_type: 'all' as const, mode: 'per_minute' as const, grace_mins: 15, daily_cap: null, first_block_minutes: null, block_minutes: null, valid_from: '', valid_to: '', change_note: '', rules: [emptyRule] };

function planToForm(plan: Plan) {
  return {
    name: plan.name, branch_id: plan.branch_id, vehicle_type: plan.vehicle_type as typeof planVehicleTypes[number], mode: plan.mode,
    grace_mins: plan.grace_mins, daily_cap: plan.daily_cap, first_block_minutes: plan.first_block_minutes, block_minutes: plan.block_minutes,
    valid_from: plan.valid_from ?? '', valid_to: plan.valid_to ?? '', change_note: '', rules: plan.rules,
  };
}

function describePlan(plan: Plan) {
  const first = plan.rules[0];
  if (plan.mode === 'per_minute') return `${money(first?.price_per_minute)} por minuto`;
  return `${money(first?.first_block_price)} primer tramo · ${money(first?.block_price)} cada tramo`;
}

// ------------------------------------------------------------------ tarifas
function PlanEditor({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const apiWrite = useApiMutation('features/pricing/pages/TariffsPanel');
  const form = useForm<z.input<typeof ratePlanSchema>, unknown, z.output<typeof ratePlanSchema>>({ resolver: zodResolver(ratePlanSchema), defaultValues: plan ? planToForm(plan) : blankPlan });
  const rules = useFieldArray({ control: form.control, name: 'rules' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState({ entry_at: '', exit_at: '', extra_free_mins: 0 });
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState('');
  const mode = form.watch('mode');
  const { errors } = form.formState;

  const save = form.handleSubmit(async values => {
    setBusy(true); setError('');
    try {
      await apiWrite.json(plan ? `/api/rate-plans/${plan.group_id}` : '/api/rate-plans', {
        method: plan ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la tarifa'); }
    finally { setBusy(false); }
  }, () => setError('Revisa los campos marcados'));

  const simulate = async () => {
    setSimError(''); setSimResult(null);
    const parsedPlan = ratePlanSchema.safeParse(form.getValues());
    const parsedSim = quoteSimulationSchema.safeParse(simulation);
    if (!parsedPlan.success) return setSimError('Completa la tarifa correctamente para simular');
    if (!parsedSim.success) return setSimError(parsedSim.error.issues[0]?.message || 'Indica entrada y salida');
    try {
      const body = await apiWrite.json<{ result: SimulationResult }>('/api/rate-plans/simulate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: parsedPlan.data, simulation: parsedSim.data }),
      });
      setSimResult(body.result);
    } catch (e) { setSimError(e instanceof Error ? e.message : 'No se pudo simular'); }
  };

  const numberField = (name: string, label: string, hint?: string, id = `plan-${name}`) => (
    <Field label={label} htmlFor={id} hint={hint} error={(errors as Record<string, { message?: string }>)[name]?.message}>
      <Input id={id} type="number" inputMode="numeric" min={0} {...form.register(name as 'grace_mins')} />
    </Field>
  );

  return (
    <Sheet open onClose={() => { if (!busy) onClose(); }} title={plan ? `Editar tarifa (nueva versión v${plan.version + 1})` : 'Nueva tarifa'} dismissible={!busy}
      footer={<div className="flex gap-3"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="brand" fullWidth loading={busy} onClick={save}>{plan ? 'Guardar nueva versión' : 'Crear tarifa'}</Button></div>}>
      <form noValidate onSubmit={save} className="space-y-5">
        {plan && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Guardar crea una nueva versión. Los tickets que ya entraron conservan la tarifa con la que ingresaron.</p>}
        <Field label="Nombre" htmlFor="plan-name" error={errors.name?.message}><Input id="plan-name" invalid={Boolean(errors.name)} {...form.register('name')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de vehículo" htmlFor="plan-vehicle"><Select id="plan-vehicle" {...form.register('vehicle_type')}>{planVehicleTypes.map(type => <option key={type} value={type}>{type === 'all' ? 'Todos' : vehicleTypeLabels[type]}</option>)}</Select></Field>
          <Field label="Modalidad de cobro" htmlFor="plan-mode"><Select id="plan-mode" {...form.register('mode')}>{pricingModes.map(item => <option key={item} value={item}>{modeLabels[item]}</option>)}</Select></Field>
          {numberField('grace_mins', 'Minutos de gracia', 'Se descuentan del inicio de la estadía')}
          {numberField('daily_cap', 'Tope diario ($)', 'Opcional. Por día calendario local')}
          {mode === 'elapsed_blocks' && <>
            {numberField('first_block_minutes', 'Primer tramo (min)', 'Mínimo legal: 30')}
            {numberField('block_minutes', 'Tramos siguientes (min)', 'Mínimo legal: 10')}
          </>}
          <Field label="Vigente desde" htmlFor="plan-from"><Input id="plan-from" type="date" {...form.register('valid_from')} /></Field>
          <Field label="Vigente hasta" htmlFor="plan-to"><Input id="plan-to" type="date" {...form.register('valid_to')} /></Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-slate-900">Reglas de precio</legend>
          <p className="text-xs text-slate-600">Las reglas deben cubrir las 24 horas de todos los días. Si dos reglas coinciden, gana la de mayor prioridad.</p>
          {rules.fields.map((field, index) => {
            const weekdays = form.watch(`rules.${index}.weekdays`) as number[] | null;
            const ruleErrors = errors.rules?.[index];
            return (
              <div key={field.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Regla {index + 1}</p>
                  {rules.fields.length > 1 && <Button variant="ghost" size="sm" aria-label={`Quitar regla ${index + 1}`} onClick={() => rules.remove(index)} icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}>Quitar</Button>}
                </div>
                <div role="group" aria-label={`Días de la regla ${index + 1}`} className="flex flex-wrap gap-2">
                  {WEEKDAYS.map(([day, label]) => {
                    const active = weekdays === null || weekdays.includes(day);
                    return <button key={day} type="button" aria-pressed={active} onClick={() => {
                      const current = weekdays ?? [1, 2, 3, 4, 5, 6, 7];
                      const next = current.includes(day) ? current.filter(item => item !== day) : [...current, day].sort();
                      form.setValue(`rules.${index}.weekdays`, next.length === 7 || next.length === 0 ? null : next);
                    }} className={`min-h-11 min-w-11 rounded-lg border px-2 text-xs font-bold ${active ? 'border-indigo-700 bg-indigo-50 text-indigo-900' : 'border-slate-300 bg-white text-slate-700'}`}>{label}</button>;
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Desde" htmlFor={`rule-${index}-from`} error={ruleErrors?.from?.message}><Input id={`rule-${index}-from`} placeholder="00:00" {...form.register(`rules.${index}.from`)} /></Field>
                  <Field label="Hasta" htmlFor={`rule-${index}-to`} error={ruleErrors?.to?.message}><Input id={`rule-${index}-to`} placeholder="24:00" {...form.register(`rules.${index}.to`)} /></Field>
                  {mode === 'per_minute'
                    ? <Field label="$ por minuto" htmlFor={`rule-${index}-ppm`} error={ruleErrors?.price_per_minute?.message}><Input id={`rule-${index}-ppm`} type="number" min={0} {...form.register(`rules.${index}.price_per_minute`)} /></Field>
                    : <>
                      <Field label="$ primer tramo" htmlFor={`rule-${index}-fbp`}><Input id={`rule-${index}-fbp`} type="number" min={0} {...form.register(`rules.${index}.first_block_price`)} /></Field>
                      <Field label="$ cada tramo" htmlFor={`rule-${index}-bp`}><Input id={`rule-${index}-bp`} type="number" min={0} {...form.register(`rules.${index}.block_price`)} /></Field>
                    </>}
                  <Field label="Prioridad" htmlFor={`rule-${index}-priority`}><Input id={`rule-${index}-priority`} type="number" min={0} {...form.register(`rules.${index}.priority`)} /></Field>
                </div>
              </div>
            );
          })}
          {errors.rules?.message && <p role="alert" className="text-xs font-medium text-red-800">{errors.rules.message}</p>}
          <Button variant="secondary" size="sm" onClick={() => rules.append({ ...emptyRule, priority: 1 })} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>Agregar regla</Button>
        </fieldset>

        {plan && <Field label="Motivo del cambio" htmlFor="plan-note" hint="Queda en el historial de versiones"><Textarea id="plan-note" rows={2} {...form.register('change_note')} /></Field>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}

        <fieldset className="space-y-3 rounded-xl bg-slate-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-900">Simulador</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Entrada" htmlFor="sim-entry"><Input id="sim-entry" type="datetime-local" value={simulation.entry_at} onChange={event => setSimulation({ ...simulation, entry_at: event.target.value })} /></Field>
            <Field label="Salida" htmlFor="sim-exit"><Input id="sim-exit" type="datetime-local" value={simulation.exit_at} onChange={event => setSimulation({ ...simulation, exit_at: event.target.value })} /></Field>
            <Field label="Min. gratis extra" htmlFor="sim-free"><Input id="sim-free" type="number" min={0} value={simulation.extra_free_mins} onChange={event => setSimulation({ ...simulation, extra_free_mins: Number(event.target.value) })} /></Field>
          </div>
          <Button variant="secondary" size="sm" onClick={simulate}>Simular cobro</Button>
          {simError && <p role="alert" className="text-sm font-medium text-red-800">{simError}</p>}
          {simResult && (
            <div role="status" className="space-y-1 text-sm">
              <p className="text-2xl font-bold tabular-nums">{money(simResult.subtotal)}</p>
              <p className="text-slate-700">{simResult.durationMins} min de estadía · {simResult.billableMins} min cobrables</p>
              <ul className="list-disc pl-5 text-slate-700">{simResult.lines.map((line, index) => <li key={index}>{line.label || line.description || 'Tramo'}: {money(line.amount)}</li>)}</ul>
            </div>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}

function VersionHistory({ plan }: { plan: Plan }) {
  const query = useQuery({ queryKey: ['rate-plan-versions', plan.group_id], queryFn: ({ signal }) => apiFetchJson<{ versions: Array<{ id: number; version: number; status: string; change_note: string | null; created_at: string }> }>(`/api/rate-plans/${plan.group_id}/versions`, { signal }) });
  if (query.isLoading) return <LoadingState />;
  return (
    <ul className="space-y-1 text-xs text-slate-700">
      {(query.data?.versions ?? []).map(item => (
        <li key={item.id}>v{item.version} · {item.status === 'active' ? 'vigente' : 'archivada'} · {new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('es-CL')}{item.change_note ? ` · ${item.change_note}` : ''}</li>
      ))}
    </ul>
  );
}

function RatePlansSection() {
  const queryClient = useQueryClient();
  const apiWrite = useApiMutation('features/pricing/pages/TariffsPanel');
  const query = useQuery({ queryKey: ['rate-plans'], queryFn: ({ signal }) => apiFetchJson<{ plans: Plan[] }>('/api/rate-plans', { signal }) });
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [showHistory, setShowHistory] = useState<number | null>(null);
  const [error, setError] = useState('');
  const plans = query.data?.plans ?? [];

  const archive = async (plan: Plan) => {
    setError('');
    try {
      await apiWrite.json(`/api/rate-plans/${plan.group_id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: ['rate-plans'] });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo archivar la tarifa'); }
  };

  return (
    <section aria-labelledby="rate-plans-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="rate-plans-title" className="text-lg font-bold text-slate-900">Tarifas</h2><p className="text-sm text-slate-600">Cobro por minuto efectivo o por tramos vencidos, según la Ley 20.967.</p></div>
        <Button variant="brand" onClick={() => setEditing('new')} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>Nueva tarifa</Button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      {query.isLoading ? <LoadingState /> : query.error ? <p role="alert" className="text-sm text-red-800">{query.error.message}</p> : plans.length === 0 ? <EmptyState title="Aún no hay tarifas" description="Crea la primera tarifa para empezar a cobrar." /> : (
        <ul className="space-y-3">
          {plans.map(plan => (
            <li key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{plan.name} <span className="text-xs font-semibold text-slate-600">v{plan.version}</span></p>
                  <p className="text-sm text-slate-700">{describePlan(plan)} · gracia {plan.grace_mins} min{plan.daily_cap ? ` · tope diario ${money(plan.daily_cap)}` : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-2"><Badge>{modeLabels[plan.mode]}</Badge><Badge>{plan.vehicle_type === 'all' ? 'Todos los vehículos' : vehicleTypeLabels[plan.vehicle_type]}</Badge><Badge>{plan.branch_id ? 'Una sucursal' : 'Todas las sucursales'}</Badge></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(plan)}>Editar</Button>
                  <Button variant="ghost" size="sm" aria-expanded={showHistory === plan.group_id} onClick={() => setShowHistory(showHistory === plan.group_id ? null : plan.group_id)}>Historial</Button>
                  {plans.length > 1 && <Button variant="ghost" size="sm" onClick={() => archive(plan)}>Archivar</Button>}
                </div>
              </div>
              {showHistory === plan.group_id && <div className="mt-3 border-t border-slate-100 pt-3"><VersionHistory plan={plan} /></div>}
            </li>
          ))}
        </ul>
      )}
      {editing && <PlanEditor plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: ['rate-plans'] }); void queryClient.invalidateQueries({ queryKey: ['rate-plan-versions'] }); }} />}
    </section>
  );
}

// ------------------------------------------------------------------ convenios
function AgreementEditor({ agreement, onClose, onSaved }: { agreement: Agreement | null; onClose: () => void; onSaved: () => void }) {
  const apiWrite = useApiMutation('features/pricing/pages/TariffsPanel');
  const form = useForm({
    resolver: zodResolver(agreementSchema),
    defaultValues: agreement
      ? { name: agreement.name, code: agreement.code, kind: agreement.kind as typeof agreementKinds[number], value: agreement.value, cap_amount: agreement.cap_amount, branch_id: agreement.branch_id, status: agreement.status, notes: agreement.notes ?? '' }
      : { name: '', code: '', kind: 'free_minutes' as const, value: 30, cap_amount: null, branch_id: null, status: 'active' as const, notes: '' },
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors } = form.formState;
  const kind = form.watch('kind');
  const save = form.handleSubmit(async values => {
    setBusy(true); setError('');
    try {
      await apiWrite.json(agreement ? `/api/agreements/${agreement.id}` : '/api/agreements', {
        method: agreement ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el convenio'); }
    finally { setBusy(false); }
  });
  return (
    <Sheet open onClose={() => { if (!busy) onClose(); }} title={agreement ? 'Editar convenio' : 'Nuevo convenio'} dismissible={!busy}
      footer={<div className="flex gap-3"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button variant="brand" fullWidth loading={busy} onClick={save}>Guardar</Button></div>}>
      <form noValidate onSubmit={save} className="space-y-4">
        <Field label="Comercio" htmlFor="agr-name" error={errors.name?.message}><Input id="agr-name" invalid={Boolean(errors.name)} {...form.register('name')} /></Field>
        <Field label="Código" htmlFor="agr-code" error={errors.code?.message} hint="El comercio lo usa en la página /validar. Debe ser único."><Input id="agr-code" className="uppercase" invalid={Boolean(errors.code)} {...form.register('code')} /></Field>
        <Field label="Beneficio" htmlFor="agr-kind"><Select id="agr-kind" {...form.register('kind')}>{agreementKinds.map(item => <option key={item} value={item}>{agreementKindLabels[item]}</option>)}</Select></Field>
        <Field label={kind === 'free_minutes' ? 'Minutos gratis' : kind === 'percent' ? 'Porcentaje (%)' : 'Monto ($)'} htmlFor="agr-value" error={errors.value?.message}><Input id="agr-value" type="number" min={1} invalid={Boolean(errors.value)} {...form.register('value')} /></Field>
        {kind !== 'free_minutes' && <Field label="Tope del descuento ($)" htmlFor="agr-cap" hint="Opcional" error={errors.cap_amount?.message}><Input id="agr-cap" type="number" min={1} {...form.register('cap_amount')} /></Field>}
        <Field label="Estado" htmlFor="agr-status"><Select id="agr-status" {...form.register('status')}><option value="active">Activo</option><option value="inactive">Inactivo</option></Select></Field>
        <Field label="Notas" htmlFor="agr-notes"><Textarea id="agr-notes" rows={2} {...form.register('notes')} /></Field>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
      </form>
    </Sheet>
  );
}

function AgreementsSection() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['agreements', 'admin'], queryFn: ({ signal }) => apiFetchJson<{ agreements: Agreement[] }>('/api/agreements', { signal }) });
  const [editing, setEditing] = useState<Agreement | 'new' | null>(null);
  const agreements = query.data?.agreements ?? [];
  const benefit = (item: Agreement) => item.kind === 'free_minutes' ? `${item.value} min gratis` : item.kind === 'percent' ? `${item.value}% de descuento` : `${money(item.value)} de descuento`;
  return (
    <section aria-labelledby="agreements-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="agreements-title" className="text-lg font-bold text-slate-900">Convenios con comercios</h2><p className="text-sm text-slate-600">Los comercios validan el ticket de sus clientes en <strong>/validar</strong> con su código.</p></div>
        <Button variant="brand" onClick={() => setEditing('new')} icon={<Plus aria-hidden="true" className="h-4 w-4" />}>Nuevo convenio</Button>
      </div>
      {query.isLoading ? <LoadingState /> : agreements.length === 0 ? <EmptyState title="Sin convenios" description="Crea un convenio para ofrecer minutos gratis o descuentos a comercios aliados." /> : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {agreements.map(item => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="font-bold text-slate-900">{item.name} <span className="font-mono text-xs font-semibold text-slate-600">{item.code}</span></p><p className="text-sm text-slate-700">{benefit(item)} · {item.validations_count} validaciones</p></div>
              <div className="flex items-center gap-2"><Badge tone={item.status === 'active' ? 'success' : 'neutral'}>{item.status === 'active' ? 'Activo' : 'Inactivo'}</Badge><Button variant="secondary" size="sm" onClick={() => setEditing(item)}>Editar</Button></div>
            </li>
          ))}
        </ul>
      )}
      {editing && <AgreementEditor agreement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: ['agreements'] }); }} />}
    </section>
  );
}

export default function TariffsPanel() {
  return <div className="space-y-10"><RatePlansSection /><AgreementsSection /></div>;
}
