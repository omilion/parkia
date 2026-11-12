import { invalidatedDomains } from '../../../lib/useApiMutation';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskFormSchema, type TaskFormValues } from '../../../../shared/schemas/tasks';
import type { Branch, OperationalTask, StaffUser } from '../../../types';
import { apiFetchJson } from '../../../lib/api';
import { Button, Field, Input, Select, Textarea } from '../../../ui';

type Assignee = Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>;
export function TaskCreateForm({ branches, assignees, categories, priorities, canAssign, onCreated, branchId }: {
  branches: Branch[]; assignees: Assignee[]; categories: [string, string][]; priorities: Record<string, string>;
  canAssign: (assignee: Assignee, category: OperationalTask['category']) => boolean; onCreated: () => void; branchId: string;
}) {
  const prefix = useId();
  const client = useQueryClient();
  const form = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: {
    title: '', description: '', category: 'general', priority: 'medium', assigned_staff_id: '', branch_id: branchId === 'all' ? '' : branchId, due_date: '',
  } });
  const category = form.watch('category');
  const mutation = useMutation({ meta: { invalidates: invalidatedDomains('/api/tasks') }, mutationFn: (values: TaskFormValues) => apiFetchJson('/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values,
      assigned_staff_id: values.assigned_staff_id ? Number(values.assigned_staff_id) : null,
      branch_id: values.branch_id ? Number(values.branch_id) : null, due_date: values.due_date || null,
    }),
  }), onSuccess: async () => { form.reset(); onCreated(); } });
  const submit = form.handleSubmit(async values => { try { await mutation.mutateAsync(values); } catch { /* El error se presenta junto al formulario. */ } });
  return <form onSubmit={submit} className="glass-card h-fit space-y-4 p-5" aria-label="Nueva tarea">
    <h3 className="font-bold">Nueva tarea</h3>
    <Field label="Título" htmlFor={`${prefix}-title`} error={form.formState.errors.title?.message}><Input id={`${prefix}-title`} {...form.register('title')} invalid={Boolean(form.formState.errors.title)} /></Field>
    <Field label="Detalle" htmlFor={`${prefix}-description`}><Textarea id={`${prefix}-description`} {...form.register('description')} /></Field>
    <Field label="Categoría" htmlFor={`${prefix}-category`}><Select id={`${prefix}-category`} {...form.register('category', { onChange: () => form.setValue('assigned_staff_id', '') })}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <Field label="Prioridad" htmlFor={`${prefix}-priority`}><Select id={`${prefix}-priority`} {...form.register('priority')}>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <Field label="Responsable" htmlFor={`${prefix}-assignee`}><Select id={`${prefix}-assignee`} {...form.register('assigned_staff_id')}><option value="">Sin asignar</option>{assignees.filter(person => canAssign(person, category)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></Field>
    <Field label="Sucursal" htmlFor={`${prefix}-branch`}><Select id={`${prefix}-branch`} {...form.register('branch_id')}><option value="">Sin sucursal</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field>
    <Field label="Vencimiento" htmlFor={`${prefix}-due`} error={form.formState.errors.due_date?.message}><Input id={`${prefix}-due`} type="date" {...form.register('due_date')} /></Field>
    {mutation.error && <p role="alert" className="text-sm text-red-800">{mutation.error.message}</p>}
    <Button type="submit" fullWidth loading={mutation.isPending}>Crear tarea</Button>
  </form>;
}
