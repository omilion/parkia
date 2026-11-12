import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { bankMovementFormSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';

export default function EditBankMovementDialog() {
  const { closeMovementDrawer, editingMovement, handleMarkMovementPartial, handleUpdateMovement, isUpdatingMovement } = useFinance();
  const form = useForm({
    resolver: zodResolver(bankMovementFormSchema),
    defaultValues: {
      date: editingMovement?.date ?? '',
      description: editingMovement?.description ?? '',
      rut: editingMovement?.rut ?? '',
      amount: editingMovement?.amount ?? '',
      notes: editingMovement?.notes ?? '',
    },
  });
  const { errors } = form.formState;
  return (<Drawer
        isOpen={Boolean(editingMovement)}
        onClose={closeMovementDrawer}
        title="Editar Movimiento Bancario"
      >
        {editingMovement && (
          <form noValidate onSubmit={form.handleSubmit(handleUpdateMovement)} className="space-y-6">
            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Pendiente de revisión</p>
              <p className="text-sm text-amber-800 mt-1">Ajusta los datos de cartola o deja una nota para retomarlo antes de conciliar.</p>
            </div>

            <div>
              <label htmlFor="movement-date" className={formLabelClass}>Fecha</label>
              <input id="movement-date" type="date" aria-invalid={errors.date ? true : undefined} {...form.register('date')} className={formInputClass} />
              <FieldError error={errors.date} />
            </div>

            <div>
              <label htmlFor="movement-description" className={formLabelClass}>Descripción / Glosa</label>
              <input id="movement-description" type="text" aria-invalid={errors.description ? true : undefined} {...form.register('description')} className={formInputClass} />
              <FieldError error={errors.description} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="movement-rut" className={formLabelClass}>RUT</label>
                <input id="movement-rut" type="text" aria-invalid={errors.rut ? true : undefined} {...form.register('rut')} className={formInputClass} />
                <FieldError error={errors.rut} />
              </div>
              <div>
                <label htmlFor="movement-amount" className={formLabelClass}>Monto</label>
                <input id="movement-amount" type="number" inputMode="numeric" min="1" step="1" aria-invalid={errors.amount ? true : undefined} {...form.register('amount')} className={formInputClass} />
                <FieldError error={errors.amount} />
              </div>
            </div>

            <div>
              <label htmlFor="movement-notes" className={formLabelClass}>Nota de revisión</label>
              <textarea id="movement-notes"
                rows={5}
                {...form.register('notes')}
                placeholder="Ej: Falta identificar pagador, posible pago parcial, RUT no coincide con contrato..."
                className={`${formInputClass} resize-none`}
              />
            </div>

            <div className="pt-6 border-t border-slate-100 flex flex-wrap gap-4">
              <button type="button" onClick={closeMovementDrawer} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              {editingMovement.status !== 'partial' && (
                <button type="button" onClick={() => handleMarkMovementPartial(String(form.getValues('notes') ?? ''))} disabled={isUpdatingMovement} className="flex-[1.5] py-4 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50">
                  Marcar Parcial
                </button>
              )}
              <button type="submit" disabled={isUpdatingMovement} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
                {isUpdatingMovement ? 'Guardando...' : 'Guardar Movimiento'}
              </button>
            </div>
          </form>
        )}
      </Drawer>);
}
