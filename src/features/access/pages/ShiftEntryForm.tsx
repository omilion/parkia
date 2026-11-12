import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError, formLabelClass } from '../../../ui';
import { shiftEntryFieldsSchema } from '../../../../shared/schemas/access';
import { shiftEntryCategoryLabels, shiftPriorityLabels } from './accessShared';
import { useAccess } from './AccessContext';

const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-base md:text-sm outline-none focus:border-slate-900 aria-[invalid=true]:border-red-500';

/** Registro de una novedad en el turno abierto. */
export default function ShiftEntryForm() {
  const { handleCreateShiftEntry, isActionLoading, setShiftEvidenceName, shiftEvidenceName, spaces } = useAccess();
  const [evidence, setEvidence] = useState<File | null>(null);
  const form = useForm({
    resolver: zodResolver(shiftEntryFieldsSchema),
    defaultValues: { category: 'incident' as const, priority: 'medium' as const, related_space_id: '', title: '', detail: '', follow_up_required: false },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Registrar novedad"
      onSubmit={form.handleSubmit(async values => {
        if (await handleCreateShiftEntry(values, evidence)) {
          form.reset();
          setEvidence(null);
        }
      })}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label htmlFor="shift-entry-category" className={formLabelClass}>Categoría</label>
          <select id="shift-entry-category" {...form.register('category')} className={inputClass}>
            {Object.entries(shiftEntryCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="shift-entry-priority" className={formLabelClass}>Prioridad</label>
          <select id="shift-entry-priority" {...form.register('priority')} className={inputClass}>
            {Object.entries(shiftPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="shift-entry-space" className={formLabelClass}>Espacio relacionado</label>
          <select id="shift-entry-space" {...form.register('related_space_id')} className={inputClass}>
            <option value="">Sin espacio</option>
            {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <label htmlFor="shift-entry-title" className={formLabelClass}>Título</label>
          <input id="shift-entry-title" aria-invalid={errors.title ? true : undefined} {...form.register('title')} placeholder="Ej: Visita sin pase QR requiere validación" className={inputClass} />
          <FieldError error={errors.title} />
        </div>
        <div className="md:col-span-3">
          <label htmlFor="shift-entry-detail" className={formLabelClass}>Detalle operativo</label>
          <textarea id="shift-entry-detail" rows={3} {...form.register('detail')} placeholder="Qué pasó, quién fue avisado, patente/RUT si aplica y qué queda pendiente." className={inputClass} />
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 md:min-w-[280px] cursor-pointer hover:bg-white focus-within:border-slate-900">
          <span className="truncate">{shiftEvidenceName || 'Adjuntar evidencia opcional'}</span>
          <span className="text-xs text-slate-600">PDF/JPG/PNG</span>
          <input
            type="file"
            aria-label="Adjuntar evidencia opcional"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] || null;
              setEvidence(file);
              setShiftEvidenceName(file?.name || '');
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" {...form.register('follow_up_required')} className="w-4 h-4 accent-slate-900" />
          Requiere seguimiento
        </label>
        <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
          <Plus className="w-4 h-4" aria-hidden="true" /> Registrar Novedad
        </button>
      </div>
    </form>
  );
}
