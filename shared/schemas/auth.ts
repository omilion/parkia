import { z } from 'zod';

/** Reglas de acceso compartidas por el login, el cambio de clave y la API. */

export const loginSchema = z.object({
  email: z.string().trim().email('Ingresa un correo válido'),
  password: z.string().min(1, 'Ingresa tu clave'),
  totp_code: z.string().trim().min(6).max(6).optional(),
});
export const loginFormSchema = loginSchema.omit({ totp_code: true });
export type LoginFormValues = z.output<typeof loginFormSchema>;

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Ingresa tu clave actual'),
  new_password: z.string().min(8, 'La nueva clave debe tener al menos 8 caracteres'),
});
export const changePasswordFormSchema = changePasswordSchema.extend({
  confirm_password: z.string(),
}).refine(value => value.new_password === value.confirm_password, { path: ['confirm_password'], message: 'La nueva clave no coincide' });
export type ChangePasswordFormValues = z.output<typeof changePasswordFormSchema>;
