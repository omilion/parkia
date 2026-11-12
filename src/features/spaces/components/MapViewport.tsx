import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../../ui';

type Point = { x: number; y: number };
export function MapViewport({ children, enabled, mapId }: { children: ReactNode; enabled: boolean; mapId: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ distance: number; scale: number; midpoint: Point; offset: Point } | null>(null);
  const moved = useRef(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  useEffect(() => { setView({ scale: 1, x: 0, y: 0 }); pointers.current.clear(); gesture.current = null; }, [enabled, mapId]);
  const clamp = (scale: number, x: number, y: number) => {
    const width = viewport.current?.clientWidth || 0, height = viewport.current?.clientHeight || 0;
    const s = Math.min(4, Math.max(1, scale));
    return { scale: s, x: Math.max(-width * (s - 1) / 2, Math.min(width * (s - 1) / 2, x)), y: Math.max(-height * (s - 1) / 2, Math.min(height * (s - 1) / 2, y)) };
  };
  const pinch = () => {
    const [a, b] = [...pointers.current.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  return <div>
    {enabled && <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2"><Button variant="secondary" onClick={() => setView(current => clamp(current.scale + 0.5, current.x, current.y))} aria-label="Acercar mapa">+</Button><Button variant="secondary" onClick={() => setView(current => clamp(current.scale - 0.5, current.x, current.y))} aria-label="Alejar mapa">−</Button><Button variant="ghost" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Restablecer</Button><span className="text-sm text-slate-700">{Math.round(view.scale * 100)}%</span><p className="w-full text-xs text-slate-600">Pellizca para ampliar y arrastra para mover el mapa.</p></div>}
    <div ref={viewport} role="region" aria-label="Mapa interactivo" className="relative overflow-hidden bg-slate-100" style={{ touchAction: enabled ? 'none' : 'auto' }}
      onPointerDownCapture={event => {
        if (!enabled) return;
        if (!pointers.current.size) moved.current = false;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2) { const p = pinch(); gesture.current = { ...p, scale: view.scale, offset: { x: view.x, y: view.y } }; moved.current = true; }
      }}
      onPointerMoveCapture={event => {
        if (!enabled) return;
        const previous = pointers.current.get(event.pointerId);
        if (!previous) return;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 2 && gesture.current) {
          const p = pinch(), start = gesture.current;
          setView(clamp(start.scale * p.distance / Math.max(1, start.distance), start.offset.x + p.midpoint.x - start.midpoint.x, start.offset.y + p.midpoint.y - start.midpoint.y));
          moved.current = true;
        } else if (view.scale > 1 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 2) {
          setView(current => clamp(current.scale, current.x + event.clientX - previous.x, current.y + event.clientY - previous.y));
          moved.current = true;
        }
        if (moved.current) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUpCapture={event => { pointers.current.delete(event.pointerId); gesture.current = null; }}
      onPointerCancelCapture={event => { pointers.current.delete(event.pointerId); gesture.current = null; }}
      onClickCapture={event => { if (enabled && moved.current) { event.preventDefault(); event.stopPropagation(); } }}>
      <div className="relative origin-center" style={{ transform: enabled ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : undefined }}>{children}</div>
    </div>
  </div>;
}
