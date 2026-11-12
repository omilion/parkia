import { Expense } from '../../../types';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';

import ReportFilters from './ReportFilters';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import { budgetFieldsSchema } from '../../../../shared/schemas/finance';

function BudgetForm() {
  const { expenseCategoryLabels, handleSaveBudget, isSavingBudget, reportMonth } = useFinance();
  const form = useForm({
    resolver: zodResolver(budgetFieldsSchema),
    defaultValues: { category: 'rent' as const, planned_amount: '', notes: '' },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Presupuesto mensual"
      onSubmit={form.handleSubmit(async values => {
        if (await handleSaveBudget(values)) form.reset();
      })}
      className="glass-card p-5 space-y-4"
    >
      <div>
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Presupuesto Mensual</h3>
        <p className="text-xs text-slate-600 mt-1">{reportMonth}</p>
      </div>
      <div>
        <label htmlFor="budget-category" className={formLabelClass}>Categoría</label>
        <select id="budget-category" {...form.register('category')} className={formInputClass}>
          {Object.entries(expenseCategoryLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="budget-amount" className={formLabelClass}>Monto presupuestado</label>
        <input id="budget-amount" type="number" inputMode="numeric" min="0" step="1" aria-invalid={errors.planned_amount ? true : undefined} {...form.register('planned_amount')} className={formInputClass} />
        <FieldError error={errors.planned_amount} />
      </div>
      <div>
        <label htmlFor="budget-notes" className={formLabelClass}>Notas</label>
        <textarea id="budget-notes" rows={3} {...form.register('notes')} className={`${formInputClass} resize-none`} />
      </div>
      <button type="submit" disabled={isSavingBudget} className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
        {isSavingBudget ? 'Guardando...' : 'Guardar Presupuesto'}
      </button>
    </form>
  );
}

export default function ReportsPage() {
const { budgetByCategory, budgetReport, cashFlowReport, delinquencyReport, expenseCategoryLabels, handleTabChange, hasReportActivity, isLoading, loadError, monthlyCloseReport, openReportExpenses, openReportMovements, openReportPayments, reportMonth } = useFinance();
return (<div className="space-y-6">
<ReportFilters />

{!isLoading && !loadError && !hasReportActivity && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-bold text-blue-900">Sin movimientos para el mes seleccionado</p>
                <p className="mt-1 text-sm text-blue-800">
                  Los reportes muestran $0 porque no hay cobros, gastos, facturas ni presupuesto para {reportMonth}. Las exportaciones siguen disponibles y descargan el archivo con cabeceras para revisión.
                </p>
              </div>
            )}

<div className="glass-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Base del reporte</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Fecha de corte: {monthlyCloseReport?.meta?.cutOffDate || `${reportMonth}-último día`} · Generado: {monthlyCloseReport?.meta?.generatedAt ? new Date(monthlyCloseReport.meta.generatedAt).toLocaleString() : 'ahora'}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600 lg:max-w-3xl">
                  {Object.entries(monthlyCloseReport?.meta?.formulas || {}).slice(0, 6).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <p className="font-bold text-slate-900">{key}</p>
                      <p className="mt-1">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button type="button" onClick={() => handleTabChange('reports')} className="glass-card p-6 border-l-4 border-l-slate-900 text-left hover:bg-slate-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Margen Caja</p>
                <p className={cn("text-2xl font-bold mt-2", Number(monthlyCloseReport?.cashMargin || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>${Number(monthlyCloseReport?.cashMargin || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.month || reportMonth}</p>
              </button>
              <button type="button" onClick={() => openReportPayments('paid', 'paid')} className="glass-card p-6 border-l-4 border-l-emerald-500 text-left hover:bg-emerald-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Recaudación Total</p>
                <p className="text-2xl font-bold text-emerald-800 mt-2">${Number(monthlyCloseReport?.collectedTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.collectedCount ?? 0} pagos en el mes</p>
              </button>
              <button type="button" onClick={() => openReportExpenses('paid', 'paid')} className="glass-card p-6 border-l-4 border-l-red-500 text-left hover:bg-red-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gastos Pagados</p>
                <p className="text-2xl font-bold text-red-700 mt-2">${Number(monthlyCloseReport?.paidExpensesTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.paidExpensesCount ?? 0} egresos en el mes</p>
              </button>
              <button type="button" onClick={() => openReportPayments('all', 'due')} className="glass-card p-6 border-l-4 border-l-blue-500 text-left hover:bg-blue-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Facturado</p>
                <p className="text-2xl font-bold text-blue-600 mt-2">${Number(monthlyCloseReport?.billedTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.billedCount ?? 0} cargos emitidos</p>
              </button>
              <button type="button" onClick={() => openReportExpenses('all', 'date')} className="glass-card p-6 border-l-4 border-l-amber-500 text-left hover:bg-amber-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gastos Devengados</p>
                <p className="text-2xl font-bold text-amber-800 mt-2">${Number(monthlyCloseReport?.accruedExpensesTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.accruedExpensesCount ?? 0} gastos del mes</p>
              </button>
              <button type="button" onClick={() => openReportMovements('attention')} className="glass-card p-6 border-l-4 border-l-blue-500 text-left hover:bg-blue-50 transition-all">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Cartola Conciliada</p>
                <p className="text-2xl font-bold text-blue-600 mt-2">{monthlyCloseReport?.bankMovementsReconciled ?? 0}/{monthlyCloseReport?.bankMovementsTotal ?? 0}</p>
                <p className="text-xs text-slate-600 mt-1">{monthlyCloseReport?.bankMovementsPending ?? 0} pendientes · {monthlyCloseReport?.bankMovementsPartial ?? 0} parciales</p>
              </button>
            </div>

<div className="glass-card overflow-hidden">
              <div className="p-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Saldo Inicial</p>
                  <p className="text-xl font-bold text-slate-900">${Number(cashFlowReport?.openingBalance || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Entradas Esperadas</p>
                  <p className="text-xl font-bold text-emerald-800">${Number(cashFlowReport?.expectedInflowTotal || 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-600 mt-1">{cashFlowReport?.overdueRecoveryRate ?? 60}% recuperación mora</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Salidas Comprometidas</p>
                  <p className="text-xl font-bold text-red-700">${Number(cashFlowReport?.scheduledOutflowTotal || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Reserva Presupuesto</p>
                  <p className="text-xl font-bold text-amber-800">${Number(cashFlowReport?.budgetReserve || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Caja Proyectada</p>
                  <p className={cn("text-xl font-bold", Number(cashFlowReport?.projectedClosingBalance || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>${Number(cashFlowReport?.projectedClosingBalance || 0).toLocaleString()}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {(cashFlowReport?.buckets ?? []).map((bucket: any) => (
                  <div key={`${bucket.start}-${bucket.end}`} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px_120px] gap-3 items-center">
                    <div>
                      <p className="text-sm font-bold">{bucket.start} a {bucket.end}</p>
                      <p className="text-xs text-slate-600">{bucket.expectedInflowCount} cobro(s) · {bucket.scheduledOutflowCount} pago(s){Number(bucket.overdueNominalInflow || 0) > 0 ? ` · mora recuperable $${Number(bucket.overdueRecoverableInflow || 0).toLocaleString()} de $${Number(bucket.overdueNominalInflow || 0).toLocaleString()}` : ''}</p>
                    </div>
                    <p className="text-sm font-bold text-emerald-800">+${Number(bucket.expectedInflow || 0).toLocaleString()}</p>
                    <p className="text-sm font-bold text-red-700">-${Number(bucket.scheduledOutflow || 0).toLocaleString()}</p>
                    <p className="text-sm font-bold text-amber-800">-${Number(bucket.budgetReserve || 0).toLocaleString()}</p>
                    <p className={cn("text-sm font-bold", Number(bucket.projectedBalance || 0) >= 0 ? "text-slate-900" : "text-red-700")}>${Number(bucket.projectedBalance || 0).toLocaleString()}</p>
                  </div>
                ))}
                {(cashFlowReport?.buckets ?? []).length === 0 && (
                  <FinanceEmptyState
                    title="Sin proyección de caja disponible."
                    description="La proyección se completa cuando existan cobros esperados, gastos programados o presupuesto del mes."
                  />
                )}
              </div>
            </div>

<div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
              <BudgetForm />

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Presupuestado</p>
                    <p className="text-xl font-bold text-slate-900">${Number(budgetReport?.plannedTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Real</p>
                    <p className="text-xl font-bold text-red-700">${Number(budgetReport?.actualTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Desviación</p>
                    <p className={cn("text-xl font-bold", Number(budgetReport?.varianceTotal || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>${Number(budgetReport?.varianceTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Ejecución</p>
                    <p className="text-xl font-bold text-blue-600">{budgetReport?.executionPercent ?? 0}%</p>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {(budgetReport?.rows ?? []).map((row: any) => {
                    const savedBudget = budgetByCategory.get(row.category);
                    return (
                      <div key={row.category} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px] gap-3 items-center">
                        <div>
                          <p className="text-sm font-bold">{expenseCategoryLabels[row.category as Expense['category']] || row.category}</p>
                          <p className="text-xs text-slate-600">{row.count} gasto(s){savedBudget?.notes ? ` · ${savedBudget.notes}` : ''}</p>
                        </div>
                        <p className="text-sm font-bold text-slate-700">${Number(row.plannedAmount || 0).toLocaleString()}</p>
                        <p className="text-sm font-bold text-red-700">${Number(row.actualAmount || 0).toLocaleString()}</p>
                        <p className={cn("text-sm font-bold", Number(row.variance || 0) >= 0 ? "text-emerald-800" : "text-red-700")}>
                          ${Number(row.variance || 0).toLocaleString()} · {row.executionPercent ?? 0}%
                        </p>
                      </div>
                    );
                  })}
                  {(budgetReport?.rows ?? []).length === 0 && (
                    <FinanceEmptyState
                      title="Sin presupuesto ni gastos para comparar."
                      description="Agrega un presupuesto mensual o registra gastos del mes para ver ejecución y desviaciones."
                    />
                  )}
                </div>
              </div>
            </div>

<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Recaudación por Método del Mes</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.collectionsByMethod ?? []).map((item: any) => (
                    <div key={item.method} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold capitalize">{item.method}</p>
                        <p className="text-xs text-slate-600">{item.count} pagos</p>
                      </div>
                      <p className="text-sm font-bold">${Number(item.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.collectionsByMethod ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-600">Sin recaudación registrada.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Gastos por Categoría del Mes</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.expensesByCategory ?? []).map((item: any) => (
                    <div key={item.category} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold capitalize">{item.category}</p>
                        <p className="text-xs text-slate-600">{item.count} gastos</p>
                      </div>
                      <p className="text-sm font-bold text-red-700">${Number(item.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.expensesByCategory ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-600">Sin gastos registrados.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Morosidad por Cliente</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(delinquencyReport?.rows ?? []).map((row: any) => (
                    <div key={row.client_id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{row.client_name}</p>
                        <p className="text-xs text-slate-600">{row.client_rut} · {row.overdue_count} deuda(s) · Desde {new Date(row.oldest_due_date).toLocaleDateString()}</p>
                      </div>
                      <p className="text-sm font-bold text-red-700">${Number(row.overdue_total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(delinquencyReport?.rows ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-600">Sin clientes morosos.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Antigüedad Cuentas por Cobrar</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.receivablesAging?.buckets ?? []).map((bucket: any) => (
                    <div key={bucket.bucket} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{bucket.bucket} días</p>
                        <p className="text-xs text-slate-600">{bucket.count} cuenta(s)</p>
                      </div>
                      <p className="text-sm font-bold text-red-700">${Number(bucket.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.receivablesAging?.buckets ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-600">Sin cuentas por cobrar vencidas para clasificar.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Antigüedad Gastos por Pagar</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.payablesAging?.buckets ?? []).map((bucket: any) => (
                    <div key={bucket.bucket} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{bucket.bucket} días</p>
                        <p className="text-xs text-slate-600">{bucket.count} gasto(s)</p>
                      </div>
                      <p className="text-sm font-bold text-amber-800">${Number(bucket.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.payablesAging?.buckets ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-600">Sin gastos por pagar vencidos para clasificar.</p>
                  )}
                </div>
              </div>
            </div>
</div>);
}
