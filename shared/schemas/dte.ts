import { z } from 'zod';
import { validateRut } from '../rut';
import { dateString, optionalText, requiredText } from './common';

/** Reglas del módulo de facturación electrónica (SII), compartidas por el asistente y la API. */

const rut = (label: string) => z.string().trim().min(1, `Ingresa ${label}`).refine(validateRut, 'RUT inválido: revisa el dígito verificador');
const optionalRutValue = z.preprocess(
  value => (value === '' || value === undefined ? null : value),
  z.string().trim().refine(validateRut, 'RUT inválido: revisa el dígito verificador').nullable().optional(),
);

/** Códigos de actividad económica: "522130, 523010" o una lista. Entre 1 y 4. */
const actecoList = z.preprocess(value => {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === 'string') return value.split(/[,\s;]+/).filter(Boolean).map(Number);
  return value;
}, z.array(z.number({ error: 'Los códigos de actividad son números' }).int().min(1).max(999999)).min(1, 'Ingresa al menos un código de actividad').max(4, 'El SII admite hasta 4 códigos de actividad'));

export const dteSettingsSchema = z.object({
  rut_emisor: rut('el RUT de la empresa emisora'),
  razon_social: requiredText(1, 100, 'La razón social'),
  giro: requiredText(1, 80, 'El giro'),
  acteco: actecoList,
  direccion: requiredText(1, 70, 'La dirección'),
  comuna: requiredText(1, 20, 'La comuna'),
  ciudad: optionalText,
  sii_unidad: requiredText(1, 60, 'La unidad del SII'),
  codigo_sucursal_sii: z.preprocess(
    value => (value === '' || value === undefined ? null : value),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  rut_envia: optionalRutValue,
  auto_emit_boleta: z.coerce.boolean().default(true),
});
export type DteSettingsValues = z.output<typeof dteSettingsSchema>;

/** Formulario del asistente: los códigos de actividad se escriben como texto. */
export const dteSettingsFormSchema = dteSettingsSchema;

export const certificateUploadSchema = z.object({
  pfxBase64: z.string().trim().min(20, 'Selecciona el archivo del certificado (.pfx o .p12)'),
  password: z.string().min(1, 'Ingresa la clave del certificado'),
});
export type CertificateUploadValues = z.output<typeof certificateUploadSchema>;
export const certificateFormSchema = certificateUploadSchema.pick({ password: true });

export const cafUploadSchema = z.object({
  content: z.string().trim().min(50, 'Selecciona el archivo CAF (.xml) que descargaste del SII'),
});
export type CafUploadValues = z.output<typeof cafUploadSchema>;

export const goLiveSchema = z.object({
  resolucion_numero: z.coerce.number({ error: 'Ingresa el número de resolución' }).int().min(1, 'En producción el número de resolución es mayor que 0'),
  resolucion_fecha: dateString,
  confirm: z.literal(true, { error: 'Confirma que completaste la certificación ante el SII' }),
});
export type GoLiveValues = z.output<typeof goLiveSchema>;

export const certificationEnvironmentSchema = z.object({
  resolucion_fecha: dateString,
  resolucion_numero: z.coerce.number().int().min(0).default(0),
});
export type CertificationEnvironmentValues = z.output<typeof certificationEnvironmentSchema>;

export const certificationCaseSchema = z.object({
  /** Identificador del caso tal como lo entrega el SII, p. ej. "4400-1". */
  id: requiredText(1, 40, 'El número de caso'),
  items: z.array(z.object({
    nombre: requiredText(1, 80, 'El nombre del ítem'),
    cantidad: z.coerce.number().positive().default(1),
    /** Precio unitario con IVA incluido (boleta). */
    precio: z.coerce.number().int().positive('El precio debe ser mayor que cero'),
  })).min(1, 'Cada caso necesita al menos un ítem').max(20),
});
export const certificationSetSchema = z.object({
  cases: z.array(certificationCaseSchema).min(1).max(50).optional(),
});
export type CertificationSetValues = z.output<typeof certificationSetSchema>;
