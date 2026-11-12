import { z } from 'zod';
import { validateRut } from '../rut';

/**
 * Piezas comunes a formularios y API. Un formulario entrega "" en campos vacíos:
 * estas piezas lo convierten en null o undefined para que el servidor reciba lo mismo
 * que antes recibía del FormData.
 */
const emptyTo = <T>(empty: T) => (value: unknown) => (value === '' ? empty : value);

export const dateString = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida');

/** Texto libre opcional: "" pasa a null. */
export const optionalText = z.preprocess(emptyTo(null), z.string().trim().nullable().optional());

/** Texto obligatorio con mínimo y máximo, con mensaje legible. */
export const requiredText = (min: number, max: number, label = 'Este campo') =>
  z.string().trim()
    .min(min, min <= 1 ? `Completa ${label.charAt(0).toLowerCase()}${label.slice(1)}` : `${label} debe tener al menos ${min} caracteres`)
    .max(max, `${label} admite hasta ${max} caracteres`);

/** Fecha opcional: "" pasa a null. */
export const optionalDate = z.preprocess(emptyTo(null), dateString.nullable().optional());

/** Monto en pesos mayor que cero. */
export const positiveAmount = z.coerce.number({ error: 'Ingresa un monto' }).positive('El monto debe ser mayor que cero');

/**
 * Número obligatorio escrito en un campo: "" o texto no numérico es error.
 * A diferencia de z.coerce, un campo vacío no se convierte en 0.
 */
export const requiredNumber = (
  message = 'Ingresa un monto',
  bounds: { min?: number; minMessage?: string; positive?: boolean; int?: string } = {},
) =>
  z.union([z.number(), z.string()]).transform((value, ctx) => {
    const text = typeof value === 'string' ? value.trim() : value;
    const parsed = text === '' ? Number.NaN : Number(text);
    if (Number.isNaN(parsed)) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    const tooSmall = bounds.positive ? parsed <= 0 : bounds.min !== undefined && parsed < bounds.min;
    if (tooSmall) {
      ctx.addIssue({ code: 'custom', message: bounds.minMessage || message });
      return z.NEVER;
    }
    if (bounds.int && !Number.isInteger(parsed)) {
      ctx.addIssue({ code: 'custom', message: bounds.int });
      return z.NEVER;
    }
    return parsed;
    // El proyecto compila sin strictNullChecks; en ese modo Zod marca como opcional la salida
    // de todo transform. El campo es obligatorio en tiempo de ejecución, y el tipo lo declara así.
  }) as unknown as z.ZodCoercedNumber<unknown>;

/** Monto opcional mayor o igual a cero: "" pasa a undefined. */
export const optionalAmount = z.preprocess(emptyTo(undefined), z.coerce.number().min(0, 'El monto no puede ser negativo').optional());

/** Identificador opcional (sucursal, movimiento): "" pasa a null. */
export const optionalId = z.preprocess(emptyTo(null), z.coerce.number().int().positive().nullable().optional());

/** Opción de una lista que puede quedar sin elegir: "" pasa a null. */
export const optionalEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyTo(null), z.enum(values).nullable().optional());

/** RUT chileno obligatorio con dígito verificador. */
export const rutField = z.string().trim().min(1, 'Ingresa el RUT').refine(validateRut, 'RUT inválido: revisa el dígito verificador');

/** RUT opcional: si se escribe, debe ser válido. */
export const optionalRut = z.preprocess(
  emptyTo(null),
  z.string().trim().refine(validateRut, 'RUT inválido: revisa el dígito verificador').nullable().optional(),
);
