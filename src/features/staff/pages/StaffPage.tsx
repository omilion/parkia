import { useApiMutation } from '../../../lib/useApiMutation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetchJson } from '../../../lib/api';
import { DataView } from '../../../ui/DataView';
import React, { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { UserPlus } from 'lucide-react';
import { StaffCreateForm, StaffEditDialog, StaffPasswordDialog } from '../components/StaffForms';
import type { CreateStaffFormValues, ResetStaffPasswordFormValues, UpdateStaffFormValues } from '../../../../shared/schemas/staff';
import { StaffAccessEvent, StaffUser } from '../../../types';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import Drawer from '../../../components/ui/Drawer';
import Toast from '../../../components/ui/Toast';

const StaffPage = () => {
  const apiWrite = useApiMutation("features/staff/pages");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [passwordModalUser, setPasswordModalUser] = useState<StaffUser | null>(null);
  const [editModalUser, setEditModalUser] = useState<StaffUser | null>(null);
  const [accessModalUser, setAccessModalUser] = useState<StaffUser | null>(null);
  const [accessEvents, setAccessEvents] = useState<StaffAccessEvent[] | null>(null);
  const [staffStatusAction, setStaffStatusAction] = useState<StaffUser | null>(null);
  const [staffStatusReason, setStaffStatusReason] = useState('');
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const queryClient = useQueryClient();
  const staffQuery = useQuery({ queryKey: ['staff'], queryFn: ({ signal }) => apiFetchJson<StaffUser[]>('/api/staff', { signal }) });
  const staff = staffQuery.data ?? [];
  const fetchData = () => queryClient.invalidateQueries({ queryKey: ['staff'] });

  const handleCreateUser = async (data: CreateStaffFormValues) => {
    setIsActionLoading(true);

    const res = await apiWrite.request('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Usuario creado. Entrega la clave inicial por el canal operativo definido.', type: 'success' });
      setIsDrawerOpen(false);
      fetchData();
    } else {
      const body = await res.json().catch(() => ({}));
      setToast({ message: body.error || 'Error al crear usuario', type: 'error' });
    }
    setIsActionLoading(false);
  };

  const handleResetPassword = async ({ password, reason }: ResetStaffPasswordFormValues) => {
    if (!passwordModalUser) return;

    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/staff/${passwordModalUser.id}/password`, {
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

  const handleUpdateStaff = async (data: UpdateStaffFormValues) => {
    if (!editModalUser) return;

    setIsActionLoading(true);
    const res = await apiWrite.request(`/api/staff/${editModalUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setToast({ message: 'Usuario actualizado con trazabilidad', type: 'success' });
      setEditModalUser(null);
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
    const res = await apiWrite.request(`/api/staff/${user.id}/status`, {
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
        <StaffPasswordDialog user={passwordModalUser} onSubmit={handleResetPassword} onClose={() => setPasswordModalUser(null)} isSaving={isActionLoading} />
      )}

      {editModalUser && (
        <StaffEditDialog user={editModalUser} onSubmit={handleUpdateStaff} onClose={() => setEditModalUser(null)} isSaving={isActionLoading} />
      )}

      {accessModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="staff-access-title" className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h3 id="staff-access-title" className="text-lg font-bold text-slate-900">Historial de seguridad</h3>
                <p className="mt-1 text-sm text-slate-600">{accessModalUser.name} · {accessModalUser.email}</p>
              </div>
              <button onClick={() => { setAccessModalUser(null); setAccessEvents(null); }} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Cerrar
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-100">
              {!accessEvents && (
                <div className="p-6 text-sm font-semibold text-slate-600">Cargando historial...</div>
              )}
              {accessEvents?.length === 0 && (
                <div className="p-6 text-sm font-semibold text-slate-600">Sin eventos registrados todavia.</div>
              )}
              {accessEvents && accessEvents.length > 0 && (
<DataView<StaffAccessEvent> caption="Historial de seguridad" items={accessEvents} getKey={event => event.id} columns={[
{ key: 'event', label: 'Evento', primary: true, render: event => <span className="font-bold">{getEventLabel(event.event_type)}</span> },
{ key: 'date', label: 'Fecha', render: event => new Date(event.created_at).toLocaleString() },
{ key: 'ip', label: 'IP', render: event => <span className="font-mono break-all">{event.ip_address || '-'}</span> },
{ key: 'note', label: 'Nota', render: event => getEventMetadata(event) || '-' },
]} />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-end">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Personal Interno</h2>
          <p className="text-slate-600 mt-1">Gestion de usuarios y roles del sistema (RBAC).</p>
        </div>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all"
        >
          <UserPlus className="w-5 h-5" />
          Nuevo Usuario
        </button>
      </div>

      <DataView<StaffUser> loading={staffQuery.isPending} caption="Personal" items={staff} getKey={user => user.id} emptyMessage={staffQuery.error?.message || 'No hay usuarios registrados'} columns={[
        { key: 'name', label: 'Personal', primary: true, render: user => <span>{user.name}<span className="block break-all text-xs font-normal text-slate-600">{user.email}</span></span> },
        { key: 'rut', label: 'RUT', render: user => user.rut },
        { key: 'role', label: 'Rol', render: user => getRoleLabel(user.role) },
        { key: 'status', label: 'Estado', render: user => <span>{user.status === 'active' ? 'Activo' : 'Inactivo'}{user.must_change_password && <span className="block text-xs text-amber-800">Debe cambiar clave</span>}</span> },
        { key: 'last', label: 'Ultimo acceso', render: user => user.last_access ? new Date(user.last_access).toLocaleString('es-CL') : 'Nunca' },
        { key: 'actions', label: 'Acciones', fullWidthOnMobile: true, render: user => <div className="flex flex-wrap justify-end gap-1">
          <button type="button" onClick={() => setEditModalUser(user)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Editar</button>
          <button type="button" onClick={() => openAccessHistory(user)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Historial</button>
          <button type="button" onClick={() => setPasswordModalUser(user)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Clave</button>
          <button type="button" onClick={() => setStaffStatusAction(user)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-slate-100">{user.status === 'active' ? 'Desactivar' : 'Activar'}</button>
        </div> },
      ]} />

      <Drawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} title="Nuevo Usuario de Personal">
        <StaffCreateForm onSubmit={handleCreateUser} isSaving={isActionLoading} />
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
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-600">Motivo operacional</label>
              <textarea aria-label="Motivo operacional"
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
