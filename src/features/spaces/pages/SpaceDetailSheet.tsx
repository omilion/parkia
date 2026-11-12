import { Map, Pencil, RefreshCw, X, Zap } from 'lucide-react';

import Drawer from '../../../components/ui/Drawer';

import { cn } from '../../../lib/utils';

import { liveStatusLabels } from './spacesShared';

import { useSpaces } from './SpacesContext';
export default function SpaceDetailSheet(){
const { canEditSpaces, canOperateSpaces, canSeeCommercialData, focusSpaceOnMap, handleUpdateStatus, isActionLoading, isDrawerOpen, selectedSpace, selectedSpaceLiveRegion, setConfirmAction, setEditingSpace, setIsDrawerOpen, spaceDetail } = useSpaces();
return (<Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={`Detalle de Espacio: ${selectedSpace?.name}`}
      >
        {selectedSpace && (
          <div className="space-y-8">
            <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl">
              <div>
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Estado Físico</p>
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    selectedSpace.status === 'available' ? "bg-emerald-500" :
                      selectedSpace.status === 'occupied' ? "bg-amber-500" : "bg-slate-300"
                  )} />
                  <span className="text-sm font-bold uppercase">
                    {selectedSpace.status === 'available' ? 'Habilitado / Libre' :
                      selectedSpace.status === 'occupied' ? 'Arrendado' : 'En Mantención'}
                  </span>
                </div>
              </div>
              <select aria-label="Libre / Habilitado"
                value={selectedSpace.status}
                disabled={!canOperateSpaces}
                onChange={(e) => {
                  if (!canOperateSpaces) return;
                  const newStatus = e.target.value;
                  if (newStatus === 'available' && selectedSpace.status === 'occupied') {
                    setConfirmAction({ type: 'mark-available', space: selectedSpace, nextStatus: newStatus });
                    return;
                  }
                  handleUpdateStatus(newStatus);
                }}
                className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none disabled:bg-slate-100 disabled:text-slate-600"
              >
                <option value="available">Libre / Habilitado</option>
                <option value="occupied">Arrendado / Ocupado</option>
                <option value="maintenance">Poner en Mantención</option>
              </select>
              <button
                type="button"
                onClick={() => focusSpaceOnMap(selectedSpace)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
              >
                Ver en mapa
              </button>
              {canEditSpaces && (
                <button
                  type="button"
                  onClick={() => setEditingSpace(selectedSpace)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
                  title="Editar ficha del espacio"
                  aria-label={`Editar ficha de ${selectedSpace.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Sucursal y ubicación</p>
                <p className="text-sm font-bold text-slate-800">{selectedSpace.branch_name || 'Sucursal no registrada'}</p>
                <p className="text-sm font-bold text-slate-800">{selectedSpace.location || 'Sin ubicación registrada'}</p>
                <p className="text-xs text-slate-600 mt-1">Nivel: {selectedSpace.level || 'Sin nivel'}</p>
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Dimensiones</p>
                <p className="text-sm font-bold text-slate-800">
                  {[selectedSpace.width_m, selectedSpace.length_m, selectedSpace.height_m].some(Boolean)
                    ? `${selectedSpace.width_m || '-'} x ${selectedSpace.length_m || '-'} x ${selectedSpace.height_m || '-'} m`
                    : 'Sin dimensiones registradas'}
                </p>
                {selectedSpace.updated_at && <p className="text-xs text-slate-600 mt-1">Actualizado: {new Date(selectedSpace.updated_at).toLocaleString()}</p>}
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl md:col-span-2">
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Características y notas</p>
                <p className="text-sm text-slate-700">{selectedSpace.features || 'Sin características registradas'}</p>
                {selectedSpace.notes && <p className="text-sm text-slate-600 mt-2">{selectedSpace.notes}</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Mapa aéreo</p>
                  <p className="text-sm font-bold text-slate-800">
                    {selectedSpaceLiveRegion
                      ? `${liveStatusLabels[selectedSpaceLiveRegion.status]} · ${selectedSpaceLiveRegion.label || selectedSpaceLiveRegion.space_name || selectedSpace.name}`
                      : 'Sin región enfocada o sin mapa cargado'}
                  </p>
                  {selectedSpaceLiveRegion && (
                    <p className="mt-1 text-xs text-slate-600">
                      {[selectedSpaceLiveRegion.client_name, selectedSpaceLiveRegion.plate, selectedSpaceLiveRegion.contract_id ? `Contrato #${selectedSpaceLiveRegion.contract_id}` : null, selectedSpaceLiveRegion.visitor_ticket_id ? `Ticket #${selectedSpaceLiveRegion.visitor_ticket_id}` : null]
                        .filter(Boolean)
                        .join(' · ') || 'Sin actividad asociada'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => focusSpaceOnMap(selectedSpace)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
                >
                  <Map className="h-4 w-4" />
                  Enfocar región
                </button>
              </div>
            </div>

            {selectedSpace.status === 'occupied' && selectedSpace.assigned_client && (
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-2xl font-bold text-slate-600">
                    {selectedSpace.assigned_client.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold">{selectedSpace.assigned_client.name}</h4>
                    <p className="text-sm text-slate-600 font-mono">
                      {canSeeCommercialData ? selectedSpace.assigned_client.rut : (selectedSpace.current_plate || 'Dato operativo')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {canSeeCommercialData && (
                    <div className="p-4 border border-slate-100 rounded-2xl">
                      <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Finanzas</p>
                      <span className={cn(
                        "text-sm font-bold",
                        selectedSpace.assigned_client.financial_status === 'up-to-date' ? "text-emerald-800" : "text-red-700"
                      )}>
                        {selectedSpace.assigned_client.financial_status === 'up-to-date' ? 'Al Día' : 'Moroso'}
                      </span>
                    </div>
                  )}
                  <div className="p-4 border border-slate-100 rounded-2xl">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Presencia</p>
                    <span className={cn(
                      "text-sm font-bold",
                      selectedSpace.is_present ? "text-blue-600" : "text-slate-600"
                    )}>
                      {selectedSpace.is_present ? 'En el interior' : 'Fuera del recinto'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Historial operativo</h4>
              <div className="space-y-3">
                {spaceDetail?.history?.slice(0, 5).map(item => (
                  <div key={item.id} className="p-3 border border-slate-100 rounded-2xl bg-white">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800">
                        {item.previous_status ? `${item.previous_status} -> ${item.status}` : item.status}
                      </p>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{item.source}</span>
                    </div>
                    {item.reason && <p className="text-sm text-slate-600 mt-1">{item.reason}</p>}
                    <p className="text-xs text-slate-600 mt-1">{new Date(item.created_at).toLocaleString()} · {item.staff_name || 'Sistema'}</p>
                  </div>
                ))}
                {spaceDetail && spaceDetail.history.length === 0 && (
                  <p className="text-sm text-slate-600">Sin movimientos registrados.</p>
                )}
                {!spaceDetail && (
                  <p className="text-sm text-slate-600">Cargando historial...</p>
                )}
              </div>
            </div>

            {canOperateSpaces ? (
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-600 uppercase tracking-wider">Controles de Emergencia</h4>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfirmAction({ type: 'open-barrier', space: selectedSpace })}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-red-100 text-red-700 rounded-2xl flex flex-col items-center gap-2 hover:bg-red-50 transition-all disabled:opacity-50"
                  >
                    <Zap className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Registrar Apertura</span>
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'force-release', space: selectedSpace })}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-emerald-100 text-emerald-800 rounded-2xl flex flex-col items-center gap-2 hover:bg-emerald-50 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Liberar Espacio</span>
                  </button>
                  <button
                    onClick={() => handleUpdateStatus('maintenance', 'Bloqueo manual de acceso')}
                    disabled={isActionLoading}
                    className="p-4 border-2 border-slate-100 text-slate-600 rounded-2xl flex flex-col items-center gap-2 hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    <X className="w-6 h-6" />
                    <span className="text-xs font-bold uppercase">Bloquear Acceso</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Vista de inventario</p>
                <p className="mt-1 text-sm text-slate-600">Este rol puede revisar ocupación, tarifa y asignación comercial, sin acciones operativas de acceso.</p>
              </div>
            )}

            <div className="pt-6 border-t border-slate-100">
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all"
              >
                Cerrar Panel
              </button>
            </div>
          </div>
        )}
      </Drawer>);
}
