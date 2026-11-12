import { Save, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError } from '../../../ui';
import { taskFormSchema, type TaskFormValues } from '../../../../shared/schemas/tasks';
import type { Branch, OperationalTask } from '../../../types';
import { canAssigneeHandleCategory, priorityLabels, type Assignee } from '../taskShared';

const inputClass = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-base md:text-sm outline-none focus:border-slate-900 aria-[invalid=true]:border-red-500';
const selectClass = 'bg-white border border-slate-200 rounded-xl px-3 py-2 text-base md:text-xs outline-none focus:border-slate-900';

/** Edición en línea de una tarea, con la misma regla que el alta. */
export function TaskEditForm({ task, assignees, branches, categories, isSaving, onSave, onCancel }: {
  task: OperationalTask;
  assignees: Assignee[];
  branches: Branch[];
  categories: [string, string][];
  isSaving: boolean;
  onSave: (values: TaskFormValues) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task.title,
      description: task.description || '',
      category: task.category,
      priority: task.priority,
      assigned_staff_id: task.assigned_staff_id ? String(task.assigned_staff_id) : '',
      branch_id: task.branch_id ? String(task.branch_id) : '',
      due_date: task.due_date || '',
    },
  });
  const { errors } = form.formState;
  const category = form.watch('category');
  const eligibleAssignees = assignees.filter(assignee => canAssigneeHandleCategory(assignee, category));
  const categoryField = form.register('category');
  return (
    <form noValidate aria-label={`Editar tarea ${task.title}`} onSubmit={form.handleSubmit(onSave)} className="flex-1 space-y-3">
      <div>
        <input aria-label="Título de la tarea" aria-invalid={errors.title ? true : undefined} {...form.register('title')} className={`${inputClass} font-bold`} />
        <FieldError error={errors.title} />
      </div>
      <textarea aria-label="Descripción de la tarea" {...form.register('description')} rows={3} className={`${inputClass} resize-none`} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <select
          aria-label="Categoria de la tarea"
          {...categoryField}
          onChange={event => {
            categoryField.onChange(event);
            // Si el responsable actual no puede atender la nueva categoría, queda sin asignar.
            const nextCategory = event.target.value as OperationalTask['category'];
            const current = assignees.find(assignee => String(assignee.id) === form.getValues('assigned_staff_id'));
            if (current && !canAssigneeHandleCategory(current, nextCategory)) form.setValue('assigned_staff_id', '');
          }}
          className={selectClass}
        >
          {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Prioridad de la tarea" {...form.register('priority')} className={selectClass}>
          {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select aria-label="Responsable de la tarea" {...form.register('assigned_staff_id')} className={selectClass}>
          <option value="">Sin asignar</option>
          {eligibleAssignees.map(assignee => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
        </select>
        <select aria-label="Sucursal de la tarea" {...form.register('branch_id')} className={selectClass}>
          <option value="">Sin sucursal</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <div>
          <input aria-label="Vencimiento de la tarea" type="date" aria-invalid={errors.due_date ? true : undefined} {...form.register('due_date')} className={`${selectClass} w-full`} />
          <FieldError error={errors.due_date} />
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="submit" disabled={isSaving} className="min-h-11 text-xs font-bold text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg disabled:opacity-40 inline-flex items-center gap-1">
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          Guardar
        </button>
        <button type="button" onClick={onCancel} disabled={isSaving} className="min-h-11 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          Cancelar
        </button>
      </div>
    </form>
  );
}
