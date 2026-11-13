import { useApiMutation } from '../../lib/useApiMutation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock } from 'lucide-react';
import type { StaffUser } from '../../types';
import { FieldError } from '../../ui';
import { loginFormSchema } from '../../../shared/schemas/auth';
import ForgotPasswordForm from './ForgotPasswordForm';

const labelClass = 'text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block';
const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm focus:border-indigo-600 outline-none transition-all aria-[invalid=true]:border-red-500';

const LoginPage = ({ onLogin }: { onLogin: (user: StaffUser) => void }) => {
  const apiWrite = useApiMutation("components/auth/LoginPage.tsx");
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const form = useForm({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: 'admin@parkia.local', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async values => {
    setError('');
    try {
      const res = await apiWrite.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(values)
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'No se pudo iniciar sesion');
        return;
      }

      onLogin(data.user);
    } catch {
      setError('Error de red. Intenta nuevamente.');
    }
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-5">
            <Lock className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Parkia</h1>
          <p className="text-sm text-slate-600 mt-1">Acceso al sistema de gestion</p>
        </div>

        {forgot ? <ForgotPasswordForm initialEmail={form.getValues('email')} onBack={() => setForgot(false)} /> : <form noValidate aria-label="Iniciar sesión" onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className={labelClass}>Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              aria-invalid={errors.email ? true : undefined}
              {...form.register('email')}
              className={inputClass}
            />
            <FieldError error={errors.email} />
          </div>

          <div>
            <label htmlFor="login-password" className={labelClass}>Clave</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              {...form.register('password')}
              className={inputClass}
            />
            <FieldError error={errors.password} />
          </div>

          {error && (
            <div role="alert" className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm font-semibold">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Ingresando...' : 'Ingresar'}
          </button>
          <button type="button" onClick={() => setForgot(true)} className="min-h-11 w-full text-sm font-bold text-slate-700 hover:underline">¿Olvidaste tu clave?</button>
        </form>}
      </div>
    </div>
  );
};

export default LoginPage;
