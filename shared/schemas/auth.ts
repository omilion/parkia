import { z } from 'zod';

/** Reglas de acceso compartidas por el login, el cambio de clave y la API. */

export const loginSchema = z.object({
  email: z.string().trim().email('Ingresa un correo válido'),
  password: z.string().min(1, 'Ingresa tu clave'),
  totp_code: z.string().trim().min(6).max(16).optional(),
});
export const loginFormSchema = loginSchema.omit({ totp_code: true });
export type LoginFormValues = z.output<typeof loginFormSchema>;

/** Verificación en dos pasos: activar con el código del autenticador y desactivar con la clave. */
export const enableTotpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Ingresa los 6 dígitos del código'),
});
export const disableTotpSchema = z.object({
  password: z.string().min(1, 'Ingresa tu clave'),
});

export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().email('Ingresa un correo válido'),
});

export const resetPasswordFormSchema = z.object({
  new_password: z.string().min(8, 'La nueva clave debe tener al menos 8 caracteres'),
  confirm_password: z.string(),
}).refine(value => value.new_password === value.confirm_password, { path: ['confirm_password'], message: 'La nueva clave no coincide' });

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Ingresa tu clave actual'),
  new_password: z.string().min(8, 'La nueva clave debe tener al menos 8 caracteres'),
});
export const changePasswordFormSchema = changePasswordSchema.extend({
  confirm_password: z.string(),
}).refine(value => value.new_password === value.confirm_password, { path: ['confirm_password'], message: 'La nueva clave no coincide' });
export type ChangePasswordFormValues = z.output<typeof changePasswordFormSchema>;
