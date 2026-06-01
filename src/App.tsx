import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { StaffUser } from './types';
import LoginPage from './components/auth/LoginPage';
import SimulatorDrawer from './components/access/SimulatorDrawer';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SpacesPage = lazy(() => import('./pages/SpacesPage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));

const PasswordChangeGate = ({ user, onChanged, onLogout }: { user: StaffUser, onChanged: () => void, onLogout: () => void }) => {
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);

    if (form.new_password !== form.confirm_password) {
      setMessage({ type: 'error', text: 'La nueva clave no coincide.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'No se pudo actualizar la clave.' });
        return;
      }
      setMessage({ type: 'success', text: 'Clave actualizada.' });
      onChanged();
    } catch (error) {
      setMessage({ type: 'error', text: 'Error de red. Intenta nuevamente.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Seguridad administrativa</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Cambia tu clave para continuar</h1>
          <p className="mt-2 text-sm text-slate-500">{user.email}</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Clave actual</label>
            <input type="password" value={form.current_password} onChange={e => setForm({ ...form, current_password: e.target.value })} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-indigo-600 focus:bg-white" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Nueva clave</label>
            <input type="password" value={form.new_password} onChange={e => setForm({ ...form, new_password: e.target.value })} minLength={8} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-indigo-600 focus:bg-white" />
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Confirmar nueva clave</label>
            <input type="password" value={form.confirm_password} onChange={e => setForm({ ...form, confirm_password: e.target.value })} minLength={8} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-indigo-600 focus:bg-white" />
          </div>
          {message && (
            <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {message.text}
            </div>
          )}
          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            {isSubmitting ? 'Guardando...' : 'Actualizar clave'}
          </button>
          <button type="button" onClick={onLogout} className="w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (data?.user) setCurrentUser(data.user);
      })
      .finally(() => setIsAuthLoading(false));
  }, []);
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setCurrentUser(null);
  };
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white text-sm font-bold">
        Cargando...
      </div>
    );
  }
  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }
  if (currentUser.must_change_password) {
    return (
      <PasswordChangeGate
        user={currentUser}
        onChanged={() => setCurrentUser({ ...currentUser, must_change_password: false })}
        onLogout={handleLogout}
      />
    );
  }
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar user={currentUser} />
        <main className="flex-1 lg:ml-64 min-h-screen flex flex-col relative pb-20 lg:pb-0 min-w-0">
          <Header user={currentUser} onLogout={handleLogout} />
          <SimulatorDrawer />
          <div className="flex-1">
            <AnimatePresence mode="wait">
              <Suspense fallback={<div className="p-8 text-sm font-bold text-slate-400">Cargando modulo...</div>}>
                <Routes>
                  <Route path="/" element={<Dashboard user={currentUser} />} />
                  <Route path="/clients" element={['admin', 'finance'].includes(currentUser.role) ? <ClientsPage /> : <Navigate to="/" />} />
                  <Route path="/spaces" element={<SpacesPage user={currentUser} />} />
                  <Route path="/tasks" element={<TasksPage user={currentUser} />} />
                  <Route path="/contracts" element={['admin', 'finance'].includes(currentUser.role) ? <ContractsPage /> : <Navigate to="/" />} />
                  <Route path="/documents" element={['admin', 'finance'].includes(currentUser.role) ? <DocumentsPage /> : <Navigate to="/" />} />
                  <Route path="/finance" element={['admin', 'finance'].includes(currentUser.role) ? <FinancePage user={currentUser} /> : <Navigate to="/" />} />
                  <Route path="/access" element={['admin', 'guard'].includes(currentUser.role) ? <AccessPage /> : <Navigate to="/" />} />
                  <Route path="/audit" element={currentUser.role === 'admin' ? <AuditPage /> : <Navigate to="/" />} />
                  <Route path="/staff" element={currentUser.role === 'admin' ? <StaffPage /> : <Navigate to="/" />} />
                  <Route path="/settings" element={currentUser.role === 'admin' ? <SettingsPage /> : <Navigate to="/" />} />
                </Routes>
              </Suspense>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </Router>
  );
}
