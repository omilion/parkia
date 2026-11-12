import Drawer from '../../../components/ui/Drawer';

import { paymentMethodLabels } from './spacesShared';

import { useSpaces } from './SpacesContext';
export default function VisitorReceiptSheet(){
const { handleCompleteVisitor, isActionLoading, setVisitorReceipt, visitorReceipt } = useSpaces();
return (<Drawer
        isOpen={Boolean(visitorReceipt)}
        onClose={() => setVisitorReceipt(null)}
        title="Comprobante de Pago"
      >
        {visitorReceipt && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-slate-900 text-white p-6">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Comprobante</p>
              <p className="mt-1 text-2xl font-black">{visitorReceipt.receipt_number}</p>
              <p className="mt-2 text-sm text-white/70">{visitorReceipt.legal_note}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Patente</p>
                <p className="mt-1 text-lg font-bold uppercase">{visitorReceipt.plate}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Ticket</p>
                <p className="mt-1 text-lg font-bold">#{visitorReceipt.ticket_id}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Entrada</p>
                <p className="mt-1 text-sm font-bold">{new Date(visitorReceipt.entry_time).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Pago</p>
                <p className="mt-1 text-sm font-bold">{visitorReceipt.paid_at ? new Date(visitorReceipt.paid_at).toLocaleString() : '-'}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              {[
                ['Duración', `${visitorReceipt.duration_mins} min`],
                ['Gracia', `${visitorReceipt.grace_period_mins} min`],
                ['Minutos cobrables', `${visitorReceipt.billable_mins} min`],
                ['Tarifa por minuto', `$${visitorReceipt.rate_per_minute.toLocaleString()}`],
                ['Método', paymentMethodLabels[visitorReceipt.payment_method] || visitorReceipt.payment_method],
                ['Total pagado', `$${visitorReceipt.amount_paid.toLocaleString()}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{label}</span>
                  <span className="text-sm font-bold text-slate-900">{value}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => window.print()} className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Imprimir
              </button>
              <button type="button" onClick={() => handleCompleteVisitor(visitorReceipt.ticket_id)} disabled={isActionLoading} className="flex-[2] py-3 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                Autorizar salida
              </button>
            </div>
          </div>
        )}
      </Drawer>);
}
