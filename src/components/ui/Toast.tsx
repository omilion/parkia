import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error', onClose: () => void }) => (
  <motion.div
    initial={{ opacity: 0, x: 50 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 50 }}
    className={cn(
      "fixed top-6 right-6 z-[100] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border",
      type === 'success' ? "bg-emerald-50 border-emerald-100 text-emerald-900" : "bg-red-50 border-red-100 text-red-900"
    )}
  >
    <div className={cn("w-2 h-2 rounded-full", type === 'success' ? "bg-emerald-500" : "bg-red-500")} />
    <p className="text-sm font-bold">{message}</p>
    <button onClick={onClose} aria-label="Cerrar notificación" className="ml-4 text-slate-400 hover:text-slate-900"><X className="w-4 h-4" /></button>
  </motion.div>
);

export default Toast;
