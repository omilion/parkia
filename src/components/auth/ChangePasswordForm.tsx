import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useApiMutation } from '../../lib/useApiMutation';
import { FieldError } from '../../ui';
import { changePasswordFormSchema } from '../../../shared/schemas/auth';
import { cn } from '../../lib/utils';

const labelClass = 'text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 block';
const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base md:text-sm focus:border-indigo-600 outline-none aria-[invalid=true]:border-red-500';

/**
 * Cambio de la clave propia. Lo usan el bloqueo de primer ingreso y el menú de usuario.
 * `onChanged` se llama después de que la API confirma el cambio.
 */
export function ChangePasswordForm({ onChanged, submitLabel = 'Actualizar clave' }: { onChanged?: () => void; submitLabel?: string }) {
  const apiWrite = useApiMutation('components/auth/ChangePasswordForm');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const form = useForm({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });
  const { errors, isSubmitting } = form.formState;
  return (
    <form
      noValidate
      aria-label="Cambiar clave"
      onSubmit={form.handleSubmit(async ({ current_password, new_password }) => {
        setMessage(null);
        const res = await apiWrite.request('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ current_password, new_password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ type: 'error', text: data.error || 'No se pudo cambiar la clave.' });
          return;
        }
        setMessage({ type: 'success', text: 'Clave actualizada.' });
        form.reset();
        onChanged?.();
      })}
      className="space-y-4"
    >
      <div>
        <label htmlFor="current-password" className={labelClass}>Clave actual</label>
        <input id="current-password" type="password" autoComplete="current-password" aria-invalid={errors.current_password ? true : undefined} {...form.register('current_password')} className={inputClass} />
        <FieldError error={errors.current_password} />
      </div>
      <div>
        <label htmlFor="new-password" className={labelClass}>Nueva clave</label>
        <input id="new-password" type="password" autoComplete="new-password" aria-invalid={errors.new_password ? true : undefined} {...form.register('new_password')} className={inputClass} />
        <FieldError error={errors.new_password} />
      </div>
      <div>
        <label htmlFor="confirm-password" className={labelClass}>Confirmar nueva clave</label>
        <input id="confirm-password" type="password" autoComplete="new-password" aria-invalid={errors.confirm_password ? true : undefined} {...form.register('confirm_password')} className={inputClass} />
        <FieldError error={errors.confirm_password} />
      </div>

      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} className={cn(
          'rounded-xl px-4 py-3 text-sm font-semibold',
          message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
        )}>
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full min-h-11 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
      >
        {isSubmitting ? 'Guardando...' : submitLabel}
      </button>
    </form>
  );
}
