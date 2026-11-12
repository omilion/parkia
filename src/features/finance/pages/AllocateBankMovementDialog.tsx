import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { allocateMovementFieldsSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';

export default function AllocateBankMovementDialog() {
  const { allocationPayment, closeAllocationDrawer, handleAllocateMovement, isAllocating, selectedMovement } = useFinance();
  const maxAmount = allocationPayment && selectedMovement
    ? Math.min(
        Number(selectedMovement.remaining_amount ?? selectedMovement.amount),
        Number(allocationPayment.remaining_amount ?? allocationPayment.amount),
      )
    : 0;
  // El abono no puede superar lo disponible del movimiento ni el saldo del pago.
  const schema = allocateMovementFieldsSchema.extend({
    amount: allocateMovementFieldsSchema.shape.amount.pipe(
      z.number().max(maxAmount, `El abono no puede superar $${maxAmount.toLocaleString('es-CL')}`),
    ),
  });
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { amount: maxAmount, note: '' } });
  const { errors } = form.formState;
  return (<Drawer
        isOpen={Boolean(allocationPayment && selectedMovement)}
        onClose={closeAllocationDrawer}
        title="Aplicar Abono desde Cartola"
      >
        {allocationPayment && selectedMovement && (
          <form noValidate onSubmit={form.handleSubmit(handleAllocateMovement)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900 text-white p-5 rounded-3xl">
                <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Movimiento</p>
                <p className="text-lg font-bold mt-1">${selectedMovement.amount.toLocaleString()}</p>
                <p className="text-xs opacity-70 mt-2">Disponible ${Number(selectedMovement.remaining_amount ?? selectedMovement.amount).toLocaleString()}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-3xl">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Pago</p>
                <p className="text-lg font-bold text-slate-900 mt-1">${allocationPayment.amount.toLocaleString()}</p>
                <p className="text-xs text-emerald-700 mt-2">Saldo ${Number(allocationPayment.remaining_amount ?? allocationPayment.amount).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <label htmlFor="allocation-amount" className={formLabelClass}>Monto del abono</label>
              <input id="allocation-amount"
                type="number"
                inputMode="numeric"
                min="1"
                max={maxAmount}
                step="1"
                aria-invalid={errors.amount ? true : undefined}
                {...form.register('amount')}
                className={formInputClass}
              />
              <FieldError error={errors.amount} />
            </div>

            <div>
              <label htmlFor="allocation-note" className={formLabelClass}>Nota</label>
              <textarea id="allocation-note"
                rows={4}
                aria-invalid={errors.note ? true : undefined}
                {...form.register('note')}
                placeholder="Ej: Abono parcial validado por cartola bancaria"
                className={`${formInputClass} resize-none`}
              />
              <FieldError error={errors.note} />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeAllocationDrawer} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isAllocating} className="flex-[2] py-4 bg-emerald-700 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
                {isAllocating ? 'Aplicando...' : 'Aplicar Abono'}
              </button>
            </div>
          </form>
        )}
      </Drawer>);
}
