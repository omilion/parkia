import { AlertCircle } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';

import ReportFilters from './ReportFilters';

export default function ClosuresPage() {
const { getReportMonthEnd, handleCloseMonth, handleOperationalCheckClick, handleReopenMonth, handleTabChange, hasReportActivity, isAdmin, isClosingMonth, isLoading, loadError, monthlyCloseNote, monthlyCloseReport, monthlyClosure, monthlyReopenReason, openReportExpenses, openReportMovements, openReportPayments, operationalCloseReport, operationalStatusClasses, operationalStatusLabels, reportMonth, requestAdminApproval, setMonthlyCloseNote, setMonthlyReopenReason, summary } = useFinance();
return (<div className="space-y-6"><ReportFilters />{!isLoading && !loadError && !hasReportActivity && (
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
<div className="glass-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Cierre Mensual Formal</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    {monthlyClosure?.status === 'closed'
                      ? `Cerrado por ${monthlyClosure.closed_by_name || 'administración'} el ${monthlyClosure.closed_at?.slice(0, 10) || ''}`
                      : monthlyClosure?.status === 'reopened'
                        ? `Reabierto por ${monthlyClosure.reopened_by_name || 'administración'} el ${monthlyClosure.reopened_at?.slice(0, 10) || ''}`
                        : 'Sin cierre formal registrado'}
                  </p>
                  {monthlyClosure?.accepted_pending_note && (
                    <p className="text-xs text-amber-700 mt-2">Pendientes aceptados: {monthlyClosure.accepted_pending_note}</p>
                  )}
                  {monthlyClosure?.reopened_reason && (
                    <p className="text-xs text-blue-700 mt-2">Motivo reapertura: {monthlyClosure.reopened_reason}</p>
                  )}
                </div>
                <div className="w-full lg:max-w-xl space-y-3">
                  {!isAdmin ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-900">Cierre requiere administración</p>
                      <p className="mt-1 text-xs text-amber-700">Finanzas puede revisar el reporte y solicitar aprobación sin ejecutar el cierre formal.</p>
                      <button
                        type="button"
                        onClick={() => requestAdminApproval(`${monthlyClosure?.status === 'closed' ? 'reapertura' : 'cierre'} del mes ${reportMonth}`, {
                          source_type: monthlyClosure?.status === 'closed' ? 'finance_monthly_reopen_approval' : 'finance_monthly_close_approval',
                          source_id: reportMonth,
                          source_label: 'Reporte mensual',
                        })}
                        className="mt-3 w-full rounded-2xl bg-amber-600 py-3 text-sm font-bold text-white transition-all hover:bg-amber-700"
                      >
                        Solicitar aprobación
                      </button>
                    </div>
                  ) : monthlyClosure?.status === 'closed' ? (
                    <>
                      <textarea aria-label="Motivo para reabrir el mes"
                        value={monthlyReopenReason}
                        onChange={(e) => setMonthlyReopenReason(e.target.value)}
                        rows={2}
                        placeholder="Motivo para reabrir el mes"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                      />
                      <button
                        onClick={handleReopenMonth}
                        disabled={isClosingMonth || monthlyReopenReason.trim().length < 3}
                        className="w-full py-3 bg-amber-600 text-white rounded-2xl text-sm font-bold hover:bg-amber-700 transition-all disabled:opacity-50"
                      >
                        {isClosingMonth ? 'Procesando...' : 'Reabrir Mes'}
                      </button>
                    </>
                  ) : (
                    <>
                      <textarea aria-label="Nota de cierre si quedan pendientes aceptados"
                        value={monthlyCloseNote}
                        onChange={(e) => setMonthlyCloseNote(e.target.value)}
                        rows={2}
                        placeholder="Nota de cierre si quedan pendientes aceptados"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                      />
                      <button
                        onClick={handleCloseMonth}
                        disabled={isClosingMonth || (Number(operationalCloseReport?.summary?.pendingItems || 0) > 0 && monthlyCloseNote.trim().length < 3)}
                        className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
                      >
                        {isClosingMonth ? 'Procesando...' : 'Cerrar Mes'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
<div className="glass-card overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Checklist de Cierre Operativo</h3>
                  <p className="text-xs text-slate-600 mt-1">
                    Mes {operationalCloseReport?.month || reportMonth} · Corte {operationalCloseReport?.meta?.cutOffDate || monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()} · {operationalCloseReport?.summary?.pendingItems ?? 0} pendiente(s) por ${Number(operationalCloseReport?.summary?.pendingAmount || 0).toLocaleString()}
                  </p>
                </div>
                <span className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
                  operationalStatusClasses[operationalCloseReport?.status || 'ok']
                )}>
                  <AlertCircle className="w-4 h-4" />
                  {operationalStatusLabels[operationalCloseReport?.status || 'ok']}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                {(operationalCloseReport?.checks ?? []).map((check: any) => (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => handleOperationalCheckClick(check.id)}
                    className="p-5 border-b border-slate-100 last:border-b-0 text-left hover:bg-slate-50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{check.label}</p>
                        <p className="text-xs text-slate-600 mt-1">{check.message}</p>
                        <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mt-3">Ver pendientes</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn(
                          "text-xl font-bold",
                          check.status === 'critical' ? "text-red-700" : check.status === 'warning' ? "text-amber-800" : "text-emerald-800"
                        )}>{check.count}</p>
                        {Number(check.amount || 0) > 0 && (
                          <p className="text-xs text-slate-600">${Number(check.amount || 0).toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {(operationalCloseReport?.checks ?? []).length === 0 && (
                  <FinanceEmptyState
                    title="Checklist sin datos para este mes."
                    description="Cuando existan cobros, gastos o movimientos pendientes, el checklist mostrará qué falta antes del cierre."
                  />
                )}
              </div>
            </div></div>);
}
