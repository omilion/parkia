import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { selfServeSignupSchema, type SelfServeSignupValues } from '../../../../shared/schemas/saas';
import { useApiMutation } from '../../../lib/useApiMutation';
import { FieldError } from '../../../ui/FieldError';

const inputClass =
  'w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-indigo-500';
const labelClass = 'block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5';

export default function SignupPage() {
  const signupMutation = useApiMutation('SignupPage.tsx');
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<SelfServeSignupValues>({
    resolver: zodResolver(selfServeSignupSchema) as any,
    defaultValues: {
      company_name: '',
      company_rut: '',
      owner_name: '',
      email: '',
      password: '',
      branch_name: '',
      accept_terms: false as any,
    },
  });

  const {
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await signupMutation.request('/api/public/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'No se pudo completar el registro');
      return;
    }
    setSubmittedMessage(
      data.message || 'Si el correo es válido, enviamos un enlace de confirmación válido por 24 horas.',
    );
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Parkia SaaS · Prueba de 15 días</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Crea tu cuenta de estacionamiento</h1>
          <p className="mt-1 text-sm text-slate-600">
            Configura tu empresa en minutos. Te enviaremos un enlace para confirmar tu correo antes de operar.
          </p>
        </div>

        {submittedMessage ? (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
              {submittedMessage}
            </div>
            <p className="text-xs text-slate-600">
              Revisa tu bandeja de entrada o spam. Una vez confirmado tu correo podrás ingresar a tu panel.
            </p>
            <a
              href="/"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Ir al ingreso
            </a>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="signup-company" className={labelClass}>Nombre de la empresa</label>
              <input id="signup-company" type="text" {...form.register('company_name')} className={inputClass} />
              <FieldError error={errors.company_name} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="signup-rut" className={labelClass}>RUT empresa</label>
                <input
                  id="signup-rut"
                  type="text"
                  placeholder="76.123.456-K"
                  {...form.register('company_rut')}
                  className={inputClass}
                />
                <FieldError error={errors.company_rut} />
              </div>
              <div>
                <label htmlFor="signup-branch" className={labelClass}>Sucursal inicial (opcional)</label>
                <input
                  id="signup-branch"
                  type="text"
                  placeholder="Casa Matriz"
                  {...form.register('branch_name')}
                  className={inputClass}
                />
                <FieldError error={errors.branch_name} />
              </div>
            </div>

            <div>
              <label htmlFor="signup-owner" className={labelClass}>Tu nombre completo</label>
              <input id="signup-owner" type="text" {...form.register('owner_name')} className={inputClass} />
              <FieldError error={errors.owner_name} />
            </div>

            <div>
              <label htmlFor="signup-email" className={labelClass}>Correo electrónico</label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                {...form.register('email')}
                className={inputClass}
              />
              <FieldError error={errors.email} />
            </div>

            <div>
              <label htmlFor="signup-password" className={labelClass}>Clave (mínimo 8 caracteres)</label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
                className={inputClass}
              />
              <FieldError error={errors.password} />
            </div>

            <div className="flex items-start gap-3">
              <input
                id="signup-terms"
                type="checkbox"
                {...form.register('accept_terms')}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="signup-terms" className="text-xs leading-relaxed text-slate-700">
                Acepto los términos del servicio y el tratamiento de datos conforme a la Ley 21.719.
              </label>
            </div>
            <FieldError error={errors.accept_terms} />

            {error && (
              <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 w-full rounded-xl bg-slate-900 py-3.5 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Creando cuenta...' : 'Comenzar prueba gratuita'}
            </button>

            <p className="text-center text-sm text-slate-600">
              ¿Ya tienes cuenta?{' '}
              <a href="/" className="font-bold text-indigo-700 hover:underline">
                Inicia sesión
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

