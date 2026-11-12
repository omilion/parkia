import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { useIsDesktop } from './useMediaQuery';
import { LoadingState } from './LoadingState';

export type DataColumn<T> = {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  /** Primary content is shown first on mobile cards; other columns are labelled. */
  primary?: boolean;
  hideOnMobile?: boolean;
  fullWidthOnMobile?: boolean;
  className?: string;
};

export interface DataViewProps<T> {
  items: T[];
  columns: DataColumn<T>[];
  getKey: (item: T) => string | number;
  loading?: boolean;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  caption: string;
  className?: string;
}

/** Tabla en tablet y escritorio; tarjetas con etiquetas en teléfono. */
export function DataView<T>({ items, columns, getKey, loading = false, emptyMessage = 'No hay resultados', emptyContent, caption, className }: DataViewProps<T>) {
  const isDesktop = useIsDesktop();
  const primary = columns.find(column => column.primary && !column.hideOnMobile) ?? columns.find(column => !column.hideOnMobile);
  const mobileColumns = columns.filter(column => !column.hideOnMobile && column !== primary);
  return <section aria-label={caption} aria-busy={loading} className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-white [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11 [&_input]:min-h-11 [&_a]:min-h-11 [&_a]:inline-flex [&_a]:items-center', className)}>
    {loading ? <LoadingState /> : items.length === 0 ? (emptyContent ?? <p className="p-8 text-center text-sm text-slate-600">{emptyMessage}</p>) : <>
      {!isDesktop && <div className="divide-y divide-slate-100">{items.map(item => <article key={getKey(item)} className="min-w-0 space-y-3 p-4">
        {primary && <div className="min-w-0 break-words text-sm font-semibold text-slate-900">{primary.render(item)}</div>}
        <dl className="grid grid-cols-1 gap-2">{mobileColumns.map(column => <div key={column.key} className={cn("flex min-w-0 gap-3 text-sm", column.fullWidthOnMobile ? "flex-col gap-1" : "items-start justify-between")}><dt className="shrink-0 text-slate-600">{column.label}</dt><dd className={cn("min-w-0 break-words text-slate-900", column.fullWidthOnMobile ? "w-full" : "text-right")}>{column.render(item)}</dd></div>)}</dl>
      </article>)}</div>}
      {isDesktop && <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><caption className="sr-only">{caption}</caption><thead className="bg-slate-50 text-xs text-slate-600"><tr>{columns.map(column => <th key={column.key} scope="col" className={cn('px-4 py-3 font-semibold', column.className)}>{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{items.map(item => <tr key={getKey(item)} className="hover:bg-slate-50">{columns.map(column => <td key={column.key} className={cn('px-4 py-3 align-top', column.className)}>{column.render(item)}</td>)}</tr>)}</tbody></table></div>}
    </>}
  </section>;
}

