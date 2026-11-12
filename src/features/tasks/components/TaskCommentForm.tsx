import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FieldError } from '../../../ui';
import { taskCommentFieldsSchema, type TaskCommentValues } from '../../../../shared/schemas/tasks';

/** Avance de una tarea con adjunto opcional. */
export function TaskCommentForm({ taskId, isSaving, onSubmit }: {
  taskId: number;
  isSaving: boolean;
  onSubmit: (values: TaskCommentValues, file: File | null) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const form = useForm({ resolver: zodResolver(taskCommentFieldsSchema), defaultValues: { note: '' } });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      aria-label="Agregar seguimiento"
      onSubmit={form.handleSubmit(async values => {
        if (await onSubmit(values, file)) {
          form.reset();
          setFile(null);
        }
      })}
      className="space-y-2"
    >
      <div>
        <textarea
          aria-label="Agregar avance, llamada, evidencia o decisión..."
          aria-invalid={errors.note ? true : undefined}
          {...form.register('note')}
          placeholder="Agregar avance, llamada, evidencia o decisión..."
          rows={2}
          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-base md:text-xs outline-none focus:border-slate-900 resize-none aria-[invalid=true]:border-red-500"
        />
        <FieldError error={errors.note} />
      </div>
      <label className="flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 focus-within:border-slate-900">
        <span className="truncate">{file?.name || 'Adjuntar PDF, JPG o PNG opcional'}</span>
        <span className="font-bold text-slate-700">Examinar</span>
        <input
          type="file"
          aria-label={`Adjunto del seguimiento de la tarea ${taskId}`}
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>
      <button type="submit" disabled={isSaving} className="w-full min-h-11 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40">
        Agregar seguimiento
      </button>
    </form>
  );
}
