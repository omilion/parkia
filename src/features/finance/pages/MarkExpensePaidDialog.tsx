import ConfirmDialog from '../../../components/ui/ConfirmDialog';

import { useFinance } from './FinanceContext';
export default function MarkExpensePaidDialog() {
  const { closeExpensePaymentDialog, expensePaymentAction, expensePaymentNote, handleMarkExpensePaid, isLoading, isSavingExpense, setExpensePaymentNote } = useFinance();
  return (<ConfirmDialog
        isOpen={Boolean(expensePaymentAction)}
        title="Marcar gasto como pagado"
        message={
          <div className="space-y-4">
            <p>
              Se registrara el pago de <strong>{expensePaymentAction?.supplier_name}</strong> por ${Number(expensePaymentAction?.amount_total || 0).toLocaleString()}.
            </p>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">Nota operacional</label>
              <textarea aria-label="Nota operacional"
                value={expensePaymentNote}
                onChange={(e) => setExpensePaymentNote(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-slate-900 focus:bg-white"
                placeholder="Ej: Pago validado contra transferencia bancaria o comprobante del proveedor."
              />
            </div>
          </div>
        }
        confirmLabel="Registrar pago"
        tone="default"
        isLoading={isSavingExpense}
        isConfirmDisabled={expensePaymentNote.trim().length < 3}
        onCancel={closeExpensePaymentDialog}
        onConfirm={handleMarkExpensePaid}
      />);
}
