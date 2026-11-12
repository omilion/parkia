import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError, formLabelClass } from '../../../ui';
import { closeShiftFormSchema } from '../../../../shared/schemas/access';
import { formatCurrency, shiftEntryCategoryLabels, shiftPriorityLabels } from './accessShared';
import { useAccess } from './AccessContext';

const checklistItems = [
  'Visitas dentro del recinto revisadas',
  'Seguimientos pendientes identificados',
  'Barrera vehicular y puerta peatonal verificadas',
  'Incidentes críticos traspasados',
];
const emptyHandoverRow = { title: '', detail: '', category: 'handover' as const, priority: 'medium' as const, related_space_id: '' };
const rowInput = 'min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-2 text-base md:text-xs outline-none focus:border-slate-900 aria-[invalid=true]:border-red-500';
const boxInput = 'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm outline-none focus:border-slate-900 aria-[invalid=true]:border-red-500';

/** Cierre y traspaso del turno abierto, con cuadratura de caja. */
export default function ShiftCloseForm() {
  const { cashSummary, handleCloseShift, isActionLoading, spaces } = useAccess();
  const form = useForm({
    resolver: zodResolver(closeShiftFormSchema),
    defaultValues: {
      checklist: checklistItems.map(() => false),
      handover_items: [0, 1, 2].map(() => ({ ...emptyHandoverRow })),
      handover_notes: '',
      counted_cash: cashSummary?.expectedCash || 0,
      counted_transfer: cashSummary?.totals.transfer || 0,
      counted_card: cashSummary?.totals.card || 0,
      cash_count_note: '',
    },
  });
  const { errors } = form.formState;
  const rowErrors = errors.handover_items as unknown as Array<{ title?: { message?: string } } | undefined> | undefined;
  return (
    <form
      noValidate
      aria-label="Cerrar y traspasar turno"
      onSubmit={form.handleSubmit(async ({ checklist: _checklist, ...payload }) => {
        if (await handleCloseShift({ ...payload, handover_items: payload.handover_items ?? [] })) form.reset();
      })}
      className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
    >
      <div>
        <h3 className="text-lg font-bold">Cerrar y traspasar turno</h3>
        <p className="text-sm text-slate-600">Deja instrucciones concretas para quien recibe.</p>
      </div>
      <fieldset>
        <legend className="sr-only">Verificaciones antes de cerrar</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {checklistItems.map((item, index) => (
            <label key={item} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <input type="checkbox" {...form.register(`checklist.${index}` as const)} className="w-4 h-4 accent-slate-900" />
              {item}
            </label>
          ))}
        </div>
        {/* En listas, react-hook-form deja el error del conjunto en `root`. */}
        <FieldError error={(errors.checklist as { root?: { message?: string }; message?: string } | undefined)?.root ?? (errors.checklist as { message?: string } | undefined)} />
      </fieldset>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pendientes estructurados para traspaso</p>
          <p className="text-xs text-slate-600 mt-1">Cada fila con título crea una novedad pendiente y una tarea operacional.</p>
        </div>
        {[0, 1, 2].map(index => (
          <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input aria-label={`Pendiente ${index + 1}`}
                aria-invalid={rowErrors?.[index]?.title ? true : undefined}
                {...form.register(`handover_items.${index}.title` as const)}
                placeholder={`Pendiente ${index + 1}`}
                className={`md:col-span-4 ${rowInput}`}
              />
              <select aria-label={`Categoría del pendiente ${index + 1}`} {...form.register(`handover_items.${index}.category` as const)} className={`md:col-span-2 ${rowInput} px-2`}>
                {Object.entries(shiftEntryCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select aria-label={`Prioridad del pendiente ${index + 1}`} {...form.register(`handover_items.${index}.priority` as const)} className={`md:col-span-2 ${rowInput} px-2`}>
                {Object.entries(shiftPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select aria-label={`Espacio del pendiente ${index + 1}`} {...form.register(`handover_items.${index}.related_space_id` as const)} className={`md:col-span-2 ${rowInput} px-2`}>
                <option value="">Sin espacio</option>
                {spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
              </select>
              <input aria-label={`Acción esperada del pendiente ${index + 1}`}
                {...form.register(`handover_items.${index}.detail` as const)}
                placeholder="Acción esperada"
                className={`md:col-span-2 ${rowInput}`}
              />
            </div>
            <FieldError error={rowErrors?.[index]?.title} />
          </div>
        ))}
      </div>
      <div>
        <label htmlFor="shift-close-notes" className={formLabelClass}>Resumen de traspaso</label>
        <textarea id="shift-close-notes" aria-invalid={errors.handover_notes ? true : undefined} {...form.register('handover_notes')} rows={4} placeholder="Resumen de incidentes, visitas aún dentro, barreras/cámaras a vigilar y pendientes abiertos." className={`${boxInput} bg-slate-50`} />
        <FieldError error={errors.handover_notes} />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Cierre de caja</p>
          <p className="text-xs text-slate-600 mt-1">Efectivo esperado: {formatCurrency(cashSummary?.expectedCash)}.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([['counted_cash', 'Efectivo contado'], ['counted_transfer', 'Transferencias'], ['counted_card', 'Tarjetas']] as const).map(([name, label]) => (
            <div key={name}>
              <label htmlFor={`shift-close-${name}`} className={formLabelClass}>{label}</label>
              <input id={`shift-close-${name}`} type="number" inputMode="numeric" min={0} aria-invalid={errors[name] ? true : undefined} {...form.register(name)} className={boxInput} />
              <FieldError error={errors[name]} />
            </div>
          ))}
        </div>
        <input aria-label="Observación de cuadratura, diferencias o voucher faltante" {...form.register('cash_count_note')} placeholder="Observación de cuadratura, diferencias o voucher faltante" className={boxInput} />
      </div>
      <button type="submit" disabled={isActionLoading} className="px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
        Cerrar Turno
      </button>
    </form>
  );
}
