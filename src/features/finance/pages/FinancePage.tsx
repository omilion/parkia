import { PageHeader } from '../../../ui';
import { Tabs, LoadingState } from '../../../ui';
import React from 'react';

import { AnimatePresence } from 'motion/react';
import { Clock } from 'lucide-react';

import Toast from '../../../components/ui/Toast';

import type { FinanceTab, FinancePageProps } from './financeShared';
import { Outlet } from 'react-router-dom';
import { FinanceContext } from './FinanceContext';
import { useFinanceController } from '../hooks/useFinanceController';
const PaymentDetailDialog = React.lazy(() => import('./PaymentDetailDialog'));
const PaymentAdjustmentDialog = React.lazy(() => import('./PaymentAdjustmentDialog'));
const RegisterPaymentDialog = React.lazy(() => import('./RegisterPaymentDialog'));
const EditBankMovementDialog = React.lazy(() => import('./EditBankMovementDialog'));
const AllocateBankMovementDialog = React.lazy(() => import('./AllocateBankMovementDialog'));
const PaymentAllocationHistoryDialog = React.lazy(() => import('./PaymentAllocationHistoryDialog'));
const ReverseAllocationDialog = React.lazy(() => import('./ReverseAllocationDialog'));
const CollectionActionDialog = React.lazy(() => import('./CollectionActionDialog'));
const ExpenseFormDialog = React.lazy(() => import('./ExpenseFormDialog'));
const ReconcileExpenseDialog = React.lazy(() => import('./ReconcileExpenseDialog'));
const MarkExpensePaidDialog = React.lazy(() => import('./MarkExpensePaidDialog'));

export default function FinancePage({ user }: FinancePageProps) {
  const workspace = useFinanceController(user);
  return <FinanceContext.Provider value={workspace}><FinanceShell /></FinanceContext.Provider>;
}
function FinanceShell() {
  const { activeTab, adjustmentPayment, allocationPayment, branches, collectionPayment, collectionProgress, editingMovement, expensePaymentAction, handleTabChange, historyPayment, isDrawerOpen, isExpenseDrawerOpen, paymentDetail, reconcilingExpense, reverseAllocation, selectedBranchId, selectedMovement, setSelectedBranchId, setToast, summary, tabActions, toast } = React.useContext(FinanceContext)!;
  return (<div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <PageHeader title={<>Gestión Financiera</>} description={<>Control de cobranza, conciliación y facturación SII.</>} actions={<><label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-slate-600">
          Sucursal
          <select aria-label="Sucursal"
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold normal-case tracking-normal text-slate-700 outline-none transition-all hover:bg-slate-50"
          >
            <option value="all">Todas las sucursales</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </label></>} />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Total por Cobrar (Mes)</p>
          <p className="text-2xl font-bold">${summary?.totalPending.toLocaleString()}</p>
          <p className="text-xs text-slate-600 mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Próximos vencimientos
          </p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-emerald-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Recaudado</p>
          <p className="text-2xl font-bold text-emerald-800">${summary?.totalCollected.toLocaleString()}</p>
          <p className="text-xs text-emerald-800 mt-2 font-medium">{collectionProgress}% de cuentas cobrables cerradas</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Morosidad</p>
          <p className="text-2xl font-bold text-red-700">${summary?.totalOverdue.toLocaleString()}</p>
          <p className="text-xs text-red-700 mt-2 font-medium">{summary?.overdueClientsCount} clientes atrasados · ${Number(summary?.overdueExpenses || 0).toLocaleString()} gastos vencidos</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs label="Secciones de finanzas" value={activeTab} onValueChange={value => handleTabChange(value as FinanceTab)} items={[
        { value: 'payments', label: 'Pagos' }, { value: 'collections', label: 'Cobranza' },
        { value: 'cgvc', label: 'Banco' }, { value: 'expenses', label: 'Gastos' },
        { value: 'reports', label: 'Reportes' }, { value: 'closures', label: 'Cierres' },
        { value: 'invoices', label: 'Documentos tributarios' },
      ]} />

      {tabActions && (
        <div className="flex flex-wrap justify-end gap-3 -mt-3">
          {tabActions}
        </div>
      )}

      {/* Tab Content */}
      <div className="min-h-[500px]">
        <React.Suspense fallback={<LoadingState />}><Outlet /></React.Suspense>

      </div>

      {(Boolean(paymentDetail)) && <React.Suspense fallback={null}><PaymentDetailDialog /></React.Suspense>}

      {(Boolean(adjustmentPayment)) && <React.Suspense fallback={null}><PaymentAdjustmentDialog /></React.Suspense>}

      {(isDrawerOpen) && <React.Suspense fallback={null}><RegisterPaymentDialog /></React.Suspense>}

      {(Boolean(editingMovement)) && <React.Suspense fallback={null}><EditBankMovementDialog /></React.Suspense>}

      {(Boolean(allocationPayment && selectedMovement)) && <React.Suspense fallback={null}><AllocateBankMovementDialog /></React.Suspense>}

      {(Boolean(historyPayment)) && <React.Suspense fallback={null}><PaymentAllocationHistoryDialog /></React.Suspense>}

      {(Boolean(reverseAllocation)) && <React.Suspense fallback={null}><ReverseAllocationDialog /></React.Suspense>}

      {(Boolean(collectionPayment)) && <React.Suspense fallback={null}><CollectionActionDialog /></React.Suspense>}

      {(isExpenseDrawerOpen) && <React.Suspense fallback={null}><ExpenseFormDialog /></React.Suspense>}

      {(Boolean(reconcilingExpense)) && <React.Suspense fallback={null}><ReconcileExpenseDialog /></React.Suspense>}

      {(Boolean(expensePaymentAction)) && <React.Suspense fallback={null}><MarkExpensePaidDialog /></React.Suspense>}
    </div>);
}
