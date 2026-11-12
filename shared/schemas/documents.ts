import { z } from 'zod';
import { dateString, optionalText, requiredText } from './common';

/** Reglas de documentos compartidas por formularios y API. */

export const documentTypes = ['contract', 'identity', 'mandate', 'receipt', 'other'] as const;
export const documentStatuses = ['pending', 'received', 'approved', 'rejected', 'expired'] as const;
export const documentTypeSchema = z.enum(documentTypes);
export const documentStatusSchema = z.enum(documentStatuses);

/** Fecha que puede quedar vacía: "" y null pasan a null. */
export const nullableDateSchema = z.union([dateString, z.literal('')]).nullable().optional()
  .transform(value => value || null);

export const documentFileSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  dataBase64: z.string().trim().min(1),
});

/** Campos que escribe el usuario al subir un documento; el archivo se adjunta aparte. */
export const documentFieldsSchema = z.object({
  label: requiredText(1, 120, 'El nombre del documento'),
  document_type: documentTypeSchema.default('other'),
  status: documentStatusSchema.default('received'),
  expires_at: nullableDateSchema,
  notes: optionalText,
});
export type DocumentFieldsValues = z.output<typeof documentFieldsSchema>;

export const uploadDocumentSchema = documentFieldsSchema.extend({
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  next_action_at: nullableDateSchema,
}).extend(documentFileSchema.shape);

/** Archivo permitido para documentos: PDF, JPG o PNG de hasta 5 MB. */
export function documentFileError(file: File | null | undefined): string | null {
  if (!file || file.size === 0) return 'Selecciona un archivo.';
  if (file.size > 5 * 1024 * 1024) return 'El archivo no puede superar 5 MB.';
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return 'Usa un archivo PDF, JPG o PNG.';
  return null;
}
