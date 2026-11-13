import { Plus } from 'lucide-react';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError, formLabelClass } from '../../../ui';
import { openShiftFormSchema } from '../../../../shared/schemas/access';
import { shiftNameLabels } from './accessShared';
import { useAccess } from './AccessContext';
import { todayLocal } from '../../../../shared/dates';

/** Apertura de bitácora: versión completa (sin turno) o compacta (columna lateral). */
export default function ShiftOpenForm({ variant }: { variant: 'full' | 'compact' }) {
  const { handleOpenShift, isActionLoading } = useAccess();
  const id = useId();
  const form = useForm({
    resolver: zodResolver(openShiftFormSchema),
    defaultValues: { shift_date: todayLocal(), shift_name: 'custom' as const, opening_notes: '' },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit(async values => {
    if (await handleOpenShift(values)) form.reset();
  });

  if (variant === 'compact') {
    const compactInput = 'min-w-0 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-base md:text-xs outline-none';
    return (
      <form noValidate aria-label="Nuevo turno" onSubmit={submit} className="bg-slate-900 text-white rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold">Nuevo turno</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" aria-label="Fecha del nuevo turno" {...form.register('shift_date')} className={compactInput} />
          <select aria-label="Turno del nuevo turno" {...form.register('shift_name')} className={compactInput}>
            {Object.entries(shiftNameLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {errors.shift_date && <p role="alert" className="text-xs font-medium text-red-200">{errors.shift_date.message}</p>}
        <textarea aria-label="Recepción breve..." rows={2} {...form.register('opening_notes')} placeholder="Recepción breve..." className={`w-full ${compactInput} placeholder:text-white/70`} />
        <button type="submit" disabled={isActionLoading} className="w-full py-2 bg-white text-slate-900 rounded-xl text-xs font-bold disabled:opacity-50">
          Abrir Bitácora
        </button>
      </form>
    );
  }

  const fullInput = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm outline-none focus:border-slate-900 aria-[invalid=true]:border-red-500';
  return (
    <form noValidate aria-label="Abrir bitácora de turno" onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="text-lg font-bold">Abrir bitácora de turno</h3>
        <p className="text-sm text-slate-600">Registra el contexto inicial antes de tomar la operación.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${id}-date`} className={formLabelClass}>Fecha</label>
          <input id={`${id}-date`} type="date" aria-invalid={errors.shift_date ? true : undefined} {...form.register('shift_date')} className={fullInput} />
          <FieldError error={errors.shift_date} />
        </div>
        <div>
          <label htmlFor={`${id}-name`} className={formLabelClass}>Turno</label>
          <select id={`${id}-name`} {...form.register('shift_name')} className={fullInput}>
            {Object.entries(shiftNameLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${id}-notes`} className={formLabelClass}>Estado inicial</label>
          <textarea id={`${id}-notes`} rows={3} {...form.register('opening_notes')} placeholder="Ej: Recibo turno con 2 visitas activas, barrera norte operativa, cámara patio con intermitencia." className={fullInput} />
        </div>
      </div>
      <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50">
        <Plus className="w-4 h-4" aria-hidden="true" /> Abrir Turno
      </button>
    </form>
  );
}
