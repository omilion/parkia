import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Edit3, History, KeyRound, UserPlus } from 'lucide-react';
import { StaffAccessEvent, StaffUser } from '../types';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Drawer from '../components/ui/Drawer';
import Toast from '../components/ui/Toast';
import { cn } from '../lib/utils';

const roleMeta = [
  { id: 'admin', label: 'Administrador', desc: 'Acceso total a todos los modulos.' },
  { id: 'finance', label: 'Finanzas', desc: 'Acceso a Clientes, Contratos y Finanzas.' },
  { id: 'guard', label: 'Guardia / Conserje', desc: 'Acceso a Control de Espacios y Monitor.' },
  { id: 'cashier', label: 'Caja', desc: 'Crea tickets, cobra visitas y cierra caja.' }
];

const StaffPage = () => {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [passwordModalUser, setPasswordModalUser] = useState<StaffUser | null>(null);
  const [editModalUser, setEditModalUser] = useState<StaffUser | null>(null);
  const [editReason, setEditReason] = useState('');
  const [accessModalUser, setAccessModalUser] = useState<StaffUser | null>(null);
  const [accessEvents, setAccessEvents] = useState<StaffAccessEvent[] | null>(null);
  const [staffStatusAction, setStaffStatusAction] = useState<StaffUser | null>(null);
  const [staffStatusReason, setStaffStatusReason] = useState('');
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const fetchData = async () => {
    const res = await fetch('/api/staff');
    setStaff(await res.json());
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsActionLoading(true);
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Usuario creado. Entrega la clave inicial por el canal operativo definido.', type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      setToast({ message: 'Error al crear usuario', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!passwordModalUser) return;

    const formData = new FormData(e.currentTarget);
    const password = String(formData.get('password') || '');
    const passwordConfirm = String(formData.get('password_confirm') || '');
    const reason = String(formData.get('reason') || '').trim();

    if (password !== passwordConfirm) {
      setToast({ message: 'Las claves no coinciden', type: 'error' });
      return;
    }
    if (reason.length < 3) {
      setToast({ message: 'Indica el motivo operacional del reset', type: 'error' });
      return;
    }

    setIsActionLoading(true);
    const res = await fetch(`/api/staff/${passwordModalUser.id}/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, reason })
    });

    if (res.ok) {
      setToast({ message: 'Clave restablecida. Las sesiones anteriores fueron cerradas.', type: 'success' });
      setPasswordModalUser(null);
    } else {
      setToast({ message: 'No se pudo restablecer la clave', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleUpdateStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editModalUser) return;

    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    setIsActionLoading(true);
    const res = await fetch(`/api/staff/${editModalUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, reason: editReason })
    });

    if (res.ok) {
      setToast({ message: 'Usuario actualizado con trazabilidad', type: 'success' });
      setEditModalUser(null);
      setEditReason('');
      fetchData();
    } else {
      const body = await res.json();
      setToast({ message: body.error || 'No se pudo actualizar el usuario', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const openAccessHistory = async (user: StaffUser) => {
    setAccessModalUser(user);
    setAccessEvents(null);
    const res = await fetch(`/api/staff/${user.id}/access-events`);
    if (res.ok) {
      setAccessEvents(await res.json());
    } else {
      setAccessEvents([]);
      setToast({ message: 'No se pudo cargar el historial de accesos', type: 'error' });
    }
  };

  const closeStaffStatusDialog = () => {
    setStaffStatusAction(null);
    setStaffStatusReason('');
  };

  const toggleStatus = async () => {
    if (!staffStatusAction) return;
    const user = staffStatusAction;
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    setIsActionLoading(true);
    const res = await fetch(`/api/staff/${user.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, reason: staffStatusReason })
    });
    if (res.ok) {
      setToast({ message: `Usuario ${newStatus === 'active' ? 'activado' : 'desactivado'}`, type: 'success' });
      closeStaffStatusDialog();
      fetchData();
    } else {
      const body = await res.json();
      setToast({ message: body.error || 'No se pudo actualizar el usuario', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const getRoleLabel = (role: StaffUser['role']) => {
    if (role === 'admin') return 'Admin';
    if (role === 'finance') return 'Finanzas';
    if (role === 'cashier') return 'Caja';
    return 'Guardia';
  };

  const getEventLabel = (eventType: StaffAccessEvent['event_type']) => {
    if (eventType === 'login') return 'Ingreso';
    if (eventType === 'logout') return 'Salida';
    if (eventType === 'password_changed') return 'Cambio de clave';
    if (eventType === 'password_reset') return 'Clave reseteada';
    if (eventType === 'status_changed') return 'Estado actualizado';
    if (eventType === 'role_changed') return 'Rol actualizado';
    return 'Ficha actualizada';
  };

  const getEventMetadata = (event: StaffAccessEvent) => {
    if (!event.metadata) return '';
    try {
      const metadata = JSON.parse(event.metadata);
      return metadata.reason || metadata.email || '';
    } catch {
      return '';
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <form onSubmit={handleResetPassword} role="dialog" aria-modal="true" aria-labelledby="staff-password-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 id="staff-password-title" className="text-lg font-bold text-slate-900">Restablecer clave</h3>
                <p className="mt-1 text-sm text-slate-500">{passwordModalUser.name} debera ingresar con la nueva clave y cambiarla antes de operar.</p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Nueva clave</label>
                <input type="password" name="password" minLength={8} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Confirmar clave</label>
                <input type="password" name="password_confirm" minLength={8} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Motivo operacional</label>
                <textarea
                  name="reason"
                  rows={3}
                  minLength={3}
                  required
                  placeholder="Ej: olvido de clave validado por administracion..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition-all focus:border-slate-900 focus:bg-white"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPasswordModalUser(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" disabled={isActionLoading} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                Guardar clave
              </button>
            </div>
          </form>
        </div>
      )}

      {editModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <form onSubmit={handleUpdateStaff} role="dialog" aria-modal="true" aria-labelledby="staff-edit-title" className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <Edit3 className="h-5 w-5" />
              </div>
              <div>
                <h3 id="staff-edit-title" className="text-lg font-bold text-slate-900">Editar usuario</h3>
                <p className="mt-1 text-sm text-slate-500">Todo cambio queda registrado con motivo y fecha.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Nombre completo</label>
                <input name="name" defaultValue={editModalUser.name} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">RUT</label>
                <input name="rut" defaultValue={editModalUser.rut} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Correo</label>
                <input type="email" name="email" defaultValue={editModalUser.email} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Telefono</label>
                <input name="phone" defaultValue={editModalUser.phone || ''} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Rol</label>
                <div className="grid gap-3 md:grid-cols-4">
                  {roleMeta.map(role => (
                    <label key={role.id} className="relative flex cursor-pointer items-center rounded-xl border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                      <input type="radio" name="role" value={role.id} defaultChecked={editModalUser.role === role.id} required className="sr-only peer" />
                      <div>
                        <p className="text-sm font-bold text-slate-900">{role.label}</p>
                        <p className="text-[10px] text-slate-500">{role.desc}</p>
                      </div>
                      <div className="ml-auto h-4 w-4 rounded-full border-2 border-slate-200 transition-all peer-checked:border-[5px] peer-checked:border-slate-900" />
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Motivo del cambio</label>
                <textarea
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  rows={3}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-900 focus:bg-white"
                  placeholder="Ej: actualizacion de contacto, cambio de funciones, correccion administrativa..."
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => { setEditModalUser(null); setEditReason(''); }} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button type="submit" disabled={isActionLoading || editReason.trim().length < 3} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                Guardar cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {accessModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="staff-access-title" className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h3 id="staff-access-title" className="text-lg font-bold text-slate-900">Historial de seguridad</h3>
                <p className="mt-1 text-sm text-slate-500">{accessModalUser.name} · {accessModalUser.email}</p>
              </div>
              <button onClick={() => { setAccessModalUser(null); setAccessEvents(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cerrar
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-100">
              {!accessEvents && (
                <div className="p-6 text-sm font-semibold text-slate-400">Cargando historial...</div>
              )}
              {accessEvents?.length === 0 && (
                <div className="p-6 text-sm font-semibold text-slate-400">Sin eventos registrados todavia.</div>
              )}
              {accessEvents && accessEvents.length > 0 && (
                <table className="w-full text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Evento</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Fecha</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">IP</th>
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accessEvents.map(event => (
                      <tr key={event.id}>
                        <td className="px-4 py-3 text-sm font-bold text-slate-700">{getEventLabel(event.event_type)}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-500">{event.ip_address || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{getEventMetadata(event) || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Personal Interno</h2>
          <p className="text-slate-500 mt-1">Gestion de usuarios y roles del sistema (RBAC).</p>
        </div>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
        >
          <UserPlus className="w-5 h-5" />
          Nuevo Usuario
        </button>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Personal</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">RUT</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Rol</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Ultimo Acceso</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map(user => (
              <tr key={user.id} className={cn("hover:bg-slate-50/50 transition-colors", user.status === 'inactive' && "opacity-50")}>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm font-mono text-slate-500">{user.rut}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 w-fit",
                    user.role === 'admin' ? "bg-amber-100 text-amber-600" :
                      user.role === 'finance' ? "bg-blue-100 text-blue-600" :
                        user.role === 'cashier' ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-600"
                  )}>
                    {getRoleLabel(user.role)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-col items-start gap-1">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                      user.status === 'active' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                    )}>
                      {user.status === 'active' ? 'Activo' : 'Inactivo'}
                    </span>
                    {user.must_change_password && (
                      <span className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                        Debe cambiar clave
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-slate-500">
                  {user.last_access ? new Date(user.last_access).toLocaleString() : 'Nunca'}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={() => {
                        setEditModalUser(user);
                        setEditReason('');
                      }}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    <button
                      onClick={() => openAccessHistory(user)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      <History className="h-3.5 w-3.5" />
                      Historial
                    </button>
                    <button
                      onClick={() => setPasswordModalUser(user)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Clave
                    </button>
                    <button
                      onClick={() => setStaffStatusAction(user)}
                      className={cn(
                        "text-xs font-bold hover:underline",
                        user.status === 'active' ? "text-red-600" : "text-emerald-600"
                      )}
                    >
                      {user.status === 'active' ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} title="Nuevo Usuario de Personal">
        <form onSubmit={handleCreateUser} className="space-y-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nombre Completo</label>
              <input type="text" name="name" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT</label>
                <input type="text" name="rut" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Telefono</label>
                <input type="text" name="phone" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Correo Electronico (Usuario)</label>
              <input type="email" name="email" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Clave Inicial</label>
              <input type="password" name="password" minLength={8} required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nivel de Acceso (Rol)</label>
              <div className="grid grid-cols-1 gap-3">
                {roleMeta.map(role => (
                  <label key={role.id} className="relative flex items-center p-4 border border-slate-200 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50/50">
                    <input type="radio" name="role" value={role.id} required className="sr-only peer" />
                    <div>
                      <p className="text-sm font-bold">{role.label}</p>
                      <p className="text-[10px] text-slate-500">{role.desc}</p>
                    </div>
                    <div className="ml-auto w-4 h-4 border-2 border-slate-200 rounded-full peer-checked:border-slate-900 peer-checked:border-[5px] transition-all" />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <button type="submit" disabled={isActionLoading} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
            Crear usuario
          </button>
        </form>
      </Drawer>

      <ConfirmDialog
        isOpen={Boolean(staffStatusAction)}
        title={staffStatusAction?.status === 'active' ? 'Desactivar usuario' : 'Activar usuario'}
        message={
          <div className="space-y-4">
            <p>
              {staffStatusAction?.status === 'active'
                ? <>Se cerraran las sesiones activas de <strong>{staffStatusAction?.name}</strong> y no podra ingresar hasta ser reactivado.</>
                : <><strong>{staffStatusAction?.name}</strong> recuperara acceso al sistema.</>}
            </p>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Motivo operacional</label>
              <textarea
                value={staffStatusReason}
                onChange={(e) => setStaffStatusReason(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-slate-900 focus:bg-white"
                placeholder="Ej: salida de turno, desvinculacion, reactivacion autorizada..."
              />
            </div>
          </div>
        }
        confirmLabel={staffStatusAction?.status === 'active' ? 'Desactivar' : 'Activar'}
        tone={staffStatusAction?.status === 'active' ? 'danger' : 'default'}
        isLoading={isActionLoading}
        isConfirmDisabled={staffStatusReason.trim().length < 3}
        onCancel={closeStaffStatusDialog}
        onConfirm={toggleStatus}
      />
    </div>
  );
};

export default StaffPage;
