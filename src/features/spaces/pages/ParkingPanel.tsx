import { LoadingState } from '../../../ui';

import React from 'react';

import { Box, Map } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { useSpaces } from './SpacesContext';
const SpaceGridPanel=React.lazy(()=>import('./SpaceGridPanel'));
const SpaceMapPanel=React.lazy(()=>import('./SpaceMapPanel'));
export default function ParkingPanel(){const { mapSummary, parkingMode, setParkingMode }=useSpaces();return (<div className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-fit bg-slate-100 p-1 rounded-xl" role="group" aria-label="Vista de estacionamientos">
              {[
                { id: 'grid', label: 'Grilla', icon: Box },
                { id: 'map', label: 'Mapa aéreo', icon: Map },
              ].map(mode => (
                <button
                  key={mode.id}
                  aria-pressed={parkingMode === mode.id}
                  type="button"
                  onClick={() => setParkingMode(mode.id as 'grid' | 'map')}
                  className={cn(
                    "px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                    parkingMode === mode.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-700"
                  )}
                >
                  <mode.icon className="w-4 h-4" />
                  {mode.label}
                </button>
              ))}
            </div>
            {parkingMode === 'map' && mapSummary && (
              <div className="flex flex-wrap gap-4 text-xs font-bold text-slate-600">
                <span>Total: {mapSummary.totalSpaces}</span>
                <span>Mapeados: {mapSummary.mappedSpaces}</span>
                <span>Sin mapear: {mapSummary.unmappedSpaces}</span>
              </div>
            )}
          </div>

          {parkingMode === 'grid' ? <React.Suspense fallback={<LoadingState />}><SpaceGridPanel /></React.Suspense> : <React.Suspense fallback={<LoadingState />}><SpaceMapPanel /></React.Suspense>}
        </div>);}
