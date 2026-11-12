import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay } from './overlay';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
}

/** Hoja inferior en teléfono y panel lateral desde tablet. */
export function Sheet({ open, onClose, title, children, footer, dismissible = true }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useOverlay({ open, onClose, dismissible, panelRef });

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end md:items-stretch md:justify-end">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-950/50" onClick={dismissible ? onClose : undefined} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="relative flex w-full max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none md:h-dvh md:max-h-none md:max-w-xl md:rounded-none">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <h2 id={titleId} className="text-lg font-bold text-slate-900">{title}</h2>
          {dismissible && <button type="button" onClick={onClose} aria-label="Cerrar panel" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"><X aria-hidden="true" className="h-5 w-5" /></button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</div>
        {footer && <div className="shrink-0 border-t border-slate-200 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
