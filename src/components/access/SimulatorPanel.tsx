import { useApiMutation } from '../../lib/useApiMutation';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, Cpu, RefreshCw, X } from 'lucide-react';
import { Totem } from '../../types';
import { cn } from '../../lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError } from '../../ui';
import { totemScanFormSchema } from '../../../shared/schemas/access';

/** Panel del simulador; se descarga recién cuando alguien lo abre. */
const SimulatorPanel = ({ onClose }: { onClose: () => void }) => {
  const apiWrite = useApiMutation("components/access/SimulatorDrawer.tsx");
  const [totems, setTotems] = useState<Totem[]>([]);
  const form = useForm({ resolver: zodResolver(totemScanFormSchema), defaultValues: { totem_id: '', plate: '' } });
  const isSimulating = form.formState.isSubmitting;
  const plate = form.watch('plate');
  const [resultMessage, setResultMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchTotems();
  }, []);

  const fetchTotems = async () => {
    const res = await fetch('/api/totems');
    if (res.ok) {
      const data = await res.json();
      setTotems(data);
      if (data.length > 0) form.setValue('totem_id', data[0].id.toString());
    }
  };

  const handleSimulateEntry = form.handleSubmit(async values => {
    setResultMessage(null);
    try {
      const res = await apiWrite.request('/api/totems/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });

      const data = await res.json();

      if (res.ok) {
        setResultMessage({ text: data.message, type: 'success' });
        // Se cierra solo después de una lectura exitosa.
        setTimeout(onClose, 3000);
      } else {
        setResultMessage({ text: data.error || 'Error de lectura', type: 'error' });
      }
    } catch {
      setResultMessage({ text: 'Error de red. Verifique la conexión.', type: 'error' });
    } finally {
      form.setValue('plate', '');
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col"
      >
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-indigo-600 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Simulador LPR</h3>
              <p className="text-xs text-indigo-200">Emulador de Barrera</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8 bg-slate-50">
          <div className="glass-card p-6 border-l-4 border-l-indigo-500">
            <h4 className="text-sm font-bold text-slate-800 mb-2">Instrucciones</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Selecciona el Tótem que deseas probar e ingresa una Patente o Rut. El sistema validará si es cliente o si debe emitir un ticket de visita.
            </p>
          </div>

          <form noValidate aria-label="Simular lectura de patente" onSubmit={handleSimulateEntry} className="space-y-6">
            <div>
              <label htmlFor="simulator-totem" className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block">Tótem Físico</label>
              <select
                id="simulator-totem"
                {...form.register('totem_id')}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none transition-all"
              >
                {totems.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                ))}
              </select>
              <FieldError error={form.formState.errors.totem_id} />
            </div>

            <div>
              <label htmlFor="simulator-plate" className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block text-center">Módulo de Lectura (Cámara LPR)</label>
              <div className="bg-slate-900 rounded-3xl p-6 relative overflow-hidden group">
                {/* Simulated scan line */}
                {isSimulating && (
                  <motion.div
                    initial={{ top: 0 }}
                    animate={{ top: '100%' }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="absolute left-0 right-0 h-1 bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.8)] z-10"
                  />
                )}
                <div className="text-center space-y-4 relative z-0">
                  <Camera className="w-12 h-12 text-slate-600 mx-auto" />
                  <input
                    id="simulator-plate"
                    type="text"
                    autoCapitalize="characters"
                    {...form.register('plate', { setValueAs: value => String(value ?? '').trim().toUpperCase() })}
                    placeholder="ABCD12"
                    className="w-full bg-slate-800 border-2 border-slate-700 text-white rounded-xl px-4 py-3 text-center text-2xl font-mono uppercase tracking-widest focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                  />
                  <p className="text-xs text-slate-500 uppercase tracking-widest">Ingrese Patente</p>
                </div>
              </div>
            </div>

            {resultMessage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "p-4 rounded-2xl text-center border-2",
                  resultMessage.type === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
                )}
              >
                <p className="text-sm font-bold">{resultMessage.text}</p>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isSimulating || !plate}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSimulating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Procesando Lectura...
                </>
              ) : (
                'Simular Ingreso Vehicular'
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};


export default SimulatorPanel;

