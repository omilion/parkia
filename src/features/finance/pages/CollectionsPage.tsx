import { Clock, Filter, Mail, MessageCircle, Phone, Send } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';
export default function CollectionsPage() {
  const { buildCollectionMessage, collectionQueue, collectionQueueDue, collectionQueueStatus, copyText, handleCompleteCollectionAction, handleTabChange, isLoading, isSavingCollectionAction, normalizePhoneForWhatsApp, openCollectionCount, openCollectionDrawer, openCollectionPaymentFromAction, overdueCollectionCount, overdueReceivables, overdueReceivablesTotal, setCollectionQueueDue, setCollectionQueueStatus, setPaymentReviewFilter, setPaymentSearch, setPaymentStatus, todayCollectionCount, todayIso, unmanagedOverdueReceivables } = useFinance();
  return (<div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <button
                onClick={() => {
                  setPaymentStatus('overdue');
                  setPaymentSearch('');
                  setPaymentReviewFilter('all');
                  handleTabChange('payments');
                }}
                className="text-left bg-white border border-red-200 rounded-2xl p-4 transition-all hover:bg-red-50"
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Cuentas en mora</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{overdueReceivables.length}</p>
                <p className="text-xs font-semibold text-red-700 mt-1">${overdueReceivablesTotal.toLocaleString()}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('overdue'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'overdue' ? "border-red-200 bg-red-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gestiones atrasadas</p>
                <p className="text-2xl font-bold text-red-700 mt-1">{overdueCollectionCount}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('today'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'today' ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Gestiones para hoy</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{todayCollectionCount}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'all' ? "border-slate-300 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Seguimientos abiertos</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{openCollectionCount}</p>
              </button>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Cuentas en mora para gestionar</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Punto de partida para iniciar cobranza desde una deuda vencida. Una gestión abierta queda luego en la cola de seguimiento.
                  </p>
                </div>
                {unmanagedOverdueReceivables.length > 0 && (
                  <span className="w-fit rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-700">
                    {unmanagedOverdueReceivables.length} sin gestión abierta
                  </span>
                )}
              </div>

              {overdueReceivables.length === 0 ? (
                <FinanceEmptyState
                  title="No hay cuentas morosas."
                  description="Cuando una cuenta por cobrar quede atrasada, aparecerá aquí para iniciar contacto de cobranza."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {overdueReceivables.slice(0, 8).map(payment => {
                    const daysOverdue = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(payment.due_date).getTime()) / (1000 * 60 * 60 * 24)));
                    const openActions = Number(payment.open_collection_actions_count || 0);
                    return (
                      <div key={payment.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-slate-50 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-slate-900">{payment.client_name}</p>
                            <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-700">
                              {daysOverdue} día{daysOverdue === 1 ? '' : 's'} de atraso
                            </span>
                            {openActions > 0 && (
                              <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-700">
                                {openActions} seguimiento{openActions === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            Pago #PAG-{payment.id.toString().padStart(4, '0')} · Contrato #CON-{payment.contract_id_display?.toString().padStart(3, '0')} · Venció {payment.due_date}
                          </p>
                          {payment.latest_collection_note && (
                            <p className="mt-2 max-w-3xl text-xs text-blue-700">{payment.latest_collection_note}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-sm font-bold text-red-700">${Number(payment.remaining_amount ?? payment.amount ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-slate-600">Saldo pendiente</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openCollectionDrawer(payment)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-slate-800"
                          >
                            <Send className="h-4 w-4" />
                            Iniciar gestión
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {overdueReceivables.length > 8 && (
                    <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-4">
                      <p className="text-xs font-semibold text-slate-600">
                        Hay {overdueReceivables.length - 8} cuenta{overdueReceivables.length - 8 === 1 ? '' : 's'} morosa{overdueReceivables.length - 8 === 1 ? '' : 's'} adicional{overdueReceivables.length - 8 === 1 ? '' : 'es'}.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentStatus('overdue');
                          setPaymentSearch('');
                          setPaymentReviewFilter('all');
                          handleTabChange('payments');
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-100"
                      >
                        Ver todas en cuentas por cobrar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600" />
                <select aria-label="Abiertos"
                  value={collectionQueueStatus}
                  onChange={(e) => setCollectionQueueStatus(e.target.value as 'open' | 'done' | 'all')}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="open">Abiertos</option>
                  <option value="done">Cerrados</option>
                  <option value="all">Todos</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-600" />
                <select aria-label="Todas las fechas"
                  value={collectionQueueDue}
                  onChange={(e) => setCollectionQueueDue(e.target.value as 'all' | 'overdue' | 'today' | 'upcoming' | 'actionable')}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="all">Todas las fechas</option>
                  <option value="actionable">Atrasadas o de hoy</option>
                  <option value="overdue">Atrasadas</option>
                  <option value="today">Hoy</option>
                  <option value="upcoming">Próximas</option>
                </select>
              </div>
            </div>

            <div className="glass-card divide-y divide-slate-100">
              {isLoading && (
                <p className="p-8 text-center text-sm text-slate-600">Cargando cola de cobranza...</p>
              )}
              {!isLoading && collectionQueue.length === 0 && (
                <FinanceEmptyState
                  title={collectionQueueStatus === 'open' ? 'No hay gestiones abiertas.' : 'No hay gestiones para esos filtros.'}
                  description={collectionQueueStatus === 'open' ? 'La cobranza pendiente está al día. Cuando se registre una gestión futura aparecerá aquí.' : 'Ajusta estado o fecha para revisar el historial de cobranza.'}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setCollectionQueueStatus('all');
                        setCollectionQueueDue('all');
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                    >
                      Ver todas las gestiones
                    </button>
                  }
                />
              )}
              {!isLoading && collectionQueue.map(action => {
                const isOverdue = action.status === 'open' && action.next_action_at && action.next_action_at < todayIso;
                const isToday = action.status === 'open' && action.next_action_at === todayIso;
                return (
                  <div key={action.id} className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">{action.client_name}</p>
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          action.status === 'done' ? "bg-emerald-100 text-emerald-700" :
                            isOverdue ? "bg-red-100 text-red-700" :
                              isToday ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {action.status === 'done' ? 'Cerrado' : isOverdue ? 'Atrasado' : isToday ? 'Hoy' : 'Abierto'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        Pago #PAG-{action.payment_id.toString().padStart(4, '0')} · Contrato #CON-{action.contract_id_display?.toString().padStart(3, '0')} · RUT {action.client_rut}
                      </p>
                      <p className="text-sm text-slate-700 mt-2 max-w-3xl">{action.note}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-600">
                        <span>{action.channel === 'phone' ? 'Teléfono' : action.channel === 'whatsapp' ? 'WhatsApp' : action.channel === 'email' ? 'Email' : action.channel === 'in_person' ? 'Presencial' : 'Otro'}</span>
                        <span>{action.staff_name || 'Sistema'}</span>
                        {action.next_action_at && <span>Próxima acción: {action.next_action_at}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyText(action.client_phone, 'Teléfono')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Copiar teléfono
                        </button>
                        <button
                          type="button"
                          onClick={() => copyText(action.client_email, 'Email')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Copiar email
                        </button>
                        {normalizePhoneForWhatsApp(action.client_phone) && (
                          <a
                            href={`https://wa.me/${normalizePhoneForWhatsApp(action.client_phone)}?text=${encodeURIComponent(buildCollectionMessage({
                              id: action.payment_id,
                              contract_id: Number(action.contract_id_display || 0),
                              amount: Number(action.payment_amount || 0),
                              due_date: action.payment_due_date || '',
                              payment_date: null,
                              status: action.payment_status || 'pending',
                              method: null,
                              reference: null,
                              receipt_file_path: null,
                              receipt_file_name: null,
                              receipt_mime_type: null,
                              client_name: action.client_name,
                              client_rut: action.client_rut,
                              contract_id_display: action.contract_id_display,
                              remaining_amount: action.payment_remaining_amount,
                              client_email: action.client_email,
                              client_phone: action.client_phone,
                            }))}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-all hover:bg-emerald-100"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-left xl:text-right shrink-0">
                      <p className="text-sm font-bold text-slate-900">${Number(action.payment_remaining_amount ?? action.payment_amount ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-slate-600">Vence {action.payment_due_date}</p>
                      <div className="mt-3 flex xl:justify-end gap-2">
                        <button
                          onClick={() => openCollectionPaymentFromAction(action)}
                          className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-lg transition-all"
                        >
                          Ver Gestión
                        </button>
                        {action.status === 'open' && (
                          <button
                            onClick={() => handleCompleteCollectionAction(action)}
                            disabled={isSavingCollectionAction}
                            className="text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                          >
                            Cerrar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>);
}
