import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordFormSchema } from '../../../shared/schemas/auth';
import { useApiMutation } from '../../lib/useApiMutation';
import { FieldError, formInputClass, formLabelClass } from '../../ui';

/** Pide el correo de recuperación. La respuesta es siempre la misma: no revela si la dirección existe. */
export default function ForgotPasswordForm({ initialEmail = '', onBack }: { initialEmail?: string; onBack: () => void }) {
  const apiWrite = useApiMutation('components/auth/ForgotPasswordForm');
  const form = useForm({ resolver: zodResolver(forgotPasswordFormSchema), defaultValues: { email: initialEmail } });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async values => {
    setError('');
    try {
      await apiWrite.json('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar la solicitud');
    }
  });

  if (sent) {
    return (
      <div className="space-y-5">
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
          Si el correo está registrado, te enviamos un enlace para elegir una clave nueva. Revisa tu bandeja de entrada (y el spam). El enlace vence en 30 minutos.
        </p>
        <button type="button" onClick={onBack} className="min-h-11 w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Volver a ingresar</button>
      </div>
    );
  }

  return (
    <form noValidate aria-label="Recuperar clave" onSubmit={submit} className="space-y-5">
      <p className="text-sm text-slate-600">Ingresa tu correo y te enviaremos un enlace para elegir una clave nueva.</p>
      <div>
        <label htmlFor="forgot-email" className={formLabelClass}>Email</label>
        <input id="forgot-email" type="email" autoComplete="username" aria-invalid={errors.email ? true : undefined} {...form.register('email')} className={formInputClass} />
        <FieldError error={errors.email} />
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
      <button type="submit" disabled={isSubmitting} className="min-h-11 w-full rounded-xl bg-slate-900 py-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
        {isSubmitting ? 'Enviando...' : 'Enviar enlace'}
      </button>
      <button type="button" onClick={onBack} className="min-h-11 w-full text-sm font-bold text-slate-700 hover:underline">Volver a ingresar</button>
    </form>
  );
}
