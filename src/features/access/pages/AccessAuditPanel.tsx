import { DataView } from '../../../ui/DataView';

import { FileDown } from 'lucide-react';
import { AccessLog } from '../../../types';

import { cn } from '../../../lib/utils';

import { useAccess } from './AccessContext';
export default function AccessAuditPanel(){
const { auditFilters, auditLogs, auditTotal, exportAuditCsv, fetchAudit, setAuditFilters, setAuditPage, user } = useAccess();
return (<div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-xs font-bold text-slate-600 uppercase">Usuario / RUT</label>
                <input aria-label="Usuario / RUT"
                  type="text"
                  placeholder="Buscar..."
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.user}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, user: e.target.value });
                    setAuditPage(1);
                  }}
                />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-xs font-bold text-slate-600 uppercase">Estado</label>
                <select aria-label="Estado"
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.type}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, type: e.target.value });
                    setAuditPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="authorized">Autorizados</option>
                  <option value="denied">Denegados</option>
                </select>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
                <label className="text-xs font-bold text-slate-600 uppercase">Desde</label>
                <input aria-label="Desde"
                  type="date"
                  className="w-full bg-transparent outline-none text-sm"
                  value={auditFilters.start}
                  onChange={e => {
                    setAuditFilters({ ...auditFilters, start: e.target.value });
                    setAuditPage(1);
                  }}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={fetchAudit}
                  className="flex-1 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all"
                >
                  Filtrar
                </button>
                <button
                  onClick={exportAuditCsv}
                  disabled={auditTotal === 0}
                  title="Exportar auditoría filtrada"
                  aria-label="Exportar auditoría filtrada"
                  className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:text-slate-900 transition-all disabled:opacity-50"
                >
                  <FileDown className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="glass-card overflow-x-auto">
              <DataView<AccessLog> caption="Historial de accesos" items={auditLogs} getKey={log => log.id} emptyContent={<><p className="p-4 text-sm text-slate-600">No hay resultados.</p></>} columns={[{ key: 'column-0', label: "Fecha/Hora", render: (log) => { 
return <>
{new Date(log.timestamp).toLocaleString()}
</>; } },
{ key: 'column-1', label: "Identidad", primary: true, render: (log) => { 
return <>
{log.client_name || log.visitor_name || 'Desconocido'}

{log.plate && <span className="text-slate-600 font-mono ml-2">({log.plate})</span>}
</>; } },
{ key: 'column-2', label: "Método", render: (log) => { 
return <>
<span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold uppercase">
                          {log.method}
                        </span>
</>; } },
{ key: 'column-3', label: "Estado", render: (log) => { 
return <>
<span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                        )}>
                          {log.status === 'authorized' ? 'Autorizado' : 'Denegado'}
                        </span>

{log.resolved_by_access_log_id && (
                          <p className="mt-1 text-xs font-bold text-emerald-800">
                            Resuelto por autorizacion #{log.resolved_by_access_log_id}
                          </p>
                        )}
</>; } },
{ key: 'column-4', label: "Autorizado Por", render: (log) => { 
return <>
{log.authorized_by || '-'}
</>; } }]} />
            </div>
          </div>);
}
