import { DataView } from '../../../ui/DataView';

import { Clock, Download, FileText, Filter } from 'lucide-react';
import { Expense } from '../../../types';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';
export default function ExpensesPage() {
  const { loadError, expenseCategory, expenseDueFilter, expenseReportMonth, expenseReportMonthField, expenseReviewFilter, expenseReviewLabels, expenseStatus, filteredExpenses, getReportMonthEnd, handleApproveExpense, hasExpenseFilters, isAdmin, isLoading, isReconcilingExpense, isSavingExpense, monthlyCloseReport, openExpenseDrawer, overdueExpenseCount, pendingExpenseCount, profitabilityReport, requestAdminApproval, resetExpenseReview, setExpenseCategory, setExpenseDueFilter, setExpensePaymentAction, setExpenseStatus, setReconcilingExpense, summary, todayExpenseCount } = useFinance();
  return (<div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => { setExpenseStatus('overdue'); setExpenseDueFilter('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'overdue' ? "border-red-200 bg-red-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Vencidos</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{overdueExpenseCount}</p>
                <p className="text-xs text-red-700 mt-1">${Number(summary?.overdueExpenses || 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => { setExpenseStatus('pending'); setExpenseDueFilter('today'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'pending' && expenseDueFilter === 'today' ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Vencen Hoy</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{todayExpenseCount}</p>
                <p className="text-xs text-blue-600 mt-1">Pagos por priorizar</p>
              </button>
              <button
                onClick={() => { setExpenseStatus('pending'); setExpenseDueFilter('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'pending' && expenseDueFilter === 'all' ? "border-amber-200 bg-amber-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pendientes</p>
                <p className="text-2xl font-bold text-amber-800 mt-1">{pendingExpenseCount}</p>
                <p className="text-xs text-amber-800 mt-1">${Number(summary?.pendingExpenses || 0).toLocaleString()}</p>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gastos Pagados</p>
                <p className="text-2xl font-bold text-red-700 mt-1">${Number(profitabilityReport?.totalPaidExpenses || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gastos Pendientes</p>
                <p className="text-2xl font-bold text-amber-800 mt-1">${Number(profitabilityReport?.totalPendingExpenses || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Caja Proyectada</p>
                <p className={cn("text-2xl font-bold mt-1", Number(summary?.projectedCashBalance || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>${Number(summary?.projectedCashBalance || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Margen Real</p>
                <p className={cn("text-2xl font-bold mt-1", Number(profitabilityReport?.netMargin || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>${Number(profitabilityReport?.netMargin || 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600" />
                <select aria-label="Todos" value={expenseStatus} onChange={(e) => { setExpenseStatus(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todos</option>
                  <option value="pending">Pendientes</option>
                  <option value="overdue">Vencidos</option>
                  <option value="paid">Pagados</option>
                  <option value="cancelled">Anulados</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-600" />
                <select aria-label="Todas las categorías" value={expenseCategory} onChange={(e) => { setExpenseCategory(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todas las categorías</option>
                  <option value="rent">Arriendo</option>
                  <option value="maintenance">Mantención</option>
                  <option value="utilities">Servicios</option>
                  <option value="payroll">Sueldos</option>
                  <option value="supplies">Insumos</option>
                  <option value="taxes">Impuestos</option>
                  <option value="admin">Administración</option>
                  <option value="other">Otros</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                <select aria-label="Todas las fechas" value={expenseDueFilter} onChange={(e) => { setExpenseDueFilter(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todas las fechas</option>
                  <option value="overdue">Vencidos</option>
                  <option value="today">Hoy</option>
                  <option value="upcoming">Próximos</option>
                </select>
              </div>
            </div>
            {(expenseReviewFilter !== 'all' || expenseReportMonth) && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm font-bold text-blue-700">
                  {expenseReviewFilter !== 'all' ? expenseReviewLabels[expenseReviewFilter] : 'Gastos filtrados desde reporte'}
                  {expenseReportMonth ? ` · Mes ${expenseReportMonth}` : ''}
                  {expenseReportMonthField === 'date' ? ' · Fecha gasto' : expenseReportMonthField === 'paid' ? ' · Fecha pago' : ''}
                  · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                </p>
                <button onClick={resetExpenseReview} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                  Limpiar filtro
                </button>
              </div>
            )}

            <div className="glass-card overflow-x-auto">
              <DataView<Expense> caption="Gastos" items={loadError ? [] : filteredExpenses} getKey={expense => expense.id} loading={isLoading} emptyContent={<>{!isLoading && filteredExpenses.length === 0 && (
                    <div>
                      <div className="p-4">
                        <FinanceEmptyState
                          title={hasExpenseFilters ? 'No hay gastos para esos filtros.' : 'Sin gastos registrados.'}
                          description={hasExpenseFilters ? 'Limpia filtros para volver a la vista completa de gastos.' : 'Registra gastos con proveedor, centro de costo y respaldo para controlar egresos reales.'}
                          action={hasExpenseFilters ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExpenseStatus('all');
                                setExpenseCategory('all');
                                setExpenseDueFilter('all');
                                resetExpenseReview();
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              Limpiar filtros
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openExpenseDrawer()}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                            >
                              Registrar gasto
                            </button>
                          )}
                        />
                      </div>
                    </div>
                  )}</>} columns={[{ key: 'column-0', label: "Proveedor", primary: true, render: (expense) => { 
return <>
<p className="text-sm font-bold">{expense.supplier_name}</p>

<p className="text-xs text-slate-600">{expense.supplier_rut || 'Sin RUT'}</p>
</>; } },
{ key: 'column-1', label: "Detalle", render: (expense) => { 
return <>
<p className="text-sm font-medium">{expense.description}</p>

<p className="text-xs text-slate-600">{expense.category} · Centro {expense.cost_center || 'general'} · {expense.document_type}{expense.document_number ? ` #${expense.document_number}` : ''}</p>

{expense.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{expense.branch_name}</p>}
</>; } },
{ key: 'column-2', label: "Fecha", render: (expense) => { 
return <>{expense.date}</>; } },
{ key: 'column-3', label: "Total", render: (expense) => { 
return <>
<p className="text-sm font-bold">${expense.amount_total.toLocaleString()}</p>

<p className="text-xs font-bold text-slate-600">IVA ${Number(expense.tax_amount || 0).toLocaleString()}</p>
</>; } },
{ key: 'column-4', label: "Estado", render: (expense) => { 
return <>
<span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          expense.payment_status === 'paid' ? "bg-emerald-100 text-emerald-800" :
                            expense.payment_status === 'overdue' ? "bg-red-100 text-red-700" :
                              expense.payment_status === 'cancelled' ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"
                        )}>
                          {expense.payment_status === 'paid' ? 'Pagado' : expense.payment_status === 'overdue' ? 'Vencido' : expense.payment_status === 'cancelled' ? 'Anulado' : 'Pendiente'}
                        </span>

{expense.due_date && expense.payment_status !== 'paid' && <p className="text-xs font-bold text-slate-600 mt-1">Vence {expense.due_date}</p>}

<span className={cn(
                          "mt-1 inline-flex px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          expense.approval_status === 'approved' ? "bg-blue-100 text-blue-700" :
                            expense.approval_status === 'rejected' ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
                        )}>
                          {expense.approval_status === 'approved' ? 'Aprobado' : expense.approval_status === 'rejected' ? 'Rechazado' : 'Pendiente aprobación'}
                        </span>
</>; } },
{ key: 'column-5', label: "Acciones", fullWidthOnMobile: true, render: (expense) => { 
return <>
<button onClick={() => openExpenseDrawer(expense)} className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all">Editar</button>

{expense.payment_status !== 'paid' && expense.approval_status !== 'approved' && (
                          isAdmin ? (
                            <button onClick={() => handleApproveExpense(expense, 'approved')} disabled={isSavingExpense} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50">Aprobar</button>
                          ) : (
                            <button onClick={() => requestAdminApproval(`aprobación del gasto #${expense.id}`, { source_type: 'finance_expense_approval', source_id: expense.id, source_label: 'Gasto' })} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">Solicitar aprobación</button>
                          )
                        )}

{expense.payment_status !== 'paid' && expense.payment_status !== 'cancelled' && (
                          <button onClick={() => setExpensePaymentAction(expense)} disabled={isSavingExpense || expense.approval_status !== 'approved'} title={expense.approval_status !== 'approved' ? 'Debe aprobarse antes de pagar' : 'Registrar pago'} className="text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40">Pagar</button>
                        )}

{expense.payment_status !== 'cancelled' && !expense.bank_movement_id && (
                          <button onClick={() => setReconcilingExpense(expense)} disabled={isReconcilingExpense || expense.approval_status !== 'approved'} title={expense.approval_status !== 'approved' ? 'Debe aprobarse antes de conciliar' : 'Conciliar contra cartola'} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40">Cartola</button>
                        )}

{expense.receipt_file_path && (
                          <a href={`/api/finance/expenses/${expense.id}/receipt`} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all">
                            <Download className="w-3.5 h-3.5" />
                            Respaldo
                          </a>
                        )}
</>; } }]} />
            </div>
          </div>);
}
