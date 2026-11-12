import { invalidatedDomains } from '../../../lib/useApiMutation';
import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generalSettingsSchema, type GeneralSettingsValues } from '../../../../shared/schemas/settings';
import type { SystemConfig } from '../../../types';
import { apiFetchJson } from '../../../lib/api';
import { Button, Field, Input, RutInput } from '../../../ui';

export function GeneralSettingsForm({ config, onSaved }: { config: SystemConfig; onSaved: () => void }) {
  const id = useId();
  const client = useQueryClient();
  const form = useForm<GeneralSettingsValues>({ resolver: zodResolver(generalSettingsSchema) });
  useEffect(() => { form.reset({ grace_days: config.grace_days, late_interest: config.late_interest,
    overdue_recovery_rate: config.overdue_recovery_rate ?? 60, company_name: config.company_name || '',
    company_rut: config.company_rut || '', company_address: config.company_address || '',
  }); }, [config, form.reset]);
  const mutation = useMutation({ meta: { invalidates: invalidatedDomains('/api/config') }, mutationFn: (values: GeneralSettingsValues) => apiFetchJson('/api/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
  }), onSuccess: async () => { onSaved(); } });
  return <form aria-label="Datos generales de la empresa" onSubmit={form.handleSubmit(async values => { try { await mutation.mutateAsync(values); } catch {} })} className="max-w-4xl space-y-5">
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="Días de gracia antes de mora" htmlFor={`${id}-grace`} error={form.formState.errors.grace_days?.message}><Input id={`${id}-grace`} type="number" min="0" {...form.register('grace_days', { valueAsNumber: true })} /></Field>
      <Field label="Interés por mora (%)" htmlFor={`${id}-interest`} error={form.formState.errors.late_interest?.message}><Input id={`${id}-interest`} type="number" min="0" step="0.1" {...form.register('late_interest', { valueAsNumber: true })} /></Field>
      <Field label="Recuperación estimada de mora (%)" htmlFor={`${id}-recovery`} error={form.formState.errors.overdue_recovery_rate?.message}><Input id={`${id}-recovery`} type="number" min="0" max="100" {...form.register('overdue_recovery_rate', { valueAsNumber: true })} /></Field>
      <Field label="Razón social" htmlFor={`${id}-name`}><Input id={`${id}-name`} {...form.register('company_name')} /></Field>
      <Field label="RUT empresa" htmlFor={`${id}-rut`}><RutInput id={`${id}-rut`} {...form.register('company_rut')} /></Field>
      <Field label="Dirección comercial" htmlFor={`${id}-address`}><Input id={`${id}-address`} {...form.register('company_address')} /></Field>
    </div>
    {mutation.error && <p role="alert" className="text-sm text-red-800">{mutation.error.message}</p>}
    <Button type="submit" loading={mutation.isPending}>Guardar cambios de la empresa</Button>
  </form>;
}
