import { Skeleton } from './Display';

export function LoadingState({ label = 'Cargando información', rows = 3 }: { label?: string; rows?: number }) {
  return <div role="status" aria-label={label} className="space-y-3 p-4"><span className="sr-only">{label}</span>{Array.from({ length: rows }, (_, index) => <div key={index} className="space-y-2 rounded-xl border border-slate-200 p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-1/3" /></div>)}</div>;
}
