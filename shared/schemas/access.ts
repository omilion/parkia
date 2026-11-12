import { z } from 'zod';
import { dateString, optionalText, requiredNumber, requiredText } from './common';

/** Reglas de Accesos (pases, autorizaciones, tarifas y bitácora) compartidas por formularios y API. */

const emptyToNull = (value: unknown) => (value === '' || value === null || value === undefined ? null : value);
export const optionalPositiveId = z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional());

const dateTimeLocal = (message: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, message);

export const visitorPassTypes = ['provider', 'family', 'maintenance', 'other'] as const;
export const visitorPassSchema = z.object({
  name: requiredText(1, 160, 'El nombre'),
  rut: requiredText(1, 20, 'El RUT'),
  type: z.enum(visitorPassTypes),
  reason: optionalText,
  plate: optionalText,
  phone: optionalText,
  company: optionalText,
  authorized_by: requiredText(1, 120, 'Quién autoriza'),
  associated_space_id: z.coerce.number().int().positive().nullable().optional(),
  branch_id: z.coerce.number().int().positive().optional(),
  valid_from: dateTimeLocal('Indica desde cuándo es válido'),
  valid_to: dateTimeLocal('Indica hasta cuándo es válido'),
});
/** El formulario además exige que el término sea posterior al inicio. */
export const visitorPassFormSchema = visitorPassSchema.omit({ branch_id: true, associated_space_id: true }).refine(
  value => !value.valid_from || !value.valid_to || value.valid_to > value.valid_from,
  { path: ['valid_to'], message: 'El término debe ser posterior al inicio' },
);
export type VisitorPassFormValues = z.output<typeof visitorPassFormSchema>;

export const accessOverrideSchema = z.object({
  space_id: z.coerce.number().int().positive(),
  client_id: z.coerce.number().int().positive().nullable().optional(),
  denied_access_log_id: optionalPositiveId,
  access_type: z.enum(['entry', 'exit']).optional(),
  reason: optionalText,
  authorized_by: optionalText,
});
/** En pantalla el guardia elige el acceso y siempre explica el motivo. */
export const accessOverrideFormSchema = z.object({
  space_id: z.coerce.number({ error: 'Selecciona el acceso' }).int().positive('Selecciona el acceso'),
  access_type: z.enum(['entry', 'exit']).optional(),
  reason: requiredText(3, 500, 'El motivo'),
});
export type AccessOverrideFormValues = z.output<typeof accessOverrideFormSchema>;

export const updateAccessRateSchema = z.object({
  rate_per_minute: requiredNumber('Ingresa la tarifa', { min: 0, minMessage: 'La tarifa no puede ser negativa' }),
  grace_period_mins: requiredNumber('Ingresa los minutos de gracia', { min: 0, minMessage: 'Los minutos no pueden ser negativos', int: 'Usa minutos enteros' }),
});
export type UpdateAccessRateValues = z.output<typeof updateAccessRateSchema>;

export const shiftNames = ['morning', 'afternoon', 'night', 'custom'] as const;
export const shiftEntryCategories = ['access', 'visitor', 'incident', 'maintenance', 'payment', 'handover', 'other'] as const;
export const shiftPriorities = ['low', 'medium', 'high', 'critical'] as const;

export const createShiftLogSchema = z.object({
  shift_date: dateString.optional(),
  shift_name: z.enum(shiftNames).default('custom'),
  opening_notes: optionalText,
  branch_id: z.coerce.number().int().positive().optional().nullable(),
});
export const openShiftFormSchema = createShiftLogSchema.omit({ branch_id: true }).extend({ shift_date: dateString });
export type OpenShiftFormValues = z.output<typeof openShiftFormSchema>;

export const shiftAttachmentSchema = z.object({
  label: optionalText,
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  dataBase64: z.string().trim().min(1),
});

export const shiftEntryFieldsSchema = z.object({
  category: z.enum(shiftEntryCategories),
  priority: z.enum(shiftPriorities).default('medium'),
  title: requiredText(3, 180, 'El título'),
  detail: optionalText,
  related_space_id: optionalPositiveId,
  related_access_log_id: optionalPositiveId,
  follow_up_required: z.coerce.boolean().default(false),
});
export type ShiftEntryFieldsValues = z.output<typeof shiftEntryFieldsSchema>;
export const createShiftLogEntrySchema = shiftEntryFieldsSchema.extend({
  attachment: shiftAttachmentSchema.optional(),
});

const optionalCount = z.preprocess(
  value => (value === '' || value === null ? undefined : value),
  z.coerce.number().nonnegative('El monto no puede ser negativo').optional(),
);

export const handoverItemSchema = z.object({
  title: requiredText(3, 180, 'El pendiente'),
  detail: optionalText,
  category: z.enum(shiftEntryCategories).default('handover'),
  priority: z.enum(shiftPriorities).default('medium'),
  related_space_id: optionalPositiveId,
  related_access_log_id: optionalPositiveId,
});

export const closeShiftLogSchema = z.object({
  handover_notes: requiredText(3, 4000, 'El resumen de traspaso'),
  cash_count_note: optionalText,
  counted_cash: optionalCount,
  counted_transfer: optionalCount,
  counted_card: optionalCount,
  handover_items: z.array(handoverItemSchema).max(10).default([]),
});
export type CloseShiftValues = z.output<typeof closeShiftLogSchema>;

/**
 * Formulario de cierre: tres filas de pendientes que pueden quedar vacías y
 * cuatro verificaciones que el guardia debe marcar antes de cerrar.
 */
export const closeShiftFormSchema = closeShiftLogSchema.extend({
  handover_items: z.array(z.object({
    title: z.string().trim(),
    detail: z.string(),
    category: z.enum(shiftEntryCategories),
    priority: z.enum(shiftPriorities),
    related_space_id: z.string(),
  })).transform((rows, ctx) => {
    // Solo las filas con título se envían; una fila vacía se ignora.
    let valid = true;
    rows.forEach((row, index) => {
      if (row.title && row.title.length < 3) {
        valid = false;
        ctx.addIssue({ code: 'custom', path: [index, 'title'], message: 'El pendiente debe tener al menos 3 caracteres' });
      }
    });
    if (!valid) return z.NEVER;
    return rows.filter(row => row.title).map(row => handoverItemSchema.parse(row));
  }),
  checklist: z.array(z.boolean()).refine(values => values.every(Boolean), 'Confirma las cuatro verificaciones antes de cerrar'),
});

/** Lectura de patente en un tótem (cámara LPR o simulador). */
export const totemScanSchema = z.object({
  totem_id: z.coerce.number().int().positive().optional(),
  plate: z.string().trim().min(1, 'Ingresa la patente'),
});
export const totemScanFormSchema = totemScanSchema.extend({
  totem_id: z.coerce.number({ error: 'Selecciona un tótem' }).int().positive('Selecciona un tótem'),
});
export type TotemScanFormValues = z.output<typeof totemScanFormSchema>;
