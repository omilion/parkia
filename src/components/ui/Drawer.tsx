import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

const Drawer = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: ReactNode }) => (

  <AnimatePresence>
    {isOpen && (
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60]"
        />
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-title"
          className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-[70] flex flex-col"
        >
          <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 id="drawer-title" className="text-xl font-bold">{title}</h3>
            <button onClick={onClose} aria-label="Cerrar panel" className="p-2 hover:bg-slate-50 rounded-xl transition-colors">
              <X className="w-6 h-6 text-slate-400" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default Drawer;
