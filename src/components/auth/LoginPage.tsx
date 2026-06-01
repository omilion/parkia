import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import type { StaffUser } from '../../types';

const LoginPage = ({ onLogin }: { onLogin: (user: StaffUser) => void }) => {
  const [email, setEmail] = useState('admin@parkia.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'No se pudo iniciar sesion');
        return;
      }

      onLogin(data.user);
    } catch (error) {
      setError('Error de red. Intenta nuevamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-5">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Parkia</h1>
          <p className="text-sm text-slate-500 mt-1">Acceso al sistema de gestion</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none transition-all"
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Clave</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none transition-all"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 text-sm font-semibold">
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
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
