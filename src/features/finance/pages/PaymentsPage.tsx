import { DataView } from '../../../ui/DataView';

import { Clock, Download, Filter, Search } from 'lucide-react';
import { Payment } from '../../../types';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';
export default function PaymentsPage() {
  const { filteredPayments, getReportMonthEnd, handleTabChange, hasPaymentFilters, isAdmin, isLoading, loadError, monthlyCloseReport, openCollectionDrawer, openPaymentDetail, paymentReportMonth, paymentReportMonthField, paymentReviewFilter, paymentReviewLabels, paymentSearch, paymentStatus, requestAdminApproval, resetPaymentReview, setAdjustmentPayment, setHistoryPayment, setIsDrawerOpen, setPaymentSearch, setPaymentStatus, setSelectedPayment } = useFinance();
  return (<div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Search className="w-5 h-5 text-slate-600" />
                <input aria-label="Buscar por Cliente o Contrato..."
                  type="text"
                  placeholder="Buscar por Cliente o Contrato..."
                  className="bg-transparent border-none outline-none text-sm w-full"
                  value={paymentSearch}
                  onChange={(e) => { setPaymentSearch(e.target.value); resetPaymentReview(); }}
                />
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600" />
                <select aria-label="Todos"
                  value={paymentStatus}
                  onChange={(e) => { setPaymentStatus(e.target.value); resetPaymentReview(); }}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="all">Todos</option>
                  <option value="pending">Pendientes</option>
                  <option value="overdue">Atrasados</option>
                  <option value="paid">Pagados</option>
                  <option value="cancelled">Cancelados</option>
                </select>
              </div>
            </div>
            {(paymentReviewFilter !== 'all' || paymentReportMonth) && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm font-bold text-blue-700">
                  {paymentReviewFilter !== 'all' ? paymentReviewLabels[paymentReviewFilter] : 'Pagos filtrados desde reporte'}
                  {paymentReportMonth ? ` · Mes ${paymentReportMonth}` : ''}
                  {paymentReportMonthField === 'due' ? ' · Fecha vencimiento' : paymentReportMonthField === 'paid' ? ' · Fecha pago' : ''}
                  · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                </p>
                <button onClick={resetPaymentReview} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                  Limpiar filtro
                </button>
              </div>
            )}

            <div className="glass-card overflow-x-auto">
              <DataView<Payment> caption="Cuentas por cobrar" items={loadError ? [] : filteredPayments} getKey={p => p.id} loading={isLoading} emptyContent={<>{isLoading && (
                    <div>
                      <div className="p-4">Cargando cuentas por cobrar...</div>
                    </div>
                  )}
{!isLoading && loadError && (
                    <div>
                      <div className="p-4">{loadError}</div>
                    </div>
                  )}
{!isLoading && !loadError && filteredPayments.length === 0 && (
                    <div>
                      <div className="p-4">
                        <FinanceEmptyState
                          title={hasPaymentFilters ? 'No hay cuentas por cobrar para esos filtros.' : 'Sin cuentas por cobrar cargadas.'}
                          description={hasPaymentFilters ? 'Limpia filtros o cambia el estado para revisar toda la cartera.' : 'Las cuentas aparecerán cuando existan contratos con cobros emitidos.'}
                          action={hasPaymentFilters ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentSearch('');
                                setPaymentStatus('all');
                                resetPaymentReview();
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              Limpiar filtros
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleTabChange('reports')}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                            >
                              Ver reportes
                            </button>
                          )}
                        />
                      </div>
                    </div>
                  )}</>} columns={[{ key: 'column-0', label: "ID Pago", render: (p) => { 
return <>#PAG-
{p.id.toString().padStart(4, '0')}</>; } },
{ key: 'column-1', label: "Cliente", primary: true, render: (p) => { 
return <>
<p className="text-sm font-bold">{p.client_name}</p>

<p className="text-xs text-slate-600">Contrato #CON-{p.contract_id_display?.toString().padStart(3, '0')}</p>

{p.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{p.branch_name}</p>}

{p.latest_collection_note && (
                          <p className="text-xs text-blue-700 mt-1 max-w-[260px]">{p.latest_collection_note}</p>
                        )}
</>; } },
{ key: 'column-2', label: "Vencimiento", render: (p) => { 
return <>{new Date(p.due_date).toLocaleDateString()}</>; } },
{ key: 'column-3', label: "Monto", render: (p) => { 
return <>
<p className="text-sm font-bold">${p.amount.toLocaleString()}</p>

{(p.allocated_amount || 0) > 0 && (
                          <p className="text-xs font-bold text-slate-600">
                            Abonado ${Number(p.allocated_amount || 0).toLocaleString()} · Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
                          </p>
                        )}
</>; } },
{ key: 'column-4', label: "Estado", render: (p) => { 
return <>
<span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          p.status === 'paid' ? "bg-emerald-100 text-emerald-800" :
                            p.status === 'overdue' ? "bg-red-100 text-red-700" :
                              p.status === 'cancelled' ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"
                        )}>
                          {p.status === 'paid' ? 'Pagado' : p.status === 'overdue' ? 'Atrasado' : p.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                        </span>

{(p.open_collection_actions_count || 0) > 0 && (
                          <p className="text-xs font-bold text-blue-600 mt-1">
                            {p.open_collection_actions_count} seguimiento{Number(p.open_collection_actions_count) === 1 ? '' : 's'}
                            {p.next_collection_action_at ? ` · ${p.next_collection_action_at}` : ''}
                          </p>
                        )}
</>; } },
{ key: 'column-5', label: "Acciones", fullWidthOnMobile: true, render: (p) => { 
return <>
<button
                          onClick={() => openPaymentDetail(p)}
                          className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                        >
                          Ficha
                        </button>

{p.status !== 'paid' && p.status !== 'cancelled' && (
                          <>
                            <button
                              onClick={() => { openCollectionDrawer(p); }}
                              className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                            >
                              Cobranza
                            </button>
                            <button
                              onClick={() => { setSelectedPayment(p); setIsDrawerOpen(true); }}
                              className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all"
                            >
                              Registrar Pago
                            </button>
                            {isAdmin ? (
                              <button
                                onClick={() => setAdjustmentPayment(p)}
                                className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-all"
                              >
                                Ajuste
                              </button>
                            ) : (
                              <button
                                onClick={() => requestAdminApproval(`ajuste de pago #PAG-${p.id.toString().padStart(4, '0')}`, { source_type: 'finance_payment_adjustment', source_id: p.id, source_label: 'Pago' })}
                                className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-all"
                              >
                                Solicitar aprobación
                              </button>
                            )}
                          </>
                        )}

{p.status === 'paid' && p.receipt_file_path && (
                          <a
                            href={`/api/finance/payments/${p.id}/receipt`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Comprobante
                          </a>
                        )}

{(p.allocated_amount || 0) > 0 && (
                          <button
                            onClick={() => setHistoryPayment(p)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            Historial
                          </button>
                        )}
</>; } }]} />
            </div>
          </div>);
}
