import Drawer from '../../../components/ui/Drawer';

import { useFinance } from './FinanceContext';
export default function ReconcileExpenseDialog() {
  const { closeExpenseReconcileDrawer, expenseMovementSuggestions, handleReconcileExpenseMovement, isReconcilingExpense, reconcilingExpense } = useFinance();
  return (<Drawer
        isOpen={Boolean(reconcilingExpense)}
        onClose={closeExpenseReconcileDrawer}
        title="Conciliar Gasto con Cartola"
      >
        {reconcilingExpense && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Gasto</p>
              <p className="text-xl font-bold mt-1">{reconcilingExpense.supplier_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Total</p>
                  <p className="text-lg font-bold">${reconcilingExpense.amount_total.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Documento</p>
                  <p className="text-lg font-bold">{reconcilingExpense.document_number || 'Sin folio'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {expenseMovementSuggestions.length === 0 && (
                <p className="text-sm text-slate-600 bg-slate-50 rounded-2xl p-4">No hay movimientos bancarios sugeridos por monto, proveedor o RUT.</p>
              )}
              {expenseMovementSuggestions.map(suggestion => (
                <div key={suggestion.bank_movement_id} className="border border-slate-200 rounded-2xl p-4">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 items-center">
                        <p className="text-sm font-bold text-slate-900">{suggestion.movement.description}</p>
                        <span className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-xs font-bold">Match {suggestion.score}%</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{suggestion.movement.date} · RUT {suggestion.movement.rut}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {suggestion.reasons.map(reason => (
                          <span key={reason} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-bold">{reason}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-700">${suggestion.movement.amount.toLocaleString()}</p>
                      <button
                        onClick={() => handleReconcileExpenseMovement(suggestion.movement)}
                        disabled={isReconcilingExpense}
                        className="mt-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                      >
                        Conciliar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>);
}
