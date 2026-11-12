import { useForm } from 'react-hook-form';
import type { UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog } from '../../../ui/Dialog';
import { FieldError, formInputClass, formLabelClass } from '../../../ui';
import {
  createStaffFormSchema,
  resetStaffPasswordFormSchema,
  updateStaffFormSchema,
  type CreateStaffFormValues,
  type ResetStaffPasswordFormValues,
  type UpdateStaffFormValues,
} from '../../../../shared/schemas/staff';
import type { StaffUser } from '../../../types';

export const roleMeta = [
  { id: 'admin', label: 'Administrador', desc: 'Acceso total a todos los modulos.' },
  { id: 'finance', label: 'Finanzas', desc: 'Acceso a Clientes, Contratos y Finanzas.' },
  { id: 'guard', label: 'Guardia / Conserje', desc: 'Acceso a Control de Espacios y Monitor.' },
  { id: 'cashier', label: 'Caja', desc: 'Crea tickets, cobra visitas y cierra caja.' },
] as const;

function TextInput({ form, prefix, name, label, type = 'text', autoComplete }: {
  form: UseFormReturn<any, any, any>; prefix: string; name: string; label: string; type?: string; autoComplete?: string;
}) {
  const error = form.formState.errors[name] as { message?: string } | undefined;
  const id = `staff-${prefix}-${name}`;
  return (
    <div>
      <label htmlFor={id} className={formLabelClass}>{label}</label>
      <input id={id} type={type} autoComplete={autoComplete} aria-invalid={error ? true : undefined} {...form.register(name)} className={formInputClass} />
      <FieldError error={error} />
    </div>
  );
}

function RolePicker({ form, compact }: { form: UseFormReturn<any, any, any>; compact?: boolean }) {
  const error = form.formState.errors.role as { message?: string } | undefined;
  return (
    <fieldset>
      <legend className={formLabelClass}>Nivel de Acceso (Rol)</legend>
      <div className={compact ? 'grid gap-3 md:grid-cols-2' : 'grid grid-cols-1 gap-3'}>
        {roleMeta.map(role => (
          <label key={role.id} className="relative flex items-center p-4 border border-slate-200 rounded-2xl cursor-pointer hover:bg-slate-50 transition-all has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-slate-900">
            <input type="radio" value={role.id} {...form.register('role')} className="sr-only peer" />
            <div>
              <p className="text-sm font-bold">{role.label}</p>
              <p className="text-xs text-slate-600">{role.desc}</p>
            </div>
            <div className="ml-auto w-4 h-4 shrink-0 border-2 border-slate-200 rounded-full peer-checked:border-slate-900 peer-checked:border-[5px] transition-all" aria-hidden="true" />
          </label>
        ))}
      </div>
      <FieldError error={error} />
    </fieldset>
  );
}

export function StaffCreateForm({ onSubmit, isSaving }: { onSubmit: (values: CreateStaffFormValues) => Promise<unknown>; isSaving: boolean }) {
  const form = useForm({
    resolver: zodResolver(createStaffFormSchema),
    defaultValues: { name: '', rut: '', phone: '', email: '', password: '', role: undefined },
  });
  return (
    <form noValidate aria-label="Nuevo usuario" onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <TextInput form={form} prefix="create" name="name" label="Nombre Completo" autoComplete="name" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextInput form={form} prefix="create" name="rut" label="RUT" />
          <TextInput form={form} prefix="create" name="phone" label="Telefono" type="tel" autoComplete="tel" />
        </div>
        <TextInput form={form} prefix="create" name="email" label="Correo Electronico (Usuario)" type="email" autoComplete="email" />
        <TextInput form={form} prefix="create" name="password" label="Clave Inicial" type="password" autoComplete="new-password" />
        <RolePicker form={form} />
      </div>
      <button type="submit" disabled={isSaving} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all disabled:opacity-50">
        Crear usuario
      </button>
    </form>
  );
}

export function StaffEditDialog({ user, onSubmit, onClose, isSaving }: {
  user: StaffUser; onSubmit: (values: UpdateStaffFormValues) => Promise<unknown>; onClose: () => void; isSaving: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(updateStaffFormSchema),
    defaultValues: { name: user.name, rut: user.rut, email: user.email, phone: user.phone || '', role: user.role, reason: '' },
  });
  const reasonError = form.formState.errors.reason;
  return (
    <Dialog open onClose={onClose} dismissible={!isSaving} title="Editar usuario">
      <form noValidate aria-label="Editar usuario" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-slate-600">Todo cambio queda registrado con motivo y fecha.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput form={form} prefix="edit" name="name" label="Nombre completo" />
          <TextInput form={form} prefix="edit" name="rut" label="RUT" />
          <TextInput form={form} prefix="edit" name="email" label="Correo" type="email" />
          <TextInput form={form} prefix="edit" name="phone" label="Telefono" type="tel" />
          <div className="md:col-span-2"><RolePicker form={form} compact /></div>
          <div className="md:col-span-2">
            <label htmlFor="staff-edit-reason" className={formLabelClass}>Motivo del cambio</label>
            <textarea
              id="staff-edit-reason"
              rows={3}
              aria-invalid={reasonError ? true : undefined}
              {...form.register('reason')}
              className={formInputClass}
              placeholder="Ej: actualizacion de contacto, cambio de funciones, correccion administrativa..."
            />
            <FieldError error={reasonError} />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={isSaving} className="min-h-11 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            Guardar cambios
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function StaffPasswordDialog({ user, onSubmit, onClose, isSaving }: {
  user: StaffUser; onSubmit: (values: ResetStaffPasswordFormValues) => Promise<unknown>; onClose: () => void; isSaving: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(resetStaffPasswordFormSchema),
    defaultValues: { password: '', password_confirm: '', reason: '' },
  });
  const reasonError = form.formState.errors.reason;
  return (
    <Dialog open onClose={onClose} dismissible={!isSaving} title="Restablecer clave">
      <form noValidate aria-label="Restablecer clave" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-slate-600">{user.name} debera ingresar con la nueva clave y cambiarla antes de operar.</p>
        <TextInput form={form} prefix="password" name="password" label="Nueva clave" type="password" autoComplete="new-password" />
        <TextInput form={form} prefix="password" name="password_confirm" label="Confirmar clave" type="password" autoComplete="new-password" />
        <div>
          <label htmlFor="staff-password-reason" className={formLabelClass}>Motivo operacional</label>
          <textarea
            id="staff-password-reason"
            rows={3}
            aria-invalid={reasonError ? true : undefined}
            {...form.register('reason')}
            placeholder="Ej: olvido de clave validado por administracion..."
            className={formInputClass}
          />
          <FieldError error={reasonError} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button type="submit" disabled={isSaving} className="min-h-11 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            Guardar clave
          </button>
        </div>
      </form>
    </Dialog>
  );
}
