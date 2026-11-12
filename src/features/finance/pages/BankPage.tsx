import { AlertCircle, CheckCircle2, Pencil, Search } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';
export default function BankPage() {
  const { filteredMovements, getReportMonthEnd, handleManualReconcile, hasMovementFilters, isAdmin, isAllocating, isReconciling, isReversingAllocation, monthlyCloseReport, movementAllocationHistory, movementReportMonth, movementSearch, movementStatus, movementSuggestions, partialMovementsCount, pendingMovementsCount, pendingReconcilePayments, reconciledMovementsCount, selectedMovement, setAllocationPayment, setEditingMovement, setMovementReportMonth, setMovementSearch, setMovementStatus, setReverseAllocation, setSelectedMovement, suggestionByPaymentId } = useFinance();
  return (<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <button
                  onClick={() => { setMovementStatus('attention'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'attention' ? "border-red-200 bg-red-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Por resolver</p>
                  <p className="text-xl font-bold text-red-700 mt-1">{pendingMovementsCount + partialMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('pending'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'pending' ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pendientes</p>
                  <p className="text-xl font-bold text-amber-800 mt-1">{pendingMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('partial'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'partial' ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Parciales</p>
                  <p className="text-xl font-bold text-blue-600 mt-1">{partialMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('reconciled'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'reconciled' ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Conciliados</p>
                  <p className="text-xl font-bold text-emerald-800 mt-1">{reconciledMovementsCount}</p>
                </button>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <Search className="w-4 h-4 text-slate-600" />
                  <input aria-label="Buscar en cartola por RUT, glosa, nota o monto..."
                    type="text"
                    value={movementSearch}
                    onChange={(e) => { setMovementSearch(e.target.value); setMovementReportMonth(null); }}
                    placeholder="Buscar en cartola por RUT, glosa, nota o monto..."
                    className="bg-transparent border-none outline-none text-sm w-full"
                  />
                </div>
              </div>
              {movementReportMonth && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-sm font-bold text-blue-700">
                    Cartola filtrada desde reporte · Mes {movementReportMonth} · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                  </p>
                  <button onClick={() => setMovementReportMonth(null)} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                    Limpiar filtro
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center">
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Cartola Bancaria</h4>
                <span className="text-xs text-slate-600">{filteredMovements.length} movimientos</span>
              </div>
              <div className="glass-card divide-y divide-slate-100">
                {filteredMovements.length === 0 && (
                  <FinanceEmptyState
                    title={hasMovementFilters ? 'No hay movimientos bancarios para ese filtro.' : 'Sin movimientos bancarios importados.'}
                    description={hasMovementFilters ? 'Limpia la búsqueda o revisa otro estado de conciliación.' : 'Importa un CSV de cartola; la conciliación automática trabaja solo sobre movimientos importados.'}
                    action={hasMovementFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMovementSearch('');
                          setMovementStatus('all');
                          setMovementReportMonth(null);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                      >
                        Limpiar filtros
                      </button>
                    ) : undefined}
                  />
                )}
                {filteredMovements.map(m => (
                  <div
                    key={m.id}
                    className={cn(
                      "p-4 flex justify-between items-center hover:bg-slate-50 transition-colors",
                      selectedMovement?.id === m.id && "bg-blue-50/70"
                    )}
                  >
                    <div>
                      <p className="text-sm font-bold">{m.description}</p>
                      <p className="text-xs text-slate-600">{m.date} • RUT: {m.rut}</p>
                      {m.notes && (
                        <p className="text-xs text-amber-700 mt-1 max-w-[260px]">{m.notes}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-800">+${m.amount.toLocaleString()}</p>
                      {(m.allocated_amount || 0) > 0 && (
                        <p className="text-xs font-bold text-slate-600">
                          Abonado ${Number(m.allocated_amount || 0).toLocaleString()} · Saldo ${Number(m.remaining_amount || 0).toLocaleString()}
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        {m.status === 'reconciled' ? (
                          <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Conciliado
                          </span>
                        ) : m.status === 'partial' ? (
                          <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Parcial
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-amber-800 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Pendiente
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        {m.status !== 'reconciled' && (
                          <button
                            onClick={() => setEditingMovement(m)}
                            className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-all inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" />
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedMovement(m)}
                          className={cn(
                            "text-xs font-bold px-3 py-1.5 rounded-lg transition-all",
                            selectedMovement?.id === m.id
                              ? "bg-blue-600 text-white"
                              : "text-blue-600 hover:bg-blue-50"
                          )}
                        >
                          {selectedMovement?.id === m.id ? 'Seleccionado' : m.status === 'reconciled' ? 'Ver' : 'Seleccionar'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Cuentas por Cobrar Pendientes</h4>
                <span className="text-xs text-slate-600">
                  {selectedMovement ? `${movementSuggestions.length} sugerencias` : `${pendingReconcilePayments.length} deudas`}
                </span>
              </div>
              {selectedMovement && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Movimiento seleccionado</p>
                  <p className="text-sm font-bold text-slate-900 mt-1">
                    ${selectedMovement.amount.toLocaleString()} • {selectedMovement.description}
                  </p>
                  <p className="text-xs text-slate-600">
                    RUT {selectedMovement.rut} • {selectedMovement.date} • Disponible ${Number(selectedMovement.remaining_amount ?? selectedMovement.amount).toLocaleString()}
                  </p>
                </div>
              )}
              {selectedMovement && movementAllocationHistory.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Historial del movimiento</p>
                    <span className="text-xs font-bold text-slate-600">{movementAllocationHistory.length} abonos</span>
                  </div>
                  <div className="space-y-3">
                    {movementAllocationHistory.map(allocation => (
                      <div key={allocation.id} className={cn(
                        "flex justify-between gap-4 rounded-xl px-3 py-2",
                        allocation.reversed_at ? "bg-red-50 border border-red-100" : "bg-slate-50"
                      )}>
                        <div className="min-w-0">
                          <p className={cn("text-sm font-bold", allocation.reversed_at ? "text-red-800 line-through" : "text-slate-900")}>{allocation.client_name}</p>
                          <p className="text-xs text-slate-600">
                            Pago #PAG-{allocation.payment_id.toString().padStart(4, '0')} · Contrato #CON-{allocation.contract_id_display?.toString().padStart(3, '0')}
                          </p>
                          {allocation.note && <p className="text-xs text-amber-700 mt-1">{allocation.note}</p>}
                          {allocation.reversed_note && <p className="text-xs text-red-700 mt-1">Reversado: {allocation.reversed_note}</p>}
                        </div>
                        <div className="text-right">
                          <p className={cn("text-sm font-bold whitespace-nowrap", allocation.reversed_at ? "text-red-700 line-through" : "text-emerald-800")}>${allocation.amount.toLocaleString()}</p>
                          {!allocation.reversed_at && isAdmin && (
                            <button
                              onClick={() => setReverseAllocation(allocation)}
                              disabled={isReversingAllocation}
                              className="mt-1 text-xs font-bold text-red-700 hover:bg-red-100 px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                            >
                              Reversar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="glass-card divide-y divide-slate-100">
                {pendingReconcilePayments.map(p => {
                  const suggestion = suggestionByPaymentId.get(p.id);
                  return (
                  <div key={p.id} className={cn(
                    "p-4 flex justify-between items-center group",
                    suggestion && "bg-emerald-50/50"
                  )}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{p.client_name}</p>
                      <p className="text-xs text-slate-600">RUT {p.client_rut} • Vence: {p.due_date}</p>
                      {suggestion && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-xs font-bold">
                            Match {suggestion.score}%
                          </span>
                          {suggestion.reasons.map(reason => (
                            <span key={reason} className="px-2 py-0.5 rounded-md bg-white text-slate-600 text-xs font-bold border border-emerald-100">
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">${p.amount.toLocaleString()}</p>
                      {(p.allocated_amount || 0) > 0 && (
                        <p className="text-xs font-bold text-slate-600">
                          Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
                        </p>
                      )}
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          onClick={() => handleManualReconcile(p)}
                          disabled={
                            !selectedMovement ||
                            Number(selectedMovement.remaining_amount ?? selectedMovement.amount) !== Number(p.remaining_amount ?? p.amount) ||
                            isReconciling
                          }
                          className="text-xs font-bold text-blue-600 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all disabled:text-slate-300 disabled:cursor-not-allowed"
                        >
                          {!selectedMovement
                            ? 'Seleccione cartola'
                            : Number(selectedMovement.remaining_amount ?? selectedMovement.amount) !== Number(p.remaining_amount ?? p.amount)
                              ? 'Saldo distinto'
                              : 'Vincular'}
                        </button>
                        <button
                          onClick={() => setAllocationPayment(p)}
                          disabled={!selectedMovement || Number(selectedMovement.remaining_amount ?? selectedMovement.amount) <= 0 || isAllocating}
                          className="text-xs font-bold text-emerald-800 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all disabled:text-slate-300 disabled:cursor-not-allowed"
                        >
                          Abonar
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {pendingReconcilePayments.length === 0 && (
                  <FinanceEmptyState
                    title="No hay cuentas pendientes para conciliar."
                    description="Todas las cuentas por cobrar están pagadas o no existen cobros abiertos para vincular con cartola."
                  />
                )}
              </div>
            </div>
          </div>);
}
