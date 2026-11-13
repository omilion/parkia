import { z } from 'zod';
import { optionalText, requiredNumber, requiredText } from './common';

/** Reglas de Plazas, visitas y caja compartidas por formularios y API. */

const emptyToNull = (value: unknown) => (value === '' ? null : value);

const optionalMeters = z.preprocess(emptyToNull, z.coerce.number().nonnegative('La medida no puede ser negativa').nullable().optional());
/** Monto obligatorio que puede ser cero. */
const requiredNonNegativeAmount = requiredNumber('Ingresa un monto', { min: 0, minMessage: 'El monto no puede ser negativo' });
/** Monto que, si queda vacío, vale 0. */
const amountOrZero = z.preprocess(
  value => (value === '' || value == null ? 0 : value),
  requiredNumber('Ingresa un monto', { min: 0, minMessage: 'El monto no puede ser negativo' }),
) as unknown as z.ZodCoercedNumber<unknown>;

export const spaceStatuses = ['available', 'occupied', 'maintenance'] as const;

export const createSpaceSchema = z.object({
  name: requiredText(1, 200, 'El identificador'),
  type: z.literal('parking'),
  status: z.enum(spaceStatuses).default('available'),
  price: requiredNonNegativeAmount,
  location: optionalText,
  level: optionalText,
  width_m: optionalMeters,
  length_m: optionalMeters,
  height_m: optionalMeters,
  features: optionalText,
  notes: optionalText,
  branch_id: z.coerce.number().int().positive('Selecciona una sucursal').optional(),
});
export type CreateSpaceValues = z.output<typeof createSpaceSchema>;

/** En el formulario la sucursal es obligatoria. */
export const createSpaceFormSchema = createSpaceSchema.extend({
  branch_id: z.coerce.number({ error: 'Selecciona una sucursal' }).int().positive('Selecciona una sucursal'),
});

export const updateSpaceSchema = createSpaceSchema.omit({ status: true }).partial().extend({
  reason: requiredText(3, 500, 'El motivo'),
});

export const importSpacesSchema = z.object({
  csv: z.string().trim().min(1, 'Ingresa o adjunta el archivo CSV de plazas'),
  branch_id: z.coerce.number().int().positive().optional(),
});
export type ImportSpacesValues = z.output<typeof importSpacesSchema>;
export type UpdateSpaceValues = z.output<typeof updateSpaceSchema>;

export const updateSpaceFormSchema = updateSpaceSchema.extend({
  name: createSpaceSchema.shape.name,
  price: createSpaceSchema.shape.price,
  branch_id: createSpaceFormSchema.shape.branch_id,
});

/** Campos del mapa aéreo que escribe el usuario; la imagen se procesa aparte. */
export const spaceMapFieldsSchema = z.object({
  branch_id: z.coerce.number({ error: 'Selecciona una sucursal' }).int().positive('Selecciona una sucursal'),
  name: requiredText(1, 120, 'El nombre del mapa'),
  is_default: z.boolean().default(false),
});
export type SpaceMapFieldsValues = z.output<typeof spaceMapFieldsSchema>;

export const visitorPaymentMethods = ['cash', 'transfer', 'card', 'automatic', 'efectivo', 'transferencia', 'tarjeta'] as const;
export const payVisitorSchema = z.object({
  method: z.enum(visitorPaymentMethods),
  amount: requiredNonNegativeAmount,
  quote_id: z.coerce.number().int().positive().optional(),
  override_reason: optionalText,
});
/** Lo que escribe el cajero; la cotización la agrega la pantalla. */
export const payVisitorFormSchema = payVisitorSchema.omit({ quote_id: true });
export type PayVisitorFormValues = z.output<typeof payVisitorFormSchema>;

export const closeVisitorCashSessionSchema = z.object({
  cash_session_id: z.coerce.number().int().positive().optional(),
  counted_cash: requiredNonNegativeAmount,
  counted_transfer: amountOrZero,
  counted_card: amountOrZero,
  notes: optionalText,
  handover_notes: optionalText,
});
export const closeCashFormSchema = closeVisitorCashSessionSchema.omit({ cash_session_id: true });
export type CloseCashFormValues = z.output<typeof closeCashFormSchema>;

/** Conteo de caja del modo Operar: los tres montos se cuentan y son obligatorios. */
export const cashCountFormSchema = z.object({
  cash: requiredNonNegativeAmount,
  card: requiredNonNegativeAmount,
  transfer: requiredNonNegativeAmount,
});
export type CashCountFormValues = z.output<typeof cashCountFormSchema>;
