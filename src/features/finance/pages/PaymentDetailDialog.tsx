import Drawer from '../../../components/ui/Drawer';

import { useFinance } from './FinanceContext';
import { todayLocal } from '../../../../shared/dates';
export default function PaymentDetailDialog() {
  const { closePaymentDetailDrawer, collectionActions, isAdmin, paymentDetail, requestAdminApproval, setAdjustmentPayment } = useFinance();
  return (<Drawer
        isOpen={Boolean(paymentDetail)}
        onClose={closePaymentDetailDrawer}
        title="Ficha Cuenta por Cobrar"
      >
        {paymentDetail && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cliente</p>
              <p className="text-xl font-bold mt-1">{paymentDetail.payment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Monto</p>
                  <p className="text-2xl font-bold">${Number(paymentDetail.payment.amount || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-2xl font-bold">${Number(paymentDetail.payment.remaining_amount || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Contrato</p>
                <p className="text-sm font-bold">#CON-{paymentDetail.payment.contract_id_display?.toString().padStart(3, '0')}</p>
                <p className="text-xs text-slate-600">{paymentDetail.payment.space_name || 'Sin espacio'}</p>
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Fecha de corte</p>
                <p className="text-sm font-bold">{paymentDetail.meta?.cutOffDate || todayLocal()}</p>
                <p className="text-xs text-slate-600">Vence {paymentDetail.payment.due_date}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">Fórmulas visibles</p>
              {Object.entries(paymentDetail.meta?.formulas || {}).map(([key, value]) => (
                <p key={key} className="text-xs text-blue-800"><strong>{key}:</strong> {value}</p>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Ajustes financieros</h4>
                {paymentDetail.payment.status !== 'paid' && paymentDetail.payment.status !== 'cancelled' && (
                  isAdmin ? (
                    <button onClick={() => setAdjustmentPayment(paymentDetail.payment)} className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg transition-all">Nuevo ajuste</button>
                  ) : (
                    <button onClick={() => requestAdminApproval(`ajuste de pago #PAG-${paymentDetail.payment.id.toString().padStart(4, '0')}`, { source_type: 'finance_payment_adjustment', source_id: paymentDetail.payment.id, source_label: 'Pago' })} className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg transition-all">Solicitar aprobación</button>
                  )
                )}
              </div>
              <div className="space-y-3">
                {paymentDetail.adjustments.map(adjustment => (
                  <div key={adjustment.id} className="p-3 border border-slate-100 rounded-2xl">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">
                        {adjustment.type === 'fee' ? 'Multa' : adjustment.type === 'waiver' ? 'Condonación' : 'Descuento'} · ${adjustment.amount.toLocaleString()}
                      </p>
                      <p className="text-xs font-bold text-slate-600">${adjustment.previous_amount.toLocaleString()} {'->'} ${adjustment.new_amount.toLocaleString()}</p>
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{adjustment.reason}</p>
                    <p className="text-xs text-slate-600 mt-1">{new Date(adjustment.created_at).toLocaleString()} · {adjustment.staff_name || 'Sistema'}</p>
                  </div>
                ))}
                {paymentDetail.adjustments.length === 0 && <p className="text-sm text-slate-600">Sin ajustes registrados.</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Abonos y conciliación</p>
                {paymentDetail.allocations.map(allocation => (
                  <p key={allocation.id} className="text-sm text-slate-700">${allocation.amount.toLocaleString()} · {allocation.movement_date} · {allocation.movement_description}</p>
                ))}
                {paymentDetail.allocations.length === 0 && <p className="text-sm text-slate-600">Sin abonos aplicados.</p>}
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Seguimiento cobranza</p>
                {paymentDetail.collectionActions.map(action => (
                  <p key={action.id} className="text-sm text-slate-700">{action.created_at.slice(0, 10)} · {action.note}</p>
                ))}
                {paymentDetail.collectionActions.length === 0 && <p className="text-sm text-slate-600">Sin gestiones registradas.</p>}
              </div>
            </div>
          </div>
        )}
      </Drawer>);
}
