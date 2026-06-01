import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Bell, Box, ChevronRight, Cpu, FileText, LogOut, Search, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DashboardAlert, SearchResult, StaffUser } from '../../types';
import { apiFetchJson } from '../../lib/api';
import { cn } from '../../lib/utils';

const ALERT_FIRST_SEEN_KEY = 'parkia.alertFirstSeen';

const readAlertFirstSeen = () => {
  try {
    const raw = window.localStorage.getItem(ALERT_FIRST_SEEN_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
};

const formatRelativeTime = (value: string | undefined, now: number) => {
  if (!value) return 'recién';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'recién';
  const diffMinutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (diffMinutes < 1) return 'menos de 1 min';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} d`;
};

const Header = ({ user, onLogout }: { user: StaffUser, onLogout: () => void }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const [alertFirstSeen, setAlertFirstSeen] = useState<Record<string, string>>({});
  const [relativeNow, setRelativeNow] = useState(Date.now());
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);
  const navigate = useNavigate();
  const canUseTotemSimulator = user.role === 'admin' || user.role === 'guard';

  const fetchAlerts = () => {
    apiFetchJson<{ alerts: DashboardAlert[] }>('/api/dashboard/alerts')
      .then(data => setAlerts(data.alerts || []))
      .catch(() => setAlerts([]));
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setRelativeNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setAlertFirstSeen(previous => {
      const stored = readAlertFirstSeen();
      const seenAt = new Date().toISOString();
      const next = alerts.reduce<Record<string, string>>((acc, alert) => {
        acc[alert.id] = previous[alert.id] || stored[alert.id] || seenAt;
        return acc;
      }, {});

      try {
        window.localStorage.setItem(ALERT_FIRST_SEEN_KEY, JSON.stringify(next));
      } catch {
        // El contador es informativo; si localStorage falla, se mantiene en memoria.
      }

      return next;
    });
  }, [alerts]);

  useEffect(() => {
    if (searchQuery.length > 2) {
      apiFetchJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(searchQuery)}`)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const handleSearchSelect = (result: SearchResult) => {
    navigate(result.link);
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  const handleAlertSelect = (alert: DashboardAlert) => {
    if (alert.taskId && alert.href.startsWith('/tasks')) {
      navigate(alert.href);
    } else {
      navigate(alert.taskId ? `/tasks?source=dashboard_alert&taskId=${alert.taskId}` : alert.href);
    }
    setIsNotificationsOpen(false);
  };

  const handlePasswordChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMessage({ type: 'error', text: 'La nueva clave no coincide.' });
      return;
    }

    setIsPasswordSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setPasswordMessage({ type: 'error', text: data.error || 'No se pudo cambiar la clave.' });
        return;
      }

      setPasswordMessage({ type: 'success', text: 'Clave actualizada.' });
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (error) {
      setPasswordMessage({ type: 'error', text: 'Error de red. Intenta nuevamente.' });
    } finally {
      setIsPasswordSubmitting(false);
    }
  };

  return (
    <header className="min-h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40 px-4 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 lg:gap-8">
      {/* Omnibox */}
      <div className="w-full sm:flex-1 sm:max-w-2xl relative">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
          <input
            aria-label="Buscar en el sistema"
            type="text"
            placeholder="Buscar por RUT, Nombre, Patente o ID..."
            className="w-full pl-12 pr-4 py-3 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all outline-none text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchOpen(true)}
          />
        </div>

        <AnimatePresence>
          {isSearchOpen && (searchQuery.length > 0 || searchResults.length > 0) && (
            <>
              <div className="fixed inset-0 z-[-1]" onClick={() => setIsSearchOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
              >
                {searchResults.length > 0 ? (
                  <div className="p-2">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.type}-${result.id}`}
                        onClick={() => handleSearchSelect(result)}
                        className="w-full flex items-center gap-4 p-3 hover:bg-slate-50 rounded-xl transition-colors text-left"
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-lg flex items-center justify-center",
                          result.type === 'client' ? "bg-blue-50 text-blue-600" :
                            result.type === 'contract' ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                        )}>
                          {result.type === 'client' ? <Users className="w-5 h-5" /> :
                            result.type === 'contract' ? <FileText className="w-5 h-5" /> : <Box className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{result.title}</p>
                          <p className="text-xs text-slate-500">{result.subtitle}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                      </button>
                    ))}
                  </div>
                ) : searchQuery.length > 2 ? (
                  <div className="p-8 text-center">
                    <p className="text-slate-500 text-sm">No se encontraron resultados para "{searchQuery}"</p>
                  </div>
                ) : (
                  <div className="p-4 text-slate-400 text-xs uppercase tracking-widest font-bold">
                    Escribe al menos 3 caracteres...
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 lg:gap-6">
        {/* Notifications */}
        <div className="relative flex items-center gap-2 sm:gap-4">
          {/* Simulator Button */}
          {canUseTotemSimulator && (
            <button
              onClick={() => {
                const event = new CustomEvent('openSimulatorDrawer');
                window.dispatchEvent(event);
              }}
              aria-label="Abrir simulador de tótems"
              className="hidden md:flex px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 items-center gap-2 font-bold text-sm transition-all"
            >
              <Cpu className="w-4 h-4" />
              Simulador Tótems
            </button>
          )}

          <button
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            aria-label={`Notificaciones${alerts.length > 0 ? `: ${alerts.length} activas` : ''}`}
            aria-expanded={isNotificationsOpen}
            className="w-11 h-11 rounded-xl hover:bg-slate-100 flex items-center justify-center relative transition-colors"
          >
            <Bell className="w-5 h-5 text-slate-600" />
            {alerts.length > 0 && (
              <span className="absolute top-1 right-1 min-w-5 h-5 px-1 bg-red-500 rounded-full border-2 border-white text-[10px] leading-4 font-bold text-white text-center">
                {alerts.length}
              </span>
            )}
          </button>

          <AnimatePresence>
            {isNotificationsOpen && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setIsNotificationsOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute top-full right-0 mt-2 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
                >
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="font-bold">Notificaciones</h3>
                    <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold uppercase">{alerts.length} Activas</span>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {alerts.length === 0 && (
                      <div className="p-8 text-center">
                        <p className="text-sm font-semibold text-slate-500">Sin alertas activas</p>
                        <p className="text-xs text-slate-400 mt-1">El sistema no registra pendientes críticos.</p>
                      </div>
                    )}
                    {alerts.map(alert => (
                      <button
                        key={alert.id}
                        onClick={() => handleAlertSelect(alert)}
                        className="w-full p-4 hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-50 text-left"
                      >
                        <div className="flex gap-3">
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                            alert.severity === 'critical' ? "bg-red-50 text-red-600" :
                              alert.severity === 'warning' ? "bg-amber-50 text-amber-600" : "bg-blue-50 text-blue-600"
                          )}>
                            <AlertCircle className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                            <p className="text-xs text-slate-500 mt-1">{alert.detail}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-bold uppercase text-slate-400">
                                Activa hace {formatRelativeTime(alertFirstSeen[alert.id], relativeNow)}
                              </span>
                              <span className="h-1 w-1 rounded-full bg-slate-300" />
                              <span className="text-[10px] font-bold uppercase text-slate-400">
                                {alert.taskId ? 'Tarea activa' : alert.actionLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { navigate('/'); setIsNotificationsOpen(false); }} className="w-full p-3 text-center text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors">
                    Ver dashboard
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="hidden sm:block h-8 w-px bg-slate-200" />

        {/* User Profile */}
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-slate-900">{user.name}</p>
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">{user.role}</p>
          </div>
          <button
            onClick={() => {
              setIsPasswordModalOpen(true);
              setPasswordMessage(null);
            }}
            className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-200"
            title="Cambiar clave"
            aria-label="Cambiar clave"
          >
            {user.name.charAt(0)}
          </button>
          <button
            onClick={onLogout}
            className="w-11 h-11 rounded-xl hover:bg-slate-100 flex items-center justify-center transition-colors"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-5 h-5 text-slate-500" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isPasswordModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
              onClick={() => setIsPasswordModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="password-modal-title"
              className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 id="password-modal-title" className="text-lg font-bold text-slate-900">Cambiar clave</h3>
                  <p className="text-xs text-slate-500 mt-1">{user.email}</p>
                </div>
                <button onClick={() => setIsPasswordModalOpen(false)} aria-label="Cerrar cambio de clave" className="p-2 rounded-xl hover:bg-slate-100">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <label htmlFor="current-password" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Clave actual</label>
                  <input
                    id="current-password"
                    type="password"
                    value={passwordForm.current_password}
                    onChange={e => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="new-password" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nueva clave</label>
                  <input
                    id="new-password"
                    type="password"
                    value={passwordForm.new_password}
                    onChange={e => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                    minLength={8}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="confirm-password" className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Confirmar nueva clave</label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={e => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                    minLength={8}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:border-indigo-600 outline-none"
                    required
                  />
                </div>

                {passwordMessage && (
                  <div className={cn(
                    "rounded-xl px-4 py-3 text-sm font-semibold",
                    passwordMessage.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                  )}>
                    {passwordMessage.text}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isPasswordSubmitting}
                  className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPasswordSubmitting ? 'Guardando...' : 'Actualizar clave'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Header;

