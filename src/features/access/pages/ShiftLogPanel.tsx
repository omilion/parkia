import { Banknote, CheckCircle2, ClipboardList, ExternalLink, FileDown, Plus } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { shiftNameLabels, shiftEntryCategoryLabels, shiftPriorityLabels, statusLabelsForShiftTask, formatCurrency, ShiftFollowUpCard } from './accessShared';

import { useAccess } from './AccessContext';
import ShiftOpenForm from './ShiftOpenForm';
import ShiftEntryForm from './ShiftEntryForm';
import ShiftCloseForm from './ShiftCloseForm';
export default function ShiftLogPanel(){
const { cashSummary, downloadServerCsv, fetchShiftDetail, fetchShiftFollowUps, handleResolveShiftEntry, inheritedShiftFollowUps, isActionLoading, selectedShiftLog, setShiftStatusFilter, shiftEntries, shiftFollowUps, shiftLogs, shiftStatusFilter, spaces, withBranch } = useAccess();
return (<div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Turno seleccionado</p>
                  <p className="text-2xl font-black mt-1">{selectedShiftLog ? shiftNameLabels[selectedShiftLog.shift_name] : '-'}</p>
                  <p className="text-xs text-slate-600 mt-1">{selectedShiftLog?.staff_name || 'Sin turno activo'}</p>
                  {selectedShiftLog?.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mt-1">{selectedShiftLog.branch_name}</p>}
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Novedades</p>
                  <p className="text-2xl font-black mt-1">{selectedShiftLog?.entries_count || 0}</p>
                  <p className="text-xs text-slate-600 mt-1">Registradas en el turno</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Pendientes</p>
                  <p className={cn("text-2xl font-black mt-1", (selectedShiftLog?.pending_follow_ups || 0) > 0 ? "text-amber-800" : "text-emerald-800")}>
                    {selectedShiftLog?.pending_follow_ups || 0}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Requieren seguimiento</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-5">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Caja esperada</p>
                  <p className="text-2xl font-black mt-1">{formatCurrency(cashSummary?.expectedCash)}</p>
                  <p className="text-xs text-slate-600 mt-1">{cashSummary?.tickets.length || 0} ticket(s) cobrados</p>
                </div>
              </div>

              {!selectedShiftLog && (
                <ShiftOpenForm variant="full" />
              )}

              {inheritedShiftFollowUps.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-amber-950">Pendientes heredados</h3>
                    <p className="text-sm text-amber-700">Seguimientos abiertos de turnos anteriores que siguen requiriendo acción.</p>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {inheritedShiftFollowUps.map(entry => (
                      <ShiftFollowUpCard key={entry.id} entry={entry} onResolve={handleResolveShiftEntry} isActionLoading={isActionLoading} />
                    ))}
                  </div>
                </div>
              )}

              {selectedShiftLog && (
                <div className="space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">Bitácora #{selectedShiftLog.id}</h3>
                        <p className="text-sm text-slate-600">
                          {selectedShiftLog.shift_date} · {shiftNameLabels[selectedShiftLog.shift_name]} · {selectedShiftLog.status === 'open' ? 'Abierta' : 'Cerrada'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => downloadServerCsv(`/api/access/shift-logs/${selectedShiftLog.id}/export.csv`)}
                          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-2"
                          title="Exportar bitácora de turno"
                        >
                          <FileDown className="w-4 h-4" />
                          Exportar CSV
                        </button>
                        <span className={cn(
                          "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider w-fit",
                          selectedShiftLog.status === 'open' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                        )}>
                          {selectedShiftLog.status === 'open' ? 'En curso' : 'Cerrada'}
                        </span>
                      </div>
                    </div>

                    {selectedShiftLog.opening_notes && (
                      <div className="p-4 bg-slate-50 rounded-xl">
                        <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Recepción de turno</p>
                        <p className="text-sm text-slate-700">{selectedShiftLog.opening_notes}</p>
                      </div>
                    )}

                    {cashSummary && (
                      <div className="p-4 bg-slate-50 rounded-xl space-y-4">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700">
                              <Banknote className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Caja operacional</p>
                              <p className="text-sm font-bold text-slate-900">
                                {cashSummary.session.status === 'open' ? 'Abierta' : 'Cerrada'} · Caja #{cashSummary.session.id}
                              </p>
                            </div>
                          </div>
                          <div className="text-left md:text-right">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Efectivo esperado</p>
                            <p className="text-xl font-black text-slate-900">{formatCurrency(cashSummary.expectedCash)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Efectivo</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.cash)}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Transferencia</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.transfer)}</p>
                          </div>
                          <div className="rounded-xl bg-white border border-slate-200 p-3">
                            <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tarjeta</p>
                            <p className="text-base font-black text-slate-900">{formatCurrency(cashSummary.totals.card)}</p>
                          </div>
                        </div>
                        {(cashSummary.blockers.paidTicketsAwaitingExit > 0 || cashSummary.warnings.activeVisitorTickets > 0 || cashSummary.warnings.unresolvedDeniedExits > 0) && (
                          <div className="flex flex-wrap gap-2">
                            {cashSummary.blockers.paidTicketsAwaitingExit > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs font-bold">
                                {cashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagados sin salida
                              </span>
                            )}
                            {cashSummary.warnings.activeVisitorTickets > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">
                                {cashSummary.warnings.activeVisitorTickets} visita(s) activa(s)
                              </span>
                            )}
                            {cashSummary.warnings.unresolvedDeniedExits > 0 && (
                              <span className="px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">
                                {cashSummary.warnings.unresolvedDeniedExits} salida(s) denegada(s)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedShiftLog.status === 'open' && (
                      <ShiftEntryForm />
                    )}
                  </div>

                  <div className="space-y-3">
                    {shiftEntries.map(entry => (
                      <div key={entry.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold uppercase tracking-wider">
                              {shiftEntryCategoryLabels[entry.category]}
                            </span>
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                              entry.priority === 'critical' ? "bg-red-100 text-red-700" :
                                entry.priority === 'high' ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-700"
                            )}>
                              {shiftPriorityLabels[entry.priority]}
                            </span>
                            {entry.follow_up_required && (
                              <span className={cn(
                                "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                                entry.resolved_at ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                              )}>
                                {entry.resolved_at ? 'Seguimiento resuelto' : 'Seguimiento pendiente'}
                              </span>
                            )}
                            {entry.task_id && (
                              <span className="px-2 py-1 rounded-lg bg-sky-50 text-sky-700 text-xs font-bold uppercase tracking-wider">
                                Tarea #{entry.task_id} · {entry.task_status ? statusLabelsForShiftTask[entry.task_status] : 'Activa'}
                              </span>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{entry.title}</p>
                            {entry.detail && <p className="text-sm text-slate-600 mt-1">{entry.detail}</p>}
                            {entry.attachment_id && (
                              <a
                                href={`/api/access/shift-log-entries/${entry.id}/attachments/${entry.attachment_id}/download`}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Evidencia: {entry.attachment_file_name || 'archivo adjunto'}
                              </a>
                            )}
                            <p className="text-xs text-slate-600 mt-2">
                              {new Date(entry.created_at).toLocaleString()} · {entry.staff_name}
                              {entry.related_space_name ? ` · ${entry.related_space_name}` : ''}
                            </p>
                          </div>
                        </div>
                        {entry.follow_up_required && selectedShiftLog.status === 'open' && (
                          <button
                            onClick={() => handleResolveShiftEntry(entry)}
                            title={entry.resolved_at ? 'Reabrir seguimiento' : 'Marcar seguimiento resuelto'}
                            className={cn(
                              "px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 w-fit",
                              entry.resolved_at ? "bg-white border border-slate-200 text-slate-600" : "bg-emerald-700 text-white"
                            )}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {entry.resolved_at ? 'Reabrir' : 'Resolver'}
                          </button>
                        )}
                      </div>
                    ))}
                    {shiftEntries.length === 0 && (
                      <div className="p-8 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                        <ClipboardList className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                        <p className="text-sm font-bold text-slate-600">Sin novedades registradas</p>
                      </div>
                    )}
                  </div>

                  {selectedShiftLog.status === 'open' && (
                    <ShiftCloseForm />
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">Seguimientos abiertos</h3>
                    <p className="text-xs text-slate-600">{shiftFollowUps.length} pendiente(s) activos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadServerCsv(withBranch('/api/access/export/shift-log-follow-ups.csv?status=open'))}
                      className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:text-slate-900"
                      title="Exportar seguimientos abiertos"
                    >
                      <FileDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={fetchShiftFollowUps} className="text-xs font-bold text-slate-600 hover:text-slate-900">Actualizar</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {shiftFollowUps.slice(0, 4).map(entry => (
                    <ShiftFollowUpCard key={entry.id} entry={entry} onResolve={handleResolveShiftEntry} isActionLoading={isActionLoading} />
                  ))}
                  {shiftFollowUps.length === 0 && (
                    <div className="p-5 border-2 border-dashed border-slate-100 rounded-2xl text-center">
                      <p className="text-sm font-bold text-slate-600">Sin seguimientos abiertos</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold">Turnos</h3>
                <select aria-label="Abiertos" value={shiftStatusFilter} onChange={(e) => setShiftStatusFilter(e.target.value as 'open' | 'closed' | 'all')} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="open">Abiertos</option>
                  <option value="closed">Cerrados</option>
                  <option value="all">Todos</option>
                </select>
              </div>

              <ShiftOpenForm variant="compact" />

              <div className="space-y-3">
                {shiftLogs.map(log => (
                  <button
                    key={log.id}
                    onClick={() => fetchShiftDetail(log.id)}
                    className={cn(
                      "w-full text-left bg-white border rounded-2xl p-4 transition-all",
                      selectedShiftLog?.id === log.id ? "border-slate-900 shadow-sm" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{shiftNameLabels[log.shift_name]} · {log.shift_date}</p>
                        <p className="text-xs text-slate-600">{log.staff_name}</p>
                      </div>
                      <span className={cn(
                        "px-2 py-1 rounded-lg text-xs font-bold uppercase",
                        log.status === 'open' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      )}>
                        {log.status === 'open' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-600">
                      <span>{log.entries_count} novedades</span>
                      <span>{log.pending_follow_ups} pendientes</span>
                    </div>
                  </button>
                ))}
                {shiftLogs.length === 0 && (
                  <div className="p-6 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                    <p className="text-sm font-bold text-slate-600">No hay turnos para este filtro</p>
                  </div>
                )}
              </div>
            </div>
          </div>);
}
