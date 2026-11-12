import { z } from 'zod';
import { dateString, optionalText } from './common';

/** Reglas de tarifas y convenios compartidas por el editor de Configuración y la API. */

export const vehicleTypes = ['car', 'moto', 'truck'] as const;
export const vehicleTypeLabels: Record<string, string> = { car: 'Auto', moto: 'Moto', truck: 'Camioneta' };
export const planVehicleTypes = ['all', ...vehicleTypes] as const;
export const pricingModes = ['per_minute', 'elapsed_blocks'] as const;

const timeOfDay = z.string().trim().regex(/^([01]?\d|2[0-4]):[0-5]\d$/, 'Usa el formato HH:MM');
const nullableInt = (min = 0) => z.preprocess(
  value => (value === '' || value === undefined ? null : value),
  z.coerce.number().int('Usa un número entero').min(min, `Debe ser ${min} o más`).nullable(),
);

export const rateRuleSchema = z.object({
  weekdays: z.preprocess(
    value => (Array.isArray(value) && value.length === 0 ? null : value),
    z.array(z.coerce.number().int().min(1).max(7)).nullable(),
  ),
  from: timeOfDay,
  to: timeOfDay,
  priority: z.coerce.number().int().min(0).default(0),
  price_per_minute: nullableInt(),
  first_block_price: nullableInt(),
  block_price: nullableInt(),
});
export type RateRuleValues = z.output<typeof rateRuleSchema>;

export const ratePlanSchema = z.object({
  name: z.string().trim().min(2, 'Escribe un nombre de al menos 2 caracteres').max(80),
  branch_id: nullableInt(1),
  vehicle_type: z.enum(planVehicleTypes).default('all'),
  mode: z.enum(pricingModes),
  grace_mins: z.coerce.number({ error: 'Ingresa los minutos de gracia' }).int().min(0, 'Debe ser 0 o más').max(240),
  daily_cap: nullableInt(1),
  first_block_minutes: nullableInt(1),
  block_minutes: nullableInt(1),
  valid_from: z.preprocess(value => (value === '' ? null : value), dateString.nullable().optional()),
  valid_to: z.preprocess(value => (value === '' ? null : value), dateString.nullable().optional()),
  change_note: optionalText,
  rules: z.array(rateRuleSchema).min(1, 'Agrega al menos una regla de precio').max(24),
});
export type RatePlanValues = z.output<typeof ratePlanSchema>;

export const quoteSimulationSchema = z.object({
  entry_at: z.string().trim().min(1, 'Indica la entrada'),
  exit_at: z.string().trim().min(1, 'Indica la salida'),
  extra_free_mins: z.coerce.number().int().min(0).default(0),
});

export const agreementKinds = ['free_minutes', 'percent', 'fixed'] as const;
export const agreementKindLabels: Record<string, string> = {
  free_minutes: 'Minutos gratis', percent: 'Porcentaje de descuento', fixed: 'Monto fijo de descuento',
};
export const agreementSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre del comercio').max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, 'El código lleva entre 3 y 20 letras, números o guiones'),
  kind: z.enum(agreementKinds),
  value: z.coerce.number({ error: 'Ingresa el valor del convenio' }).int('Usa un número entero').min(1, 'Debe ser mayor que 0'),
  cap_amount: nullableInt(1),
  branch_id: nullableInt(1),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: optionalText,
}).superRefine((value, ctx) => {
  if (value.kind === 'percent' && value.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'El porcentaje no puede superar 100' });
  if (value.kind === 'free_minutes' && value.value > 600) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Máximo 600 minutos gratis' });
});
export type AgreementValues = z.output<typeof agreementSchema>;

/** Validación de un ticket por parte del comercio (pantalla pública simple). */
export const merchantValidationSchema = z.object({
  code: z.string().trim().toUpperCase().min(3, 'Ingresa el código del convenio'),
  plate: z.string().trim().min(2, 'Ingresa la patente').max(12),
});

export const lostTicketSchema = z.object({
  note: z.string().trim().min(5, 'Explica brevemente cómo se verificó al dueño (al menos 5 caracteres)').max(500),
  evidence: z.object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    dataBase64: z.string().trim().min(1),
  }).optional(),
});
export type LostTicketValues = z.output<typeof lostTicketSchema>;
