import { DataView } from '../../../ui/DataView';

import { AlertTriangle, Banknote, CheckCircle2 } from 'lucide-react';
import { CashSessionClosure, VisitorTicket } from '../../../types';

import { cn } from '../../../lib/utils';

import { paymentMethodLabels, formatCurrency } from './spacesShared';
import type { VisitorPaymentHistoryItem } from './spacesShared';
import { useSpaces } from './SpacesContext';
export default function VisitorOperationsPanel(){
const { canExportVisitorReports, fetchData, handleCompleteVisitor, handleLookupVisitor, isActionLoading, openVisitorPayment, quotingVisitorId, setIsCashCloseDrawerOpen, setVisitorLostTicket, setVisitorSearchPlate, visitorCashClosures, visitorCashSummary, visitorLookup, visitorLostTicket, visitorPaymentHistory, visitorSearchPlate, visitors, withBranchParam } = useSpaces();
return (<div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900 text-white rounded-2xl p-5 lg:col-span-1">
              <p className="text-xs font-bold text-white/50 uppercase tracking-wider">Caja abierta</p>
              <p className="text-2xl font-black mt-1">#{visitorCashSummary?.session.id || '-'}</p>
              <p className="text-xs text-white/60 mt-1">{visitorCashSummary?.session.status === 'open' ? 'En operación' : 'Sin caja abierta'}</p>
              <button
                type="button"
                onClick={() => setIsCashCloseDrawerOpen(true)}
                disabled={!visitorCashSummary || visitorCashSummary.session.status !== 'open'}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
              >
                <Banknote className="h-4 w-4" />
                Arqueo y cierre
              </button>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Efectivo esperado</p>
              <p className="text-2xl font-black mt-1">{formatCurrency(visitorCashSummary?.expectedCash)}</p>
              <p className="text-xs text-slate-600 mt-1">Según cobros en efectivo</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tarjeta / Transferencia</p>
              <p className="text-2xl font-black mt-1">{formatCurrency((visitorCashSummary?.totals.card || 0) + (visitorCashSummary?.totals.transfer || 0))}</p>
              <p className="text-xs text-slate-600 mt-1">Medios no efectivo</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Cobros caja</p>
              <p className="text-2xl font-black mt-1">{visitorCashSummary?.tickets.length || 0}</p>
              <p className="text-xs text-slate-600 mt-1">Tickets pagados en sesión</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={cn(
              "rounded-2xl border p-4",
              Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0
                ? "border-red-200 bg-red-50"
                : "border-emerald-200 bg-emerald-50"
            )}>
              <div className="flex items-start gap-3">
                {Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0 ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-800" />
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Bloqueo de cierre</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {Number(visitorCashSummary?.blockers.paidTicketsAwaitingExit || 0) > 0
                      ? `${visitorCashSummary?.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) sin salida`
                      : 'Sin tickets pagados pendientes de salida'}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Advertencias</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{visitorCashSummary?.warnings.activeVisitorTickets || 0} ticket(s) activos</p>
              <p className="text-xs text-amber-800/80 mt-1">No bloquea el cierre, pero queda visible para traspaso.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Último cierre</p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {visitorCashClosures[0]?.closed_at ? new Date(visitorCashClosures[0].closed_at).toLocaleString() : 'Sin cierres registrados'}
              </p>
              <p className={cn("text-xs font-bold mt-1", Number(visitorCashClosures[0]?.difference_cash || 0) === 0 ? "text-emerald-800" : "text-red-700")}>
                Diferencia: {formatCurrency(visitorCashClosures[0]?.difference_cash)}
              </p>
            </div>
          </div>

          <form onSubmit={handleLookupVisitor} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-end gap-4">
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-900">Salida por patente</p>
                <p className="text-sm text-slate-600 mt-1">Busca el ticket activo, recalcula por minuto efectivo y cobra desde una sola acción.</p>
              </div>
              <div className="lg:w-80">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">Patente</label>
                <input aria-label="Patente"
                  value={visitorSearchPlate}
                  onChange={e => setVisitorSearchPlate(e.target.value.toUpperCase())}
                  placeholder="Ej: ABCD12"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm uppercase focus:bg-white focus:border-slate-900 outline-none transition-all"
                />
              </div>
              <button type="submit" disabled={isActionLoading || !visitorSearchPlate.trim()} className="px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {isActionLoading ? 'Buscando...' : 'Buscar y cobrar'}
              </button>
            </div>
            <label className="flex w-fit items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
              <input
                type="checkbox"
                checked={visitorLostTicket}
                onChange={e => setVisitorLostTicket(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
              />
              Ticket perdido: buscar por patente y dejar auditoría
            </label>
            {visitorLookup && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Último ticket encontrado</p>
                  <p className="text-sm font-bold text-slate-900">#{visitorLookup.ticket.id} · {visitorLookup.ticket.plate} · {visitorLookup.ticket.space_name || 'Sin cupo'}</p>
                  <p className="text-xs text-slate-600 mt-1">Ingreso: {new Date(visitorLookup.ticket.entry_time).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {visitorLookup.ticket.status === 'active' && (
                    <button type="button" onClick={() => openVisitorPayment(visitorLookup.ticket)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">
                      Recalcular cobro
                    </button>
                  )}
                  {visitorLookup.ticket.status === 'paid' && (
                    <button type="button" onClick={() => handleCompleteVisitor(visitorLookup.ticket.id)} className="px-4 py-2 bg-emerald-700 text-white rounded-xl text-xs font-bold">
                      Autorizar salida
                    </button>
                  )}
                </div>
              </div>
            )}
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tickets activos</p>
              <p className="text-2xl font-black mt-1">{visitors.filter(v => v.status === 'active').length}</p>
              <p className="text-xs text-slate-600 mt-1">Pendientes de cobro por salida</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Tickets pagados</p>
              <p className="text-2xl font-black mt-1">{visitors.filter(v => v.status === 'paid').length}</p>
              <p className="text-xs text-slate-600 mt-1">Listos para autorizar salida</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Modalidad</p>
              <p className="text-lg font-black mt-1">Minuto efectivo</p>
              <p className="text-xs text-slate-600 mt-1">Sin redondeo al alza</p>
            </div>
          </div>
          <div className="glass-card overflow-x-auto">
            <DataView<VisitorTicket> caption="Tickets de visitas" items={visitors} getKey={v => v.id} emptyContent={<>{visitors.length === 0 && (
                <div>
                  <div className="p-4">No hay tickets activos</div>
                </div>
              )}</>} columns={[{ key: 'column-0', label: "ID Ticket", render: (v) => { 
return <>#TKT-
{v.id.toString().padStart(4, '0')}</>; } },
{ key: 'column-1', label: "Patente", primary: true, render: (v) => { 
return <>{v.plate}</>; } },
{ key: 'column-2', label: "Cupo", render: (v) => { 
return <>{v.space_name || (v.space_id ? `#${v.space_id}` : 'Sin cupo')}</>; } },
{ key: 'column-3', label: "Entrada", render: (v) => { 
return <>{new Date(v.entry_time).toLocaleTimeString()}</>; } },
{ key: 'column-4', label: "Estado", render: (v) => { 
return <>
<span className={cn(
                      "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                      v.status === 'paid' ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                    )}>
                      {v.status === 'paid' ? 'Pagado' : 'Activo'}
                    </span>
</>; } },
{ key: 'column-5', label: "Acciones", fullWidthOnMobile: true, render: (v) => { 
return <>
{v.status === 'active' ? (
                      <button
                        onClick={() => openVisitorPayment(v)}
                        disabled={quotingVisitorId === v.id || isActionLoading}
                        className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
                      >
                        {quotingVisitorId === v.id ? 'Calculando...' : 'Cobrar Ticket'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCompleteVisitor(v.id)}
                        className="text-xs font-bold text-emerald-800 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-all"
                      >
                        Autorizar Salida
                      </button>
                    )}
</>; } }]} />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial de cobros</h3>
                <p className="text-sm text-slate-600">Últimos comprobantes de visitas pagadas.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canExportVisitorReports && (
                  <>
                    <a href={withBranchParam('/api/visitors/payments/export.csv')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">CSV</a>
                    <a href={withBranchParam('/api/visitors/payments/export.xlsx')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">XLSX</a>
                  </>
                )}
                <button type="button" onClick={fetchData} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  Actualizar
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <DataView<VisitorPaymentHistoryItem> caption="Pagos de visitas" items={visitorPaymentHistory.slice(0, 8)} getKey={payment => payment.ticket_id} emptyContent={<>{visitorPaymentHistory.length === 0 && (
                    <div>
                      <div className="p-4">Sin cobros registrados</div>
                    </div>
                  )}</>} columns={[{ key: 'column-0', label: "Comprobante", render: (payment) => { 
return <>{payment.receipt_number}</>; } },
{ key: 'column-1', label: "Patente", primary: true, render: (payment) => { 
return <>{payment.plate}</>; } },
{ key: 'column-2', label: "Pago", render: (payment) => { 
return <>{new Date(payment.paid_at).toLocaleString()}</>; } },
{ key: 'column-3', label: "Método", render: (payment) => { 
return <>{paymentMethodLabels[payment.payment_method] || payment.payment_method}</>; } },
{ key: 'column-4', label: "Total", render: (payment) => { 
return <>{formatCurrency(payment.amount)}</>; } }]} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial de cierres</h3>
                <p className="text-sm text-slate-600">Arqueos cerrados con efectivo esperado, contado y diferencia.</p>
              </div>
              {canExportVisitorReports && (
                <div className="flex flex-wrap gap-2">
                  <a href={withBranchParam('/api/visitors/cash/closures/export.csv')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">CSV</a>
                  <a href={withBranchParam('/api/visitors/cash/closures/export.xlsx')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">XLSX</a>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <DataView<CashSessionClosure> caption="Cierres de caja" items={visitorCashClosures.slice(0, 6)} getKey={closure => closure.id} emptyContent={<>{visitorCashClosures.length === 0 && (
                    <div>
                      <div className="p-4">Sin cierres registrados</div>
                    </div>
                  )}</>} columns={[{ key: 'column-0', label: "Caja", primary: true, render: (closure) => { 
return <>#
{closure.id}</>; } },
{ key: 'column-1', label: "Cierre", render: (closure) => { 
return <>{closure.closed_at ? new Date(closure.closed_at).toLocaleString() : '-'}</>; } },
{ key: 'column-2', label: "Responsable", render: (closure) => { 
return <>{closure.staff_name || closure.closed_by_name || 'Caja'}</>; } },
{ key: 'column-3', label: "Esperado", render: (closure) => { 
return <>{formatCurrency(closure.expected_cash)}</>; } },
{ key: 'column-4', label: "Contado", render: (closure) => { 
return <>{formatCurrency(closure.counted_cash)}</>; } },
{ key: 'column-5', label: "Diferencia", render: (closure) => { 
return <>
{formatCurrency(closure.difference_cash)}
</>; } }]} />
            </div>
          </div>
        </div>);
}
