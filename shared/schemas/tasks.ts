import { z } from 'zod';

export const taskFieldsSchema = z.object({
  title: z.string().trim().min(3, 'Escribe al menos 3 caracteres').max(180),
  category: z.enum(['finance', 'access', 'documents', 'contracts', 'maintenance', 'general']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
});
export const taskFormSchema = taskFieldsSchema.extend({
  description: z.string(), assigned_staff_id: z.string(), branch_id: z.string(),
  due_date: z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Fecha inválida'),
});
export type TaskFormValues = z.infer<typeof taskFormSchema>;

/** Avance o comentario de seguimiento; el adjunto se agrega aparte. */
export const taskCommentFieldsSchema = z.object({
  note: z.string().trim().min(1, 'Escribe el avance').max(1000, 'El comentario admite hasta 1000 caracteres'),
});
export type TaskCommentValues = z.output<typeof taskCommentFieldsSchema>;
