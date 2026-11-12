import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { payVisitorFormSchema } from '../../../../shared/schemas/spaces';
import { cn } from '../../../lib/utils';
import { useSpaces } from './SpacesContext';

function VisitorPaymentForm() {
  const { handlePayVisitor, isActionLoading, setVisitorPayment, user, visitorPayment } = useSpaces();
  const isAdmin = user.role === 'admin';
  const quotedAmount = Number(visitorPayment.amount || 0);
  // Si un administrador cobra menos que la cotización legal, debe dejar el motivo.
  const schema = payVisitorFormSchema.superRefine((values, ctx) => {
    if (Number(values.amount) < quotedAmount && !String(values.override_reason || '').trim()) {
      ctx.addIssue({ code: 'custom', path: ['override_reason'], message: 'Explica por qué se cobra menos que la cotización' });
    }
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { method: (visitorPayment.method || 'cash') as 'cash', amount: quotedAmount, override_reason: '' },
  });
  const { errors } = form.formState;
  return (
          <form noValidate onSubmit={form.handleSubmit(handlePayVisitor)} className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-2xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider mb-1">Patente</p>
              <p className="text-3xl font-bold uppercase tracking-wider">{visitorPayment.plate}</p>
              {visitorPayment.space_name && <p className="mt-1 text-sm font-bold text-white/70">{visitorPayment.space_name}</p>}
              <p className="mt-3 text-xs font-bold text-white/70">Cobro por minuto efectivo, sin redondeo al alza.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Total</p>
                <p className="mt-1 text-lg font-bold text-slate-900">${Number(visitorPayment.total || 0).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Duración</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.duration_minutes} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Gracia</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.grace_period_mins} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Cobrables</p>
                <p className="mt-1 text-lg font-bold text-slate-900">{visitorPayment.billable_mins || 0} min</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Tarifa / min</p>
                <p className="mt-1 text-lg font-bold text-slate-900">${Number(visitorPayment.rate_per_minute || 0).toLocaleString()}</p>
              </div>
            </div>

            <fieldset>
              <legend className={formLabelClass}>Método de Pago</legend>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['cash', 'Efectivo'],
                  ['card', 'Tarjeta'],
                  ['transfer', 'Transferencia'],
                ].map(([value, label]) => (
                  <label key={value} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-sm font-bold text-slate-600 cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-900 has-[:focus-visible]:ring-offset-2">
                    <input type="radio" value={value} {...form.register('method')} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="visitor-pay-amount" className={formLabelClass}>Monto a Cobrar</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600 font-bold" aria-hidden="true">$</span>
                <input
                  id="visitor-pay-amount"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  readOnly={!isAdmin}
                  aria-invalid={errors.amount ? true : undefined}
                  aria-describedby={!isAdmin ? 'visitor-pay-amount-hint' : undefined}
                  {...form.register('amount')}
                  className={cn(formInputClass, 'pl-8', isAdmin ? 'bg-slate-50' : 'bg-slate-100 text-slate-600')}
                />
              </div>
              <FieldError error={errors.amount} />
              {!isAdmin && (
                <p id="visitor-pay-amount-hint" className="mt-2 text-xs text-slate-600">Monto bloqueado por cotización legal vigente.</p>
              )}
            </div>

            {isAdmin && (
              <div>
                <label htmlFor="visitor-pay-override" className={formLabelClass}>Motivo override si cobra menos</label>
                <textarea id="visitor-pay-override" rows={2} aria-invalid={errors.override_reason ? true : undefined} {...form.register('override_reason')} placeholder="Requerido solo si el monto es menor a la cotización." className={formInputClass} />
                <FieldError error={errors.override_reason} />
              </div>
            )}

            <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Comprobante</p>
              <p className="text-sm text-blue-900 mt-1">Al registrar el pago se genera un comprobante con patente, tiempos, tarifa por minuto, total y método de pago.</p>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setVisitorPayment(null)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isActionLoading} className="flex-[2] py-4 bg-emerald-700 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
                {isActionLoading ? 'Registrando...' : 'Registrar Pago'}
              </button>
            </div>
          </form>
  );
}

export default function VisitorPaymentSheet(){
const { setVisitorPayment, visitorPayment } = useSpaces();
return (<Drawer
        isOpen={Boolean(visitorPayment)}
        onClose={() => setVisitorPayment(null)}
        title="Cobrar Ticket de Visita"
      >
        {visitorPayment && <VisitorPaymentForm />}
      </Drawer>);
}
