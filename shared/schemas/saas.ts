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
