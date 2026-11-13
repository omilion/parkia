import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordFormSchema } from '../../../shared/schemas/auth';
import { useApiMutation } from '../../lib/useApiMutation';
import { FieldError, formInputClass, formLabelClass } from '../../ui';

/** Pagina publica a la que llega el enlace del correo de recuperacion: `/restablecer?token=...`. */
export default function ResetPasswordPage() {
  const apiWrite = useApiMutation('components/auth/ResetPasswordPage');
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const form = useForm({ resolver: zodResolver(resetPasswordFormSchema), defaultValues: { new_password: '', confirm_password: '' } });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async values => {
    setError('');
    try {
      await apiWrite.json('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, new_password: values.new_password }) });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la clave');
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Parkia</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Elegir una clave nueva</h1>
        {!token ? (
          <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-800">El enlace no es válido. Pide uno nuevo desde la pantalla de ingreso.</p>
        ) : done ? (
          <div className="mt-5 space-y-5">
            <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">Tu clave fue cambiada. Ya puedes ingresar con la clave nueva.</p>
            <a href="/" className="flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800">Ir a ingresar</a>
          </div>
        ) : (
          <form noValidate aria-label="Formulario de clave nueva" onSubmit={submit} className="mt-5 space-y-5">
            <div>
              <label htmlFor="reset-password" className={formLabelClass}>Clave nueva</label>
              <input id="reset-password" type="password" autoComplete="new-password" aria-invalid={errors.new_password ? true : undefined} {...form.register('new_password')} className={formInputClass} />
              <FieldError error={errors.new_password} />
            </div>
            <div>
              <label htmlFor="reset-confirm" className={formLabelClass}>Repite la clave</label>
              <input id="reset-confirm" type="password" autoComplete="new-password" aria-invalid={errors.confirm_password ? true : undefined} {...form.register('confirm_password')} className={formInputClass} />
              <FieldError error={errors.confirm_password} />
            </div>
            {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
            <button type="submit" disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-slate-900 py-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
              {isSubmitting ? 'Guardando...' : 'Guardar clave nueva'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
