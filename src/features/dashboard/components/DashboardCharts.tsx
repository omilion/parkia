import { useId } from 'react';

export function OccupancyChart({ occupied, total }: { occupied: number; total: number }) {
  const percent = total > 0 ? Math.max(0, Math.min(100, occupied / total * 100)) : 0;
  return <figure className="flex h-full flex-col items-center justify-center gap-3" aria-label={`Ocupación: ${occupied} de ${total} plazas`}>
    <div role="img" aria-label={`${Math.round(percent)}% ocupado`} className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#4f46e5 ${percent}%, #10b981 ${percent}% 100%)` }}><div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-lg font-bold">{Math.round(percent)}%</div></div>
    <figcaption className="flex flex-wrap justify-center gap-4 text-xs text-slate-700"><span>● Ocupado: {occupied}</span><span>○ Libre: {Math.max(0, total - occupied)}</span></figcaption>
  </figure>;
}

export function HourlyAccessChart({ points }: { points: Array<{ hourLabel: string; count: number }> }) {
  const gradient = useId().replace(/:/g, '');
  const max = Math.max(1, ...points.map(point => point.count));
  const coordinates = points.map((point, index) => ({ x: points.length === 1 ? 500 : index * 1000 / (points.length - 1), y: 190 - point.count / max * 180 }));
  const line = coordinates.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 3), Math.floor(2 * (points.length - 1) / 3), points.length - 1])];
  return <figure className="flex h-full flex-col" aria-label="Cantidad de accesos por hora">
    <div className="flex min-h-0 flex-1 gap-2"><div className="flex w-7 shrink-0 flex-col justify-between pb-1 text-right text-xs tabular-nums text-slate-600"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div>
      <svg role="img" aria-label="Flujo horario de accesos" viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-full min-h-0 w-full overflow-visible">
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" /><stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" /></linearGradient></defs>
        {[10, 100, 190].map(y => <line key={y} x1="0" x2="1000" y1={y} y2={y} stroke="#e2e8f0" vectorEffect="non-scaling-stroke" />)}
        <path d={`${line} L${coordinates.at(-1)?.x || 0},190 L${coordinates[0]?.x || 0},190 Z`} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="#4f46e5" strokeWidth="3" vectorEffect="non-scaling-stroke" />
        {coordinates.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" fill="#4f46e5" vectorEffect="non-scaling-stroke"><title>{points[index].hourLabel}: {points[index].count} accesos</title></circle>)}
      </svg>
    </div>
    <figcaption className="mt-2 flex justify-between pl-9 text-xs tabular-nums text-slate-600">{ticks.map(index => <span key={index}>{points[index]?.hourLabel}</span>)}</figcaption>
    <dl className="sr-only">{points.map(point => <div key={point.hourLabel}><dt>{point.hourLabel}</dt><dd>{point.count} accesos</dd></div>)}</dl>
  </figure>;
}
