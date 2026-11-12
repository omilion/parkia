import { DataView } from '../../../ui/DataView';

import { CheckCircle2, QrCode } from 'lucide-react';
import { VisitorPass } from '../../../types';

import PaginationControls from '../../../components/ui/PaginationControls';

import { cn } from '../../../lib/utils';
import { ACCESS_AUDIT_PAGE_SIZE } from './accessShared';

import { useAccess } from './AccessContext';
export default function VisitorPassesPanel(){
const { auditPage, auditTotal, copyVisitorQr, isActionLoading, scanVisitorQr, setAuditPage, visitorPasses } = useAccess();
return (<div className="space-y-6">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <p className="font-bold">Pases QR generados localmente</p>
              <p className="text-xs mt-1">El sistema no envía mensajes automáticamente en este flujo. Copia el token QR y compártelo por el canal operativo definido.</p>
            </div>
            <div className="glass-card overflow-x-auto">
              <DataView<VisitorPass> caption="Pases de visita" items={visitorPasses} getKey={pass => pass.id} emptyContent={<><p className="p-4 text-sm text-slate-600">No hay resultados.</p></>} columns={[{ key: 'column-0', label: "Visitante", primary: true, render: (pass) => { 
return <>
<p className="text-sm font-bold">{pass.name}</p>

<p className="text-xs text-slate-600 font-mono">{pass.rut}</p>

<p className="text-xs text-slate-600">{pass.phone || 'Sin telefono'}{pass.plate ? ` · ${pass.plate}` : ''}</p>

{pass.branch_name && <p className="text-xs font-bold uppercase tracking-wider text-slate-600">{pass.branch_name}</p>}
</>; } },
{ key: 'column-1', label: "Tipo", render: (pass) => { 
return <>
<span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold uppercase">
                          {pass.type}
                        </span>

<p className="mt-1 text-xs text-slate-600">{pass.company || 'Sin empresa'}</p>

<p className="text-xs text-slate-600">Autoriza: {pass.authorized_by || '-'}</p>
</>; } },
{ key: 'column-2', label: "Validez", render: (pass) => { 
return <>
<p className="text-xs font-bold text-slate-900">{new Date(pass.valid_from).toLocaleDateString()}</p>

<p className="text-xs text-slate-600">{new Date(pass.valid_from).toLocaleTimeString()} - {new Date(pass.valid_to).toLocaleTimeString()}</p>
</>; } },
{ key: 'column-3', label: "Estado", render: (pass) => { 
return <>
<span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          pass.status === 'waiting' ? "bg-amber-100 text-amber-800" :
                            pass.status === 'inside' ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-800"
                        )}>
                          {pass.status === 'waiting' ? 'En Espera' : pass.status === 'inside' ? 'En el Interior' : 'Completado'}
                        </span>
</>; } },
{ key: 'column-4', label: "Acciones", fullWidthOnMobile: true, render: (pass) => { 
return <>
{pass.status !== 'completed' && (
                          <button
                            onClick={() => scanVisitorQr(pass)}
                            disabled={isActionLoading}
                            title={pass.status === 'inside' ? 'Registrar salida por QR' : 'Registrar ingreso por QR'}
                            className="p-2 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg shadow-sm transition-all disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}

<button
                          onClick={() => copyVisitorQr(pass)}
                          title="Copiar token QR para compartir manualmente"
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-white rounded-lg shadow-sm transition-all"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
</>; } }]} />
              <PaginationControls
                page={auditPage}
                pageSize={ACCESS_AUDIT_PAGE_SIZE}
                total={auditTotal}
                onPageChange={setAuditPage}
              />
            </div>
          </div>);
}
