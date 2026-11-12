import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { reverseAllocationSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';

export default function ReverseAllocationDialog() {
  const { closeReverseDrawer, handleReverseAllocation, isReversingAllocation, reverseAllocation } = useFinance();
  const form = useForm({ resolver: zodResolver(reverseAllocationSchema), defaultValues: { note: '' } });
  const { errors } = form.formState;
  return (<Drawer
        isOpen={Boolean(reverseAllocation)}
        onClose={closeReverseDrawer}
        title="Reversar Abono"
      >
        {reverseAllocation && (
          <form noValidate onSubmit={form.handleSubmit(handleReverseAllocation)} className="space-y-6">
            <div className="bg-red-50 border border-red-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-red-700 uppercase tracking-wider">Corrección financiera</p>
              <p className="text-sm text-red-800 mt-1">El abono quedará marcado como reversado, se recalcularán los saldos y el registro seguirá visible en el historial.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Monto</p>
                <p className="text-lg font-bold text-slate-900 mt-1">${reverseAllocation.amount.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pago</p>
                <p className="text-lg font-bold text-slate-900 mt-1">#PAG-{reverseAllocation.payment_id.toString().padStart(4, '0')}</p>
              </div>
            </div>

            <div>
              <label htmlFor="reverse-note" className={formLabelClass}>Motivo de reversa</label>
              <textarea id="reverse-note"
                rows={5}
                aria-invalid={errors.note ? true : undefined}
                {...form.register('note')}
                placeholder="Ej: Abono aplicado a cliente equivocado, monto duplicado o conciliación incorrecta."
                className={`${formInputClass} resize-none`}
              />
              <FieldError error={errors.note} />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeReverseDrawer} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isReversingAllocation} className="flex-[2] py-4 bg-red-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-red-100 hover:bg-red-700 transition-all disabled:opacity-50">
                {isReversingAllocation ? 'Reversando...' : 'Reversar Abono'}
              </button>
            </div>
          </form>
        )}
      </Drawer>);
}
