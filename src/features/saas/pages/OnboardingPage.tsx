import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { onboardingBranchSchema } from '../../../../shared/schemas/saas';
import { importSpacesSchema } from '../../../../shared/schemas/spaces';
import { createStaffFormSchema, type CreateStaffFormValues } from '../../../../shared/schemas/staff';
import { ticketEntrySchema, type TicketEntryValues } from '../../../../shared/schemas/tickets';
import { apiFetchJson } from '../../../lib/api';
import { useApiMutation } from '../../../lib/useApiMutation';
import { FieldError } from '../../../ui/FieldError';
import { z } from 'zod';

type OnboardingStepKey = 'branch' | 'spaces' | 'rate_plan' | 'staff' | 'test_ticket';

export type OnboardingStatusResponse = {
  steps: {
    branch: { done: boolean; count: number; first_branch: Record<string, any> | null };
    spaces: { done: boolean; count: number };
    rate_plan: { done: boolean; count: number };
    staff: { done: boolean; count: number; skipped: boolean };
    test_ticket: { done: boolean; count: number };
  };
  completed: boolean;
  dismissed: boolean;
  next_step: OnboardingStepKey | null;
};

const stepOrder: Array<{ key: OnboardingStepKey; label: string }> = [
  { key: 'branch', label: '1. Sucursal' },
  { key: 'spaces', label: '2. Plazas' },
  { key: 'rate_plan', label: '3. Tarifa' },
  { key: 'staff', label: '4. Usuarios' },
  { key: 'test_ticket', label: '5. Ticket de prueba' },
];

const quickRateSchema = z.object({
  name: z.string().trim().min(2, 'Ingresa un nombre').max(80),
  price_per_minute: z.coerce.number().int().min(1, 'Ingresa el valor por minuto'),
  grace_mins: z.coerce.number().int().min(0).max(240),
  daily_cap: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().int().min(1).nullable()),
});

const inputClass =
  'w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-indigo-500';
const labelClass = 'block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1';

export default function OnboardingPage() {
  const queryClient = useQueryClient();
  const apiWrite = useApiMutation('OnboardingPage.tsx');
  const [activeStep, setActiveStep] = useState<OnboardingStepKey>('branch');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: ({ signal }) => apiFetchJson<OnboardingStatusResponse>('/api/onboarding/status', { signal }),
  });

  const status = statusQuery.data;

  useEffect(() => {
    if (status?.next_step) {
      setActiveStep(status.next_step);
    }
  }, [status?.next_step]);

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({ queryKey: ['onboarding-status'] });
  };

  // Paso 1: Sucursal
  const branchForm = useForm({
    resolver: zodResolver(onboardingBranchSchema),
    defaultValues: {
      name: '',
      address: '',
      commune: '',
      city: '',
      phone: '',
      timezone: 'America/Santiago',
    },
  });

  useEffect(() => {
    const b = status?.steps.branch.first_branch;
    if (b) {
      branchForm.reset({
        name: b.name || '',
        address: b.address || '',
        commune: b.commune || '',
        city: b.city || '',
        phone: b.phone || '',
        timezone: b.timezone || 'America/Santiago',
      });
    }
  }, [status?.steps.branch.first_branch?.id]);

  const onSaveBranch = branchForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    const branchId = status?.steps.branch.first_branch?.id;
    const url = branchId ? `/api/branches/${branchId}` : '/api/branches';
    const method = branchId ? 'PATCH' : 'POST';
    const payload = branchId
      ? { ...values, reason: 'Configuración inicial de sucursal' }
      : { ...values, code: 'MAIN', status: 'active' };
    const res = await apiWrite.request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data.error || 'No se pudo guardar la sucursal');
      return;
    }
    setFeedback('Sucursal confirmada.');
    await refreshStatus();
    setActiveStep('spaces');
  });

  // Paso 2: Plazas (carga masiva CSV)
  const spacesForm = useForm({
    resolver: zodResolver(importSpacesSchema),
    defaultValues: {
      csv: 'Sucursal,Nombre,Estado,Precio mensual\nCasa Matriz,A-01,Disponible,65000\nCasa Matriz,A-02,Disponible,65000\nCasa Matriz,A-03,Disponible,65000',
    },
  });

  const onImportSpaces = spacesForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    const res = await apiWrite.request('/api/spaces/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: values.csv,
        branch_id: status?.steps.branch.first_branch?.id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data.error || 'No se pudieron importar las plazas');
      return;
    }
    setFeedback(`Plazas importadas: ${data.imported}. Omitidas: ${data.skipped}.`);
    await refreshStatus();
    setActiveStep('rate_plan');
  });

  // Paso 3: Tarifa
  const rateForm = useForm({
    resolver: zodResolver(quickRateSchema),
    defaultValues: { name: 'Tarifa General', price_per_minute: 40, grace_mins: 10, daily_cap: 15000 },
  });

  const onCreateRate = rateForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    const res = await apiWrite.request('/api/rate-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        branch_id: status?.steps.branch.first_branch?.id ?? null,
        vehicle_type: 'all',
        mode: 'per_minute',
        grace_mins: values.grace_mins,
        daily_cap: values.daily_cap,
        first_block_minutes: null,
        block_minutes: null,
        rules: [
          {
            weekdays: null,
            from: '00:00',
            to: '24:00',
            priority: 0,
            price_per_minute: values.price_per_minute,
            first_block_price: null,
            block_price: null,
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data.error || 'No se pudo crear la tarifa');
      return;
    }
    setFeedback('Tarifa inicial creada.');
    await refreshStatus();
    setActiveStep('staff');
  });

  // Paso 4: Usuarios
  const staffForm = useForm<CreateStaffFormValues>({
    resolver: zodResolver(createStaffFormSchema) as any,
    defaultValues: { name: '', rut: '', email: '', phone: '', role: 'guard', password: '' },
  });

  const onCreateStaff = staffForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    const res = await apiWrite.request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data.error || 'No se pudo crear el usuario');
      return;
    }
    setFeedback('Usuario agregado.');
    staffForm.reset();
    await refreshStatus();
    setActiveStep('test_ticket');
  });

  const handleSkipStaff = async () => {
    setErrorMsg(null);
    const res = await apiWrite.request('/api/onboarding/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_skipped: true }),
    });
    if (res.ok) {
      await refreshStatus();
      setActiveStep('test_ticket');
    }
  };

  // Paso 5: Primer ticket de prueba
  const ticketForm = useForm<TicketEntryValues>({
    resolver: zodResolver(ticketEntrySchema) as any,
    defaultValues: { plate: 'PRUEBA1', vehicle_type: 'car' },
  });

  const onCreateTicket = ticketForm.handleSubmit(async (values) => {
    setErrorMsg(null);
    setFeedback(null);
    const res = await apiWrite.request('/api/visitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        branch_id: status?.steps.branch.first_branch?.id,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(data.error || 'No se pudo registrar el ticket de prueba');
      return;
    }
    setFeedback('¡Primer ticket registrado! Tu estacionamiento ya está listo para operar.');
    await refreshStatus();
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Asistente de inicio</p>
          <h1 className="text-2xl font-bold text-slate-900">Configura tu estacionamiento</h1>
          <p className="mt-1 text-sm text-slate-600">
            Avanza paso a paso. Si sales, podrás retomar exactamente donde quedaste.
          </p>
        </div>
        <Link
          to="/"
          className="min-h-11 inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Volver al inicio
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stepOrder.map((step) => {
          const done = status?.steps[step.key].done;
          const isCurrent = activeStep === step.key;
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => setActiveStep(step.key)}
              className={`min-h-11 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition-colors ${
                isCurrent
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                  : done
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" /> : <Circle className="h-4 w-4 shrink-0" />}
              <span className="truncate">{step.label}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {activeStep === 'branch' && (
          <form onSubmit={onSaveBranch} noValidate className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Paso 1: Confirma tu sucursal</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ob-branch-name" className={labelClass}>Nombre sucursal</label>
                <input id="ob-branch-name" type="text" {...branchForm.register('name')} className={inputClass} />
                <FieldError error={branchForm.formState.errors.name} />
              </div>
              <div>
                <label htmlFor="ob-branch-tz" className={labelClass}>Zona horaria</label>
                <input id="ob-branch-tz" type="text" {...branchForm.register('timezone')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="ob-branch-address" className={labelClass}>Dirección</label>
                <input id="ob-branch-address" type="text" {...branchForm.register('address')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="ob-branch-commune" className={labelClass}>Comuna</label>
                <input id="ob-branch-commune" type="text" {...branchForm.register('commune')} className={inputClass} />
              </div>
            </div>
            <button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
              Guardar y continuar
            </button>
          </form>
        )}

        {activeStep === 'spaces' && (
          <form onSubmit={onImportSpaces} noValidate className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">Paso 2: Carga masiva de plazas</h2>
              <a
                href="/api/import/templates/spaces.csv"
                className="text-xs font-bold text-indigo-700 hover:underline"
              >
                Descargar plantilla CSV
              </a>
            </div>
            <p className="text-sm text-slate-600">
              Pega o edita el listado CSV de tus plazas (columnas: Sucursal, Nombre, Estado, Precio mensual).
            </p>
            <div>
              <label htmlFor="ob-spaces-csv" className={labelClass}>Contenido CSV de plazas</label>
              <textarea id="ob-spaces-csv" rows={6} {...spacesForm.register('csv')} className={inputClass} />
              <FieldError error={spacesForm.formState.errors.csv} />
            </div>
            <button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
              Importar plazas y continuar
            </button>
          </form>
        )}

        {activeStep === 'rate_plan' && (
          <form onSubmit={onCreateRate} noValidate className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Paso 3: Define tu tarifa de visitas</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ob-rate-name" className={labelClass}>Nombre tarifa</label>
                <input id="ob-rate-name" type="text" {...rateForm.register('name')} className={inputClass} />
                <FieldError error={rateForm.formState.errors.name} />
              </div>
              <div>
                <label htmlFor="ob-rate-ppm" className={labelClass}>Precio por minuto ($ CLP)</label>
                <input id="ob-rate-ppm" type="number" {...rateForm.register('price_per_minute')} className={inputClass} />
                <FieldError error={rateForm.formState.errors.price_per_minute} />
              </div>
              <div>
                <label htmlFor="ob-rate-grace" className={labelClass}>Minutos de gracia</label>
                <input id="ob-rate-grace" type="number" {...rateForm.register('grace_mins')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="ob-rate-cap" className={labelClass}>Tope diario ($ CLP, opcional)</label>
                <input id="ob-rate-cap" type="number" {...rateForm.register('daily_cap')} className={inputClass} />
              </div>
            </div>
            <button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
              Guardar tarifa y continuar
            </button>
          </form>
        )}

        {activeStep === 'staff' && (
          <form onSubmit={onCreateStaff} noValidate className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Paso 4: Agrega a tu equipo</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ob-staff-name" className={labelClass}>Nombre</label>
                <input id="ob-staff-name" type="text" {...staffForm.register('name')} className={inputClass} />
                <FieldError error={staffForm.formState.errors.name} />
              </div>
              <div>
                <label htmlFor="ob-staff-rut" className={labelClass}>RUT</label>
                <input id="ob-staff-rut" type="text" {...staffForm.register('rut')} className={inputClass} />
                <FieldError error={staffForm.formState.errors.rut} />
              </div>
              <div>
                <label htmlFor="ob-staff-email" className={labelClass}>Correo</label>
                <input id="ob-staff-email" type="email" {...staffForm.register('email')} className={inputClass} />
                <FieldError error={staffForm.formState.errors.email} />
              </div>
              <div>
                <label htmlFor="ob-staff-role" className={labelClass}>Rol</label>
                <select id="ob-staff-role" {...staffForm.register('role')} className={inputClass}>
                  <option value="guard">Guardia</option>
                  <option value="cashier">Cajero</option>
                  <option value="finance">Finanzas</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <div>
                <label htmlFor="ob-staff-pass" className={labelClass}>Clave inicial</label>
                <input id="ob-staff-pass" type="password" {...staffForm.register('password')} className={inputClass} />
                <FieldError error={staffForm.formState.errors.password} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="submit" className="min-h-11 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
                Crear usuario y continuar
              </button>
              <button
                type="button"
                onClick={handleSkipStaff}
                className="min-h-11 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Opero solo por ahora
              </button>
            </div>
          </form>
        )}

        {activeStep === 'test_ticket' && (
          <form onSubmit={onCreateTicket} noValidate className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Paso 5: Emite tu primer ticket de prueba</h2>
            <p className="text-sm text-slate-600">
              Registra una patente de prueba para validar la operación de entrada en tu sucursal.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ob-ticket-plate" className={labelClass}>Patente</label>
                <input id="ob-ticket-plate" type="text" {...ticketForm.register('plate')} className={inputClass} />
                <FieldError error={ticketForm.formState.errors.plate} />
              </div>
              <div>
                <label htmlFor="ob-ticket-type" className={labelClass}>Tipo de vehículo</label>
                <select id="ob-ticket-type" {...ticketForm.register('vehicle_type')} className={inputClass}>
                  <option value="car">Auto</option>
                  <option value="moto">Moto</option>
                  <option value="truck">Camioneta</option>
                </select>
              </div>
            </div>
            <button type="submit" className="min-h-11 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
              Registrar primer ticket
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

