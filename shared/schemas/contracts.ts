import { z } from 'zod';

export const contractTermsSchema = z.object({
  client_id: z.number().int().positive('Selecciona un cliente'),
  space_id: z.number().int().positive('Selecciona una plaza'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona la fecha de inicio'),
  monthly_fee: z.number().positive('La tarifa debe ser mayor a cero'),
  billing_day: z.number().int().min(1).max(31), deposit_amount: z.number().min(0),
  billing_document_type: z.enum(['boleta', 'factura_exenta', 'factura_afecta']),
});
export const contractFormSchema = contractTermsSchema.extend({
  end_date: z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Fecha inválida'), notes: z.string(),
}).refine(value => !value.end_date || value.end_date >= value.start_date, { path: ['end_date'], message: 'El término debe ser igual o posterior al inicio' });
export type ContractFormValues = z.infer<typeof contractFormSchema>;

const billingDocumentTypes = ['boleta', 'factura_exenta', 'factura_afecta'] as const;
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida');

/** Cambio de términos de un contrato vigente: siempre con motivo. */
export const updateContractSchema = z.object({
  start_date: isoDate.optional(),
  end_date: z.preprocess(value => (value === '' ? null : value), isoDate.nullable().optional()),
  monthly_fee: z.coerce.number().positive('La tarifa debe ser mayor a cero').optional(),
  billing_day: z.coerce.number().int('Usa un día entero').min(1, 'El día va de 1 a 31').max(31, 'El día va de 1 a 31').optional(),
  deposit_amount: z.coerce.number().min(0, 'La garantía no puede ser negativa').optional(),
  billing_document_type: z.enum(billingDocumentTypes).optional(),
  notes: z.preprocess(value => (value === '' ? null : value), z.string().trim().nullable().optional()),
  reason: z.string().trim().min(3, 'Explica el motivo con al menos 3 caracteres').max(500),
});
export type UpdateContractValues = z.output<typeof updateContractSchema>;

/** En el formulario inicio, tarifa y día de cobro son obligatorios y el término no puede ser anterior al inicio. */
export const updateContractFormSchema = updateContractSchema.extend({
  start_date: isoDate,
  monthly_fee: z.coerce.number({ error: 'Ingresa la tarifa' }).positive('La tarifa debe ser mayor a cero'),
  billing_day: z.coerce.number({ error: 'Ingresa el día de cobro' }).int('Usa un día entero').min(1, 'El día va de 1 a 31').max(31, 'El día va de 1 a 31'),
}).refine(value => !value.end_date || value.end_date >= value.start_date, {
  path: ['end_date'],
  message: 'El término debe ser igual o posterior al inicio',
});
