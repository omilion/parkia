import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Drawer from '../../../components/ui/Drawer';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { closeCashFormSchema } from '../../../../shared/schemas/spaces';
import { formatCurrency } from './spacesShared';
import { useSpaces } from './SpacesContext';

function CashCloseForm() {
  const { handleCloseVisitorCashSession, isActionLoading, setIsCashCloseDrawerOpen, visitorCashSummary } = useSpaces();
  const form = useForm({
    resolver: zodResolver(closeCashFormSchema),
    defaultValues: {
      counted_cash: visitorCashSummary.expectedCash,
      counted_card: visitorCashSummary.totals.card || 0,
      counted_transfer: visitorCashSummary.totals.transfer || 0,
      notes: '',
      handover_notes: '',
    },
  });
  const { errors } = form.formState;
  const blocked = Number(visitorCashSummary.blockers.paidTicketsAwaitingExit || 0) > 0;
  return (
          <form noValidate onSubmit={form.handleSubmit(handleCloseVisitorCashSession)} className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-6 text-white">
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">Caja #{visitorCashSummary.session.id}</p>
              <p className="mt-1 text-3xl font-black">{formatCurrency(visitorCashSummary.expectedCash)}</p>
              <p className="mt-2 text-sm text-white/70">Efectivo esperado según cobros registrados en esta sesión.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Efectivo sistema</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.expectedCash)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Tarjeta</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.totals.card)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Transferencia</p>
                <p className="mt-1 text-lg font-black">{formatCurrency(visitorCashSummary.totals.transfer)}</p>
              </div>
            </div>

            {blocked && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-red-700">Cierre bloqueado</p>
                <p className="mt-1 text-sm text-red-900">Autoriza la salida de {visitorCashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) antes de cerrar caja.</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {([['counted_cash', 'Efectivo contado'], ['counted_card', 'Tarjeta contado'], ['counted_transfer', 'Transferencia contado']] as const).map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={`cash-${name}`} className={formLabelClass}>{label}</label>
                  <input id={`cash-${name}`} type="number" inputMode="numeric" min="0" aria-invalid={errors[name] ? true : undefined} {...form.register(name)} className={formInputClass} />
                  <FieldError error={errors[name]} />
                </div>
              ))}
            </div>

            <div>
              <label htmlFor="cash-notes" className={formLabelClass}>Observación de caja</label>
              <textarea id="cash-notes" rows={3} {...form.register('notes')} placeholder="Ej: diferencia informada, voucher pendiente, caja cuadrada." className={`${formInputClass} resize-none`} />
            </div>

            <div>
              <label htmlFor="cash-handover" className={formLabelClass}>Traspaso de turno</label>
              <textarea id="cash-handover" rows={3} aria-describedby="cash-handover-hint" {...form.register('handover_notes')} placeholder="Pendientes para el siguiente turno." className={`${formInputClass} resize-none`} />
              <p id="cash-handover-hint" className="mt-2 text-xs text-slate-600">Si esta caja está vinculada a una bitácora abierta, también quedará cerrada.</p>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={() => setIsCashCloseDrawerOpen(false)} className="flex-1 py-4 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
              <button
                type="submit"
                disabled={isActionLoading || blocked}
                className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                {isActionLoading ? 'Cerrando...' : 'Cerrar Caja'}
              </button>
            </div>
          </form>
  );
}

export default function CashCloseSheet(){
const { isCashCloseDrawerOpen, setIsCashCloseDrawerOpen, visitorCashSummary } = useSpaces();
return (<Drawer
        isOpen={isCashCloseDrawerOpen}
        onClose={() => setIsCashCloseDrawerOpen(false)}
        title="Arqueo y Cierre de Caja"
      >
        {visitorCashSummary && <CashCloseForm />}
      </Drawer>);
}
