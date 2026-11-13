import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registra el service worker (solo en la versión compilada) y avisa cuando hay una versión nueva.
 * La actualización la elige el usuario: así nunca se recarga la pantalla en medio de un cobro.
 */
export function PwaUpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => undefined,
  });
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[90] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-slate-900 p-4 text-sm text-white shadow-2xl md:bottom-6">
      <span>Hay una versión nueva de Parkia.</span>
      <span className="flex shrink-0 gap-2">
        <button type="button" onClick={() => setNeedRefresh(false)} className="min-h-11 rounded-lg px-3 font-semibold text-slate-300 hover:text-white">Después</button>
        <button type="button" onClick={() => { void updateServiceWorker(true); }} className="min-h-11 rounded-lg bg-white px-4 font-bold text-slate-900 hover:bg-slate-100">Actualizar</button>
      </span>
    </div>
  );
}
