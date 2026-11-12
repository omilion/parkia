import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useOverlay } from '../../ui/overlay';

type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  isLoading?: boolean;
  isConfirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'default', isLoading = false, isConfirmDisabled = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useOverlay({ open: isOpen, onClose: onCancel, dismissible: !isLoading, panelRef });
  if (!isOpen) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/50" aria-hidden="true" onClick={isLoading ? undefined : onCancel} />
      <div ref={panelRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} className="relative w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-2xl sm:p-6 space-y-5">
        <div className="flex items-start gap-4">
          <div className={tone === 'danger' ? 'p-3 bg-red-50 text-red-600 rounded-xl' : 'p-3 bg-amber-50 text-amber-700 rounded-xl'}><AlertTriangle aria-hidden="true" className="w-5 h-5" /></div>
          <div><h3 id={titleId} className="text-lg font-bold text-slate-900">{title}</h3><div id={messageId} className="mt-1 text-sm text-slate-600 leading-relaxed">{message}</div></div>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onCancel} disabled={isLoading} className="min-h-11 flex-1 rounded-xl bg-slate-100 px-3 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={isLoading || isConfirmDisabled} className={tone === 'danger' ? 'min-h-11 flex-1 rounded-xl bg-red-600 px-3 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50' : 'min-h-11 flex-1 rounded-xl bg-slate-900 px-3 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50'}>{isLoading ? 'Procesando...' : confirmLabel}</button>
        </div>
      </div>
    </div>, document.body,
  );
}
