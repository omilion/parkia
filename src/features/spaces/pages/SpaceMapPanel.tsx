import { MapViewport } from '../components/MapViewport';

import { LoadingState } from '../../../ui';

import React from 'react';

import { Map, MousePointer2, RefreshCw, Upload } from 'lucide-react';
import { SpaceMapLiveRegion } from '../../../types';

import { cn } from '../../../lib/utils';

import { liveStatusLabels, liveStatusClasses, liveStatusFill, EDITOR_REGION_COLOR, getRectPath } from './spacesShared';

import { useSpaces } from './SpacesContext';
const MapEditorPanel=React.lazy(()=>import('./MapEditorPanel'));
export default function SpaceMapPanel(){const { branches, canCreateSpaces, canEditSpaces, canUseMapEditor, draftPolygonPoints, drawingRect, fetchSpaceMapDetail, filteredLiveRegions, handleMapPointerDown, handleMapPointerMove, handleMapPointerUp, isMapEditorOpen, isMapLoading, lastMapRefresh, liveRegions, mapEditorTool, mapFilterStatus, mapRegions, openSpaceDetail, pointerToMapPoint, rectFromDrawing, selectedBranchId, selectedMap, selectedMapId, selectedMapRegionId, setDrawingRect, setEditorSpaceId, setIsMapCreateDrawerOpen, setIsMapEditorOpen, setMapFilterStatus, setMovingRegion, setSelectedBranchId, setSelectedMapId, setSelectedMapRegionId, spaceMaps, spaces, tooltipForRegion }=useSpaces();return (<div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={selectedBranchId}
                    onChange={event => setSelectedBranchId(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900"
                    aria-label="Sucursal para mapa aéreo"
                  >
                    <option value="all">Selecciona una sucursal</option>
                    {branches.filter(branch => branch.status === 'active').map(branch => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                  <select
                    value={selectedMapId || ''}
                    onChange={event => setSelectedMapId(Number(event.target.value) || null)}
                    disabled={selectedBranchId === 'all' || spaceMaps.length === 0}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 outline-none transition-all focus:border-slate-900 disabled:opacity-50"
                    aria-label="Mapa aéreo"
                  >
                    <option value="">Sin mapa seleccionado</option>
                    {spaceMaps.map(map => (
                      <option key={map.id} value={map.id}>{map.name}{map.is_default ? ' · default' : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'available', 'monthly', 'visitor', 'maintenance'] as const).map(status => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setMapFilterStatus(status)}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all",
                        mapFilterStatus === status
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                      )}
                    >
                      {status === 'all' ? 'Todos' : liveStatusLabels[status]}
                    </button>
                  ))}
                  <button type="button" onClick={() => fetchSpaceMapDetail()} disabled={!selectedMapId} className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Actualizar mapa">
                    <RefreshCw className={cn("h-4 w-4", isMapLoading && "animate-spin")} />
                  </button>
                </div>
              </div>

              {selectedBranchId === 'all' ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Map className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">Selecciona una sucursal para operar el mapa aéreo.</p>
                </div>
              ) : !selectedMap ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                  <Upload className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-700">{isMapLoading ? 'Cargando mapas...' : 'No hay mapa aéreo activo para esta sucursal.'}</p>
                  {canCreateSpaces && (
                    <button type="button" onClick={() => setIsMapCreateDrawerOpen(true)} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
                      Cargar mapa
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-black text-slate-900">{selectedMap.name}</p>
                        <p className="text-xs text-slate-600">{selectedMap.branch_name || 'Sucursal'} · {filteredLiveRegions.length} regiones visibles</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {Object.entries(liveStatusLabels).map(([status, label]) => (
                          <span key={status} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
                            <span className={cn("h-2.5 w-2.5 rounded-full", liveStatusClasses[status as SpaceMapLiveRegion['status']])} />
                            {label}
                          </span>
                        ))}
                        {canEditSpaces && !canUseMapEditor && <p className="text-sm text-slate-600">Para editar el mapa, usa una tablet o computador.</p>}
                        {canEditSpaces && canUseMapEditor && (
                          <button
                            type="button"
                            onClick={() => setIsMapEditorOpen(value => !value)}
                            className={cn(
                              "ml-0 md:ml-2 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold",
                              isMapEditorOpen ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            <MousePointer2 className="h-4 w-4" />
                            Editor
                          </button>
                        )}
                      </div>
                    </div>

                    <MapViewport enabled={!isMapEditorOpen} mapId={selectedMap.id}>
<img src={selectedMap.image_url} alt={selectedMap.name} className="block w-full select-none" draggable={false} />

<svg
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        className={cn(
                          "absolute inset-0 h-full w-full",
                          isMapEditorOpen && mapEditorTool === 'move' ? "cursor-move" :
                            isMapEditorOpen && (mapEditorTool === 'rect' || mapEditorTool === 'polygon') ? "cursor-crosshair" :
                              "cursor-default"
                        )}
                        onPointerDown={handleMapPointerDown}
                        onPointerMove={handleMapPointerMove}
                        onPointerUp={handleMapPointerUp}
                        onPointerLeave={() => {
                          setDrawingRect(null);
                          setMovingRegion(null);
                        }}
                      >
                        {(isMapEditorOpen ? mapRegions : filteredLiveRegions).map(region => {
                          const live = liveRegions.find(item => item.id === region.id);
                          const fill = isMapEditorOpen ? (region.color || EDITOR_REGION_COLOR) : liveStatusFill[live?.status || 'unknown'];
                          const isSelected = selectedMapRegionId === region.id;
                          const tooltip = tooltipForRegion(region);
                          const commonProps = {
                            fill,
                            fillOpacity: isMapEditorOpen ? 0.3 : 0.55,
                            stroke: isSelected ? '#ffffff' : fill,
                            strokeOpacity: 1,
                            strokeWidth: isSelected ? 3 : 2,
                            vectorEffect: 'non-scaling-stroke' as const,
                            className: 'transition-opacity hover:opacity-80',
                            onPointerDown: (event: React.PointerEvent<SVGElement>) => {
                              event.stopPropagation();
                              if (!isMapEditorOpen) return;
                              setSelectedMapRegionId(region.id);
                              setEditorSpaceId(region.space_id ? String(region.space_id) : '');
                              if (mapEditorTool === 'move') {
                                const point = pointerToMapPoint(event);
                                setMovingRegion({ regionId: region.id, startX: point.x, startY: point.y, originalGeometry: region.geometry });
                              }
                            },
                            onClick: (event: React.MouseEvent) => {
                              event.stopPropagation();
                              if (isMapEditorOpen) {
                                setSelectedMapRegionId(region.id);
                                setEditorSpaceId(region.space_id ? String(region.space_id) : '');
                                return;
                              }
                              const space = spaces.find(item => item.id === region.space_id);
                              if (space) {
                                setSelectedMapRegionId(region.id);
                                openSpaceDetail(space);
                              }
                            },
                          };

                          if (region.geometry.type === 'polygon') {
                            return (
                              <polygon key={region.id} points={getRectPath(region.geometry)} {...commonProps}>
                                <title>{tooltip}</title>
                              </polygon>
                            );
                          }

                          return (
                            <rect
                              key={region.id}
                              x={region.geometry.x}
                              y={region.geometry.y}
                              width={region.geometry.width}
                              height={region.geometry.height}
                              rx={0.006}
                              {...commonProps}
                            >
                              <title>{tooltip}</title>
                            </rect>
                          );
                        })}
                        {draftPolygonPoints.length > 0 && (
                          <>
                            <polyline
                              points={draftPolygonPoints.map(point => `${point.x},${point.y}`).join(' ')}
                              fill="none"
                              stroke={EDITOR_REGION_COLOR}
                              strokeWidth={2}
                              vectorEffect="non-scaling-stroke"
                            />
                            {draftPolygonPoints.map((point, index) => (
                              <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={0.008} fill={EDITOR_REGION_COLOR} stroke="#0f172a" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}
                          </>
                        )}
                        {drawingRect && (
                          <rect
                            x={rectFromDrawing(drawingRect).x}
                            y={rectFromDrawing(drawingRect).y}
                            width={rectFromDrawing(drawingRect).width}
                            height={rectFromDrawing(drawingRect).height}
                            fill={EDITOR_REGION_COLOR}
                            fillOpacity={0.3}
                            stroke={EDITOR_REGION_COLOR}
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                      </svg>
</MapViewport>
                  </div>

                  <aside className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Operación en vivo</p>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
                        <span className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">Libres {liveRegions.filter(region => region.status === 'available').length}</span>
                        <span className="rounded-xl bg-red-50 px-3 py-2 text-red-700">Mensual {liveRegions.filter(region => region.status === 'monthly').length}</span>
                        <span className="rounded-xl bg-orange-50 px-3 py-2 text-orange-700">Visitas {liveRegions.filter(region => region.status === 'visitor').length}</span>
                        <span className="rounded-xl bg-slate-100 px-3 py-2 text-slate-600">Mant. {liveRegions.filter(region => region.status === 'maintenance').length}</span>
                      </div>
                      {lastMapRefresh && <p className="mt-3 text-xs text-slate-600">Actualizado: {new Date(lastMapRefresh).toLocaleTimeString()}</p>}
                    </div>

                    {isMapEditorOpen && canEditSpaces && <React.Suspense fallback={<LoadingState />}><MapEditorPanel /></React.Suspense>}

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Regiones</p>
                      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                        {filteredLiveRegions.map(region => (
                          <button key={region.id} type="button" onClick={() => {
                            const space = spaces.find(item => item.id === region.space_id);
                            if (space) {
                              setSelectedMapRegionId(region.id);
                              openSpaceDetail(space);
                            }
                          }} className="w-full rounded-xl border border-slate-100 px-3 py-2 text-left hover:bg-slate-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold text-slate-800">{region.label || region.space_name || `Cupo #${region.space_id}`}</span>
                              <span className={cn("h-2.5 w-2.5 rounded-full", liveStatusClasses[region.status])} />
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-600">{region.client_name || region.plate || liveStatusLabels[region.status]}</p>
                          </button>
                        ))}
                        {filteredLiveRegions.length === 0 && <p className="py-6 text-center text-sm font-bold text-slate-600">Sin regiones para este filtro</p>}
                      </div>
                    </div>
                  </aside>
                </div>
              )}
            </div>);}
