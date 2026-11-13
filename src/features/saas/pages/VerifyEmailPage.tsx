import React, { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { resendVerificationSchema } from '../../../../shared/schemas/saas';
import { useApiMutation } from '../../../lib/useApiMutation';
import { FieldError } from '../../../ui/FieldError';

export default function VerifyEmailPage() {
  const verifyMutation = useApiMutation('VerifyEmailPage.tsx');
  const resendMutation = useApiMutation('VerifyEmailPage.tsx');
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'missing'>('loading');
  const [message, setMessage] = useState<string>('');
  const [resendInfo, setResendInfo] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  const form = useForm<{ email: string }>({
    resolver: zodResolver(resendVerificationSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    const token = new URLSearchParams(window.location.search).get('token')?.trim() || '';
    if (!token) {
      setStatus('missing');
      setMessage('Falta el token de confirmación en el enlace.');
      return;
    }

    void verifyMutation
      .request('/api/public/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'No se pudo confirmar tu correo.');
          return;
        }
        setStatus('success');
        setMessage('Tu correo quedó confirmado. Ya puedes operar tu estacionamiento.');
      })
      .catch(() => {
        setStatus('error');
        setMessage('No se pudo conectar con el servidor para confirmar tu correo.');
      });
  }, []);

  const handleResend = form.handleSubmit(async (values) => {
    setResendInfo(null);
    const res = await resendMutation.request('/api/public/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: values.email }),
    });
    const data = await res.json().catch(() => ({}));
    setResendInfo(data.message || data.error || 'Si el correo es válido, enviamos un nuevo enlace.');
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Parkia SaaS</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Confirmación de correo</h1>
        </div>

        {status === 'loading' && (
          <p role="status" className="text-sm text-slate-600">Validando enlace de confirmación...</p>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
              {message}
            </div>
            <a
              href="/"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Entrar a Parkia
            </a>
          </div>
        )}

        {(status === 'error' || status === 'missing') && (
          <div className="space-y-4">
            <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {message}
            </div>
            <form onSubmit={handleResend} noValidate className="space-y-3">
              <label htmlFor="resend-email" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Solicitar nuevo enlace
              </label>
              <input
                id="resend-email"
                type="email"
                {...form.register('email')}
                placeholder="tu@correo.cl"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
              />
              <FieldError error={form.formState.errors.email} />
              <button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="min-h-11 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Reenviar confirmación
              </button>
              {resendInfo && (
                <p role="status" className="text-xs font-medium text-slate-700">{resendInfo}</p>
              )}
            </form>
            <a href="/" className="block text-center text-sm font-bold text-indigo-700 hover:underline">
              Volver al ingreso
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
