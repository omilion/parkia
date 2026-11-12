import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../lib/utils';

export type TabItem = { value: string; label: string; panelId?: string };
/** Teclado con flechas/Home/End; el estado puede pertenecer a la URL o al padre. */
export function Tabs({ items, label, value, onValueChange, queryKey = 'tab' }: {
  items: TabItem[]; label: string; value?: string; onValueChange?: (value: string) => void; queryKey?: string;
}) {
  const [params, setParams] = useSearchParams();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const requested = value ?? params.get(queryKey);
  const active = items.some(item => item.value === requested) ? requested : items[0]?.value;
  const select = (next: string) => {
    if (onValueChange) onValueChange(next);
    else { const updated = new URLSearchParams(params); updated.set(queryKey, next); setParams(updated); }
  };
  return <div className="relative min-w-0"><div role="tablist" aria-label={label} className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-1 [scrollbar-width:thin]">{items.map((item, index) => <button key={item.value} ref={node => { refs.current[index] = node; }} type="button" role="tab" aria-selected={active === item.value} aria-controls={item.panelId} tabIndex={active === item.value ? 0 : -1} onClick={() => select(item.value)} onKeyDown={event => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault(); select(items[next].value); refs.current[next]?.focus(); refs.current[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }} className={cn('min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold', active === item.value ? 'bg-indigo-50 text-indigo-800' : 'text-slate-600 hover:bg-slate-100')}>{item.label}</button>)}</div></div>;
}
