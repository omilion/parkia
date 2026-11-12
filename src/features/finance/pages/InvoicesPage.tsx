import { DataView } from '../../../ui/DataView';

import { Download, FileJson, RefreshCw } from 'lucide-react';
import { Invoice } from '../../../types';

import { cn } from '../../../lib/utils';
import { formatDteType, getInvoiceStatusLabel, FinanceEmptyState } from './financeShared';

import { useFinance } from './FinanceContext';
export default function InvoicesPage() {
  const { acceptedInvoicesCount, downloadInvoiceFile, filteredInvoices, handleIssueInvoice, handleSyncInvoice, handleTabChange, invoiceActionId, invoiceStatus, invoices, isLoading, loadError, pendingInvoicesCount, rejectedInvoicesCount, setInvoiceStatus, siiReadiness } = useFinance();
  return (<div className="space-y-5">
            <div className={cn(
              "rounded-2xl border p-4",
              siiReadiness?.mode === 'disabled' ? "border-slate-200 bg-slate-50" :
                siiReadiness?.ready ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"
            )}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className={cn(
                    "text-sm font-bold",
                    siiReadiness?.mode === 'disabled' ? "text-slate-800" :
                      siiReadiness?.ready ? "text-emerald-900" : "text-amber-900"
                  )}>
                    {siiReadiness?.mode === 'disabled' ? 'Facturación SII deshabilitada' :
                      siiReadiness?.mode === 'real'
                        ? 'Proveedor SII real no implementado'
                        : siiReadiness?.ready ? 'Mock local listo para pruebas DTE' : 'Faltan datos para preparar DTE'}
                  </p>
                  <p className={cn(
                    "mt-1 text-sm",
                    siiReadiness?.mode === 'disabled' ? "text-slate-600" :
                      siiReadiness?.ready ? "text-emerald-800" : "text-amber-800"
                  )}>
                    {siiReadiness?.mode === 'real'
                      ? 'No se emite ni consulta SII real desde esta instalacion. Mantén el modo deshabilitado o usa mock local solo para demo/piloto.'
                      : siiReadiness?.mode === 'disabled'
                        ? 'El historial queda disponible, pero procesamiento y reintentos esperan configuración.'
                        : 'El mock local simula folio, track id, PDF y XML para pruebas; no envía ni acredita aceptación real del SII.'}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[320px]">
                  <button onClick={() => setInvoiceStatus('pending')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'pending' ? "border-amber-300 bg-white text-amber-700" : "border-white/60 bg-white/60 text-slate-600")}>
                    Preparados<br /><span className="text-lg text-slate-900">{pendingInvoicesCount}</span>
                  </button>
                  <button onClick={() => setInvoiceStatus('accepted')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'accepted' ? "border-emerald-300 bg-white text-emerald-700" : "border-white/60 bg-white/60 text-slate-600")}>
                    Procesados<br /><span className="text-lg text-slate-900">{acceptedInvoicesCount}</span>
                  </button>
                  <button onClick={() => setInvoiceStatus('rejected')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'rejected' ? "border-red-300 bg-white text-red-700" : "border-white/60 bg-white/60 text-slate-600")}>
                    Rechazados<br /><span className="text-lg text-slate-900">{rejectedInvoicesCount}</span>
                  </button>
                </div>
              </div>
              {siiReadiness && !siiReadiness.ready && siiReadiness.mode !== 'disabled' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {siiReadiness.checks.filter(check => !check.ok).map(check => (
                    <span key={check.key} className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-amber-800">
                      Falta: {check.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'pending', label: 'Preparados' },
                { id: 'accepted', label: 'Procesados' },
                { id: 'rejected', label: 'Rechazados' },
              ].map(filter => (
                <button
                  key={filter.id}
                  onClick={() => setInvoiceStatus(filter.id as typeof invoiceStatus)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-xs font-bold transition-all",
                    invoiceStatus === filter.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="glass-card overflow-x-auto">
              <DataView<Invoice> caption="Documentos tributarios" items={loadError ? [] : filteredInvoices} getKey={inv => inv.id} loading={isLoading} emptyContent={<>{isLoading && (
                  <div>
                    <div className="p-4">Cargando documentos tributarios...</div>
                  </div>
                )}
{!isLoading && loadError && (
                  <div>
                    <div className="p-4">{loadError}</div>
                  </div>
                )}
{!isLoading && !loadError && filteredInvoices.length === 0 && (
                  <div>
                    <div className="p-4">
                      <FinanceEmptyState
                        title={invoices.length === 0 ? "Sin documentos tributarios preparados." : "Sin documentos para ese estado."}
                        description={invoices.length === 0 ? "Cuando se registre un pago, quedará un DTE preparado o procesado según el proveedor configurado." : "Cambia el filtro para revisar todo el historial tributario."}
                        action={
                          <button
                            type="button"
                            onClick={() => invoices.length === 0 ? handleTabChange('payments') : setInvoiceStatus('all')}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                          >
                            {invoices.length === 0 ? 'Ver cuentas por cobrar' : 'Ver todos'}
                          </button>
                        }
                      />
                    </div>
                  </div>
                )}</>} columns={[{ key: 'column-0', label: "Folio", primary: true, render: (inv) => { 
return <>#
{inv.folio}</>; } },
{ key: 'column-1', label: "Tipo DTE", render: (inv) => { 
return <>
<span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold uppercase">
                        {formatDteType(inv.type, true)}
                      </span>
</>; } },
{ key: 'column-2', label: "Cliente", render: (inv) => { 
return <>
<p className="text-sm font-bold">{inv.client_name}</p>

<p className="text-xs text-slate-600">RUT {inv.client_rut || 'sin RUT'}</p>
</>; } },
{ key: 'column-3', label: "Monto", render: (inv) => { 
return <>$
{inv.amount.toLocaleString()}</>; } },
{ key: 'column-4', label: "Estado DTE/SII", render: (inv) => { 
return <>
<div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "h-2 w-2 rounded-full",
                            inv.status_sii === 'accepted' ? "bg-emerald-500" :
                              inv.status_sii === 'rejected' ? "bg-red-500" : "bg-amber-500"
                          )} />
                          <span className={cn(
                            "text-xs font-bold uppercase",
                            inv.status_sii === 'accepted' ? "text-emerald-800" :
                              inv.status_sii === 'rejected' ? "text-red-700" : "text-amber-800"
                          )}>
                            {getInvoiceStatusLabel(inv)}
                          </span>
                        </div>
                        {inv.status_detail && <p className="max-w-[260px] text-xs text-slate-600">{inv.status_detail}</p>}
                        {inv.rejection_reason && <p className="max-w-[260px] text-xs font-bold text-red-700">{inv.rejection_reason}</p>}
                      </div>
</>; } },
{ key: 'column-5', label: "Proveedor", render: (inv) => { 
return <>
<p className="text-xs font-bold text-slate-700">{inv.provider || 'local_mock'}</p>

<p className="text-xs font-bold uppercase tracking-wider text-slate-600">{inv.track_id || inv.provider_mode || 'sin envío'}</p>

{inv.last_sync_at && <p className="text-xs text-slate-600">Sync {new Date(inv.last_sync_at).toLocaleString()}</p>}
</>; } },
{ key: 'column-6', label: "Acciones", fullWidthOnMobile: true, render: (inv) => { 
return <>
<div className="flex flex-wrap justify-end gap-2">
                        {inv.status_sii !== 'accepted' && (
                          <button
                            onClick={() => handleIssueInvoice(inv)}
                            disabled={invoiceActionId === inv.id || !siiReadiness?.ready}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {invoiceActionId === inv.id ? 'Procesando' : inv.status_sii === 'rejected' ? 'Reintentar DTE' : 'Procesar DTE'}
                          </button>
                        )}
                        <button
                          onClick={() => handleSyncInvoice(inv)}
                          disabled={invoiceActionId === inv.id || !siiReadiness?.ready}
                          title={siiReadiness?.ready ? "Sincronizar estado con proveedor configurado" : "Proveedor SII no listo"}
                          className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-all hover:bg-slate-50 disabled:opacity-40"
                        >
                          <RefreshCw className={cn("w-4 h-4", invoiceActionId === inv.id && "animate-spin")} />
                        </button>
                        {inv.status_sii === 'accepted' && inv.track_id && (
                          <>
                            <button
                              onClick={() => downloadInvoiceFile(inv, 'pdf')}
                              title="Descargar PDF generado"
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-all hover:bg-slate-50"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => downloadInvoiceFile(inv, 'xml')}
                              title="Descargar XML generado"
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-all hover:bg-slate-50"
                            >
                              <FileJson className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
</>; } }]} />
            </div>
          </div>);
}
