import { RefreshCw } from 'lucide-react';

import Drawer from '../../../components/ui/Drawer';

import { cn } from '../../../lib/utils';

import { useFinance } from './FinanceContext';
export default function PaymentAllocationHistoryDialog() {
  const { closeHistoryDrawer, historyPayment, isAdmin, isReversingAllocation, paymentAllocationHistory, setReverseAllocation } = useFinance();
  return (<Drawer
        isOpen={Boolean(historyPayment)}
        onClose={closeHistoryDrawer}
        title="Historial de Abonos"
      >
        {historyPayment && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cuenta por cobrar</p>
              <p className="text-xl font-bold mt-1">{historyPayment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Monto</p>
                  <p className="text-lg font-bold">${historyPayment.amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-lg font-bold">${Number(historyPayment.remaining_amount || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {paymentAllocationHistory.length === 0 && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-2xl p-4">No hay abonos registrados para este pago.</p>
              )}
              {paymentAllocationHistory.map(allocation => (
                <div key={allocation.id} className={cn(
                  "border rounded-2xl p-4",
                  allocation.reversed_at ? "border-red-100 bg-red-50" : "border-slate-200"
                )}>
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <p className={cn("text-sm font-bold", allocation.reversed_at ? "text-red-800 line-through" : "text-slate-900")}>{allocation.movement_description}</p>
                      <p className="text-xs text-slate-600">
                        Cartola #{allocation.bank_movement_id} · {allocation.movement_date} · RUT {allocation.movement_rut}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-bold whitespace-nowrap", allocation.reversed_at ? "text-red-700 line-through" : "text-emerald-800")}>${allocation.amount.toLocaleString()}</p>
                      {!allocation.reversed_at && isAdmin && (
                        <button
                          onClick={() => setReverseAllocation(allocation)}
                          disabled={isReversingAllocation}
                          className="mt-1 text-xs font-bold text-red-700 hover:bg-red-100 px-2 py-1 rounded-lg transition-all disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Reversar
                        </button>
                      )}
                    </div>
                  </div>
                  {allocation.note && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">{allocation.note}</p>
                  )}
                  {allocation.reversed_note && (
                    <p className="text-xs text-red-700 bg-white border border-red-100 rounded-xl px-3 py-2 mt-3">Reversado: {allocation.reversed_note}</p>
                  )}
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mt-3">
                    {allocation.reversed_at
                      ? `Reversado ${new Date(allocation.reversed_at).toLocaleString()}`
                      : `Registrado ${new Date(allocation.created_at).toLocaleString()}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>);
}
