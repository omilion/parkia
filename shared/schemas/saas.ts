import { z } from "zod";
import { optionalText, requiredText, rutField } from "./common";

/**
 * Esquemas compartidos de SaaS: alta autoservicio, verificacion de correo y onboarding.
 */

export const selfServeSignupSchema = z.object({
  company_name: requiredText(2, 120, "Nombre de la empresa"),
  company_rut: rutField,
  owner_name: requiredText(2, 120, "Nombre completo"),
  email: z.string().trim().email("Ingresa un correo válido").max(160, "Correo demasiado largo"),
  password: z.string().min(8, "La clave debe tener al menos 8 caracteres").max(128, "Clave demasiado larga"),
  branch_name: optionalText,
  accept_terms: z.literal(true, { error: "Debes aceptar los términos y la política de privacidad" }),
});

export type SelfServeSignupValues = z.output<typeof selfServeSignupSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(10, "Token de verificación inválido"),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email("Ingresa un correo válido").max(160),
});

export const onboardingStateSchema = z.object({
  dismissed: z.boolean().optional(),
  staff_skipped: z.boolean().optional(),
});

export const onboardingBranchSchema = z.object({
  name: requiredText(1, 120, "Nombre de la sucursal"),
  address: optionalText,
  commune: optionalText,
  city: optionalText,
  phone: optionalText,
  timezone: optionalText,
});

export const platformTenantStatusSchema = z.object({
  status: z.enum(["active", "suspended"]),
  reason: optionalText,
});

export const platformImpersonateSchema = z.object({
  tenant_id: z.coerce.number().int().positive("Empresa requerida"),
  reason: requiredText(5, 300, "Motivo de soporte"),
  minutes: z.coerce.number().int().min(5).max(120).default(30),
});

export type PlatformImpersonateValues = z.output<typeof platformImpersonateSchema>;

