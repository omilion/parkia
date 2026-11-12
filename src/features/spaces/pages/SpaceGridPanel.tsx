import { DataView } from '../../../ui/DataView';

import { motion } from 'motion/react';
import { AlertTriangle, Clock, Zap } from 'lucide-react';
import { Space } from '../../../types';

import { cn } from '../../../lib/utils';
import { useIsDesktop } from '../../../ui/useMediaQuery';

import { useSpaces } from './SpacesContext';
export default function SpaceGridPanel(){const { activeType, branches, canSeeCommercialData, filterStatus, filteredSpaces, openSpaceDetail, selectedBranchId, setFilterStatus, setSelectedBranchId, spaces }=useSpaces();const isDesktop=useIsDesktop(); return (<>
          <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedBranchId}
                onChange={event => setSelectedBranchId(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900"
                aria-label="Filtrar por sucursal"
              >
                <option value="all">Todas las sucursales</option>
                {branches.filter(branch => branch.status === 'active').map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {['all', 'available', 'occupied', 'maintenance'].map(status => (
                  <button
                    key={status}
                    onClick={() => setFilterStatus(status)}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all",
                      filterStatus === status
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {status === 'all' ? 'Todos' :
                      status === 'available' ? 'Libres' :
                        status === 'occupied' ? 'Ocupados' : 'Mantención'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 lg:gap-8 text-sm font-bold">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-slate-600">Libres: {spaces.filter(s => s.type === activeType && s.status === 'available').length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-slate-600">Ocupados: {spaces.filter(s => s.type === activeType && s.status === 'occupied').length}</span>
              </div>
            </div>
          </div>

          {!isDesktop ? <DataView<Space> caption="Plazas" items={filteredSpaces} getKey={space => space.id} columns={[
{key:'name',label:'Plaza',primary:true,render:space=><button type="button" className="text-left font-bold text-indigo-700" onClick={()=>openSpaceDetail(space)}>{space.name}</button>},
{key:'status',label:'Estado',render:space=>space.status==='available'?'Libre':space.status==='occupied'?'Ocupada':'Mantenimiento'},
{key:'branch',label:'Sucursal',render:space=>space.branch_name||'Sin sucursal'},
{key:'vehicle',label:'Vehiculo',render:space=>space.current_plate||'Sin vehiculo'},
{key:'client',label:'Cliente',hideOnMobile:!canSeeCommercialData,render:space=>space.assigned_client?.name||'Sin cliente asignado'},
]} /> : (<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {filteredSpaces.map(space => (
              <motion.button
                key={space.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openSpaceDetail(space)}
                className={cn(
                  "aspect-square rounded-2xl border-2 p-4 flex flex-col justify-between transition-all text-left relative overflow-hidden group",
                  space.status === 'available' ? "bg-emerald-50/30 border-emerald-100 hover:border-emerald-300" :
                    space.status === 'occupied' ? "bg-white border-slate-100 hover:border-slate-300" :
                      "bg-slate-50 border-slate-100 opacity-60"
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-600">{space.name}</span>
                    {space.branch_name && selectedBranchId === 'all' && (
                      <span className="mt-0.5 block truncate text-xs font-bold uppercase tracking-wider text-slate-600">{space.branch_name}</span>
                    )}
                  </div>
                  {space.is_present && (
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </div>

                <div className="flex flex-col gap-1 mt-auto">
                  {space.status === 'occupied' ? (
                    <>
                      <p className="text-xs font-bold text-slate-900 truncate">{space.assigned_client?.name || 'Visita temporal'}</p>
                      <p className="text-xs text-slate-600 font-mono">
                        {canSeeCommercialData ? (space.assigned_client?.rut || space.current_plate) : (space.current_plate || 'Cliente asignado')}
                      </p>
                    </>
                  ) : space.status === 'maintenance' ? (
                    <AlertTriangle className="w-4 h-4 text-slate-600" />
                  ) : (
                    <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Zap className="w-3 h-3 text-emerald-800" />
                    </div>
                  )}
                  {space.is_present && space.entry_time && (
                    <div className="flex items-center gap-1 mt-1 text-xs font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md w-fit">
                      <Clock className="w-2 h-2 text-indigo-500" />
                      {new Date(space.entry_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {space.current_plate && ` • ${space.current_plate}`}
                    </div>
                  )}
                </div>

                {space.status === 'occupied' && canSeeCommercialData && space.assigned_client?.financial_status && (
                  <div className={cn(
                    "absolute bottom-0 left-0 right-0 h-1",
                    space.assigned_client?.financial_status === 'up-to-date' ? "bg-emerald-500" : "bg-red-500"
                  )} />
                )}
              </motion.button>
            ))}
          </div>)}
            </>);}
