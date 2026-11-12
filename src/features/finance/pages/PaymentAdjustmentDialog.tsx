import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { paymentAdjustmentSchema } from '../../../../shared/schemas/finance';
import { useFinance } from './FinanceContext';

export default function PaymentAdjustmentDialog() {
  const { adjustmentPayment, closeAdjustmentDrawer, handleCreatePaymentAdjustment, isSavingAdjustment } = useFinance();
  const form = useForm({
    resolver: zodResolver(paymentAdjustmentSchema),
    defaultValues: { type: 'discount' as const, amount: '', reason: '' },
  });
  const { errors } = form.formState;
  return (<Drawer
        isOpen={Boolean(adjustmentPayment)}
        onClose={closeAdjustmentDrawer}
        title="Ajuste Financiero"
      >
        {adjustmentPayment && (
          <form noValidate onSubmit={form.handleSubmit(handleCreatePaymentAdjustment)} className="space-y-6">
            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Cuenta por cobrar</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{adjustmentPayment.client_name}</p>
              <p className="text-sm text-slate-600">Monto actual ${adjustmentPayment.amount.toLocaleString()} · Saldo ${Number(adjustmentPayment.remaining_amount ?? adjustmentPayment.amount).toLocaleString()}</p>
            </div>
            <div>
              <label htmlFor="adjustment-type" className={formLabelClass}>Tipo</label>
              <select id="adjustment-type" {...form.register('type')} className={formInputClass}>
                <option value="discount">Descuento</option>
                <option value="waiver">Condonación</option>
                <option value="fee">Multa / recargo</option>
              </select>
            </div>
            <div>
              <label htmlFor="adjustment-amount" className={formLabelClass}>Monto</label>
              <input id="adjustment-amount" type="number" inputMode="numeric" min="1" step="1" aria-invalid={errors.amount ? true : undefined} {...form.register('amount')} className={formInputClass} />
              <FieldError error={errors.amount} />
            </div>
            <div>
              <label htmlFor="adjustment-reason" className={formLabelClass}>Motivo obligatorio</label>
              <textarea id="adjustment-reason" rows={4} aria-invalid={errors.reason ? true : undefined} {...form.register('reason')} placeholder="Ej: Descuento autorizado por administración por ajuste comercial documentado." className={`${formInputClass} resize-none`} />
              <FieldError error={errors.reason} />
            </div>
            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeAdjustmentDrawer} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isSavingAdjustment} className="flex-[2] py-4 bg-amber-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-amber-100 hover:bg-amber-700 transition-all disabled:opacity-50">
                {isSavingAdjustment ? 'Guardando...' : 'Registrar Ajuste'}
              </button>
            </div>
          </form>
        )}
      </Drawer>);
}
