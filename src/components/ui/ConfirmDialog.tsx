import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

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

const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  isLoading = false,
  isConfirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          onClick={isLoading ? undefined : onCancel}
        />
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-5"
        >
          <div className="flex items-start gap-4">
            <div className={tone === 'danger' ? 'p-3 bg-red-50 text-red-600 rounded-xl' : 'p-3 bg-amber-50 text-amber-600 rounded-xl'}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900">{title}</h3>
              <div id="confirm-dialog-message" className="mt-1 text-sm text-slate-500 leading-relaxed">{message}</div>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading || isConfirmDisabled}
              className={tone === 'danger'
                ? 'flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all disabled:opacity-50'
                : 'flex-1 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50'}
            >
              {isLoading ? 'Procesando...' : confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

export default ConfirmDialog;
