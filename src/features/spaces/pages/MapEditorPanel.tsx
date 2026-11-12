import { Save, Trash2, Undo2 } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { useSpaces } from './SpacesContext';
export default function MapEditorPanel(){const { availableEditorSpaces, draftPolygonPoints, editorSpaceId, handleDeleteSelectedRegion, handleFinishPolygon, handleSaveMapRegions, handleUndoMapEdit, isActionLoading, mapEditorTool, selectedMapRegion, selectedMapRegionSpace, setDraftPolygonPoints, setDrawingRect, setEditorSpaceId, setMapEditorTool, setMovingRegion, updateSelectedRegion }=useSpaces();return (<div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-slate-900">Editor de regiones</p>
                            <p className="text-xs text-slate-600">Dibuja, mueve y asigna regiones normalizadas.</p>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={handleUndoMapEdit} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                              <Undo2 className="h-4 w-4" />
                              Deshacer
                            </button>
                            <button type="button" onClick={handleSaveMapRegions} disabled={isActionLoading} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                              <Save className="h-4 w-4" />
                              Guardar
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'select', label: 'Seleccionar' },
                            { id: 'rect', label: 'Rectángulo' },
                            { id: 'polygon', label: 'Polígono' },
                            { id: 'move', label: 'Mover' },
                          ].map(tool => (
                            <button
                              key={tool.id}
                              type="button"
                              onClick={() => {
                                setMapEditorTool(tool.id as 'select' | 'rect' | 'polygon' | 'move');
                                setDrawingRect(null);
                                setMovingRegion(null);
                                if (tool.id !== 'polygon') setDraftPolygonPoints([]);
                              }}
                              className={cn(
                                "rounded-xl border px-3 py-2 text-xs font-bold transition-all",
                                mapEditorTool === tool.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              )}
                            >
                              {tool.label}
                            </button>
                          ))}
                        </div>
                        {draftPolygonPoints.length > 0 && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-bold text-slate-600">{draftPolygonPoints.length}/4 puntos del polígono</p>
                            <p className="mt-1 text-xs text-slate-600">Al cuarto punto se crea la región automáticamente.</p>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button type="button" onClick={handleFinishPolygon} className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white">
                                Cerrar polígono
                              </button>
                              <button type="button" onClick={handleUndoMapEdit} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                                Deshacer punto
                              </button>
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">Cupo para nueva región</label>
                          <select aria-label="Cupo para nueva región" value={editorSpaceId} onChange={event => setEditorSpaceId(event.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900">
                            <option value="">Dibujar sin asignar</option>
                            {availableEditorSpaces.map(space => (
                              <option key={space.id} value={space.id}>{space.name}</option>
                            ))}
                          </select>
                          <p className="mt-2 text-xs text-slate-600">Puedes elegirlo antes de dibujar o asignarlo después en la región seleccionada.</p>
                        </div>

                        {selectedMapRegion && (
                          <div className="space-y-3 border-t border-slate-100 pt-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Región seleccionada</p>
                            <select aria-label="Sin estacionamiento asignado" value={selectedMapRegion.space_id || ''} onChange={event => updateSelectedRegion({ space_id: Number(event.target.value) || 0 })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900">
                              <option value="">Sin estacionamiento asignado</option>
                              {[selectedMapRegionSpace, ...availableEditorSpaces].filter(Boolean).map(space => (
                                <option key={space!.id} value={space!.id}>{space!.name}</option>
                              ))}
                            </select>
                            <input aria-label="Etiqueta visible" value={selectedMapRegion.label || ''} onChange={event => updateSelectedRegion({ label: event.target.value })} placeholder="Etiqueta visible" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900" />
                            <div className="flex items-center gap-3">
                              <input type="color" value={selectedMapRegion.color || '#0f172a'} onChange={event => updateSelectedRegion({ color: event.target.value })} className="h-10 w-14 rounded-lg border border-slate-200 bg-white" aria-label="Color de región" />
                              <button type="button" onClick={handleDeleteSelectedRegion} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50">
                                <Trash2 className="h-4 w-4" />
                                Eliminar región
                              </button>
                            </div>
                          </div>
                        )}
                      </div>);}
