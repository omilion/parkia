import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay } from './overlay';

export function Dialog({ open, onClose, title, children, footer, dismissible = true }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; dismissible?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay({ open, onClose, dismissible, panelRef });
  if (!open) return null;
  return createPortal(<div className="fixed inset-0 z-[100] flex items-end justify-center md:items-center md:p-6">
    <div className="absolute inset-0 bg-slate-950/50" aria-hidden="true" onClick={dismissible ? onClose : undefined} />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none md:rounded-2xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 p-4"><h2 id={titleId} className="text-lg font-bold">{title}</h2>{dismissible && <button type="button" onClick={onClose} aria-label="Cerrar diálogo" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100"><X aria-hidden="true" className="h-5 w-5" /></button>}</header>
      <div className="min-h-0 overflow-y-auto p-4 md:p-6">{children}</div>
      {footer && <footer className="shrink-0 border-t border-slate-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</footer>}
    </div>
  </div>, document.body);
}
