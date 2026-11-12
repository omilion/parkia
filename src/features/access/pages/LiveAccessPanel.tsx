import { motion } from 'motion/react';
import { Car, DoorOpen, ExternalLink, Fingerprint, QrCode, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';

import { cn } from '../../../lib/utils';
import { getAccessPoint } from './accessShared';

import { useAccess } from './AccessContext';
export default function LiveAccessPanel(){
const { activeDeniedLogs, liveLogs, setDrawerType, setIsDrawerOpen, setSelectedLog } = useAccess();
return (<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold">Actividad en Vivo</h3>
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  Sincronizado
                </div>
              </div>
              <div className="space-y-4">
                {liveLogs.map((log, i) => {
                  const accessPoint = getAccessPoint(log);
                  return (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className={cn(
                        "glass-card p-4 flex items-center justify-between group hover:border-slate-300 transition-all",
                        log.status === 'denied' && "border-red-100 bg-red-50/30"
                      )}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                        )}>
                          {(log.client_name || log.visitor_name || '?').charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate">
                            {log.client_name || log.visitor_name || 'Desconocido'}
                            {log.plate && <span className="text-slate-600 font-mono ml-2">({log.plate})</span>}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            {log.method === 'fingerprint' && <Fingerprint className="w-3 h-3" />}
                            {log.method === 'qr' && <QrCode className="w-3 h-3" />}
                            {log.method === 'manual' && <Zap className="w-3 h-3" />}
                            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold uppercase tracking-wider", accessPoint.className)}>
                              <accessPoint.Icon className="w-3 h-3" />
                              {accessPoint.label}
                            </span>
                            <span>{log.space_name || 'Acceso principal'}</span>
                            {log.branch_name && <span>{log.branch_name}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider",
                          log.status === 'authorized' ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                        )}>
                          {log.status === 'authorized' ? 'Autorizado' : 'Denegado'}
                        </span>
                        {log.reason && (
                          <p className="text-xs text-red-500 font-bold mt-1 max-w-[150px] truncate">{log.reason}</p>
                        )}
                        {log.resolved_by_access_log_id && (
                          <p className="text-xs text-emerald-800 font-bold mt-1">Resuelto por autorizacion #{log.resolved_by_access_log_id}</p>
                        )}
                        {log.space_id && (
                          <a
                            href={`/spaces?mapSpaceId=${log.space_id}${log.branch_id ? `&branchId=${log.branch_id}` : ''}`}
                            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Ver mapa
                          </a>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-bold">Alertas de Seguridad</h3>
              <div className="space-y-4">
                {activeDeniedLogs.map(log => (
                  <div key={log.id} className="p-4 bg-red-50 border border-red-100 rounded-2xl space-y-3 animate-pulse">
                    <div className="flex items-center gap-3 text-red-700">
                      <ShieldAlert className="w-5 h-5" />
                      <p className="text-sm font-bold uppercase tracking-wider">Acceso Denegado</p>
                    </div>
                    <p className="text-sm font-bold text-red-900">
                      {log.client_name || log.visitor_name}
                      {log.plate && <span className="ml-2 font-mono">({log.plate})</span>}
                    </p>
                    <p className="text-xs text-red-700 font-medium">{log.reason}</p>
                    <button
                      onClick={() => { setSelectedLog(log); setDrawerType('override'); setIsDrawerOpen(true); }}
                      className="w-full py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all"
                    >
                      Resolver con Autorizacion Manual
                    </button>
                  </div>
                ))}
                {activeDeniedLogs.length === 0 && (
                  <div className="p-8 border-2 border-dashed border-slate-100 rounded-3xl text-center">
                    <ShieldCheck className="w-8 h-8 text-emerald-200 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600">Sin alertas activas</p>
                  </div>
                )}
              </div>

              <div className="glass-card p-6 space-y-4">
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Controles Rápidos</h4>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    onClick={() => { setSelectedLog(null); setDrawerType('override'); setIsDrawerOpen(true); }}
                    className="w-full py-3 bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-indigo-800 transition-all"
                  >
                    <Car className="w-4 h-4" /> Registrar Acceso Vehicular
                  </button>
                  <button
                    onClick={() => { setSelectedLog(null); setDrawerType('override'); setIsDrawerOpen(true); }}
                    className="w-full py-3 bg-white border border-sky-200 text-sky-700 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-sky-50 transition-all"
                  >
                    <DoorOpen className="w-4 h-4" /> Registrar Acceso Peatonal
                  </button>
                </div>
              </div>
            </div>
          </div>);
}
