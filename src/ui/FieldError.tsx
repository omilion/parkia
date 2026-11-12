/** Mensaje de validación bajo un campo. Se anuncia a lectores de pantalla. */
export function FieldError({ error, id }: { error?: { message?: string }; id?: string }) {
  if (!error?.message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-medium text-red-800">
      {error.message}
    </p>
  );
}

/** Estilo de los formularios de paneles laterales (mismo aspecto que tenían antes de migrar). */
export const formLabelClass = 'text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block';
export const formInputClass =
  'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm focus:bg-white focus:border-slate-900 outline-none transition-all aria-[invalid=true]:border-red-500';
