import { z } from 'zod';
import { optionalText, requiredText, rutField } from './common';

/** Reglas de Personal compartidas por formularios y API. */

export const staffRoles = ['admin', 'finance', 'guard', 'cashier'] as const;
const staffEmail = z.string().trim().email('Correo inválido');
const staffPassword = z.string().min(8, 'La clave debe tener al menos 8 caracteres');

export const createStaffSchema = z.object({
  name: requiredText(1, 160, 'El nombre'),
  rut: requiredText(1, 20, 'El RUT'),
  email: staffEmail,
  phone: optionalText,
  role: z.enum(staffRoles, { error: 'Elige un rol' }),
  password: staffPassword.optional(),
});
/** En pantalla la clave inicial es obligatoria y el RUT se valida. */
export const createStaffFormSchema = createStaffSchema.extend({ rut: rutField, password: staffPassword });
export type CreateStaffFormValues = z.output<typeof createStaffFormSchema>;

export const updateStaffSchema = z.object({
  name: requiredText(1, 160, 'El nombre'),
  rut: requiredText(1, 20, 'El RUT'),
  email: staffEmail,
  phone: optionalText,
  role: z.enum(staffRoles, { error: 'Elige un rol' }),
  reason: requiredText(3, 500, 'El motivo'),
});
export const updateStaffFormSchema = updateStaffSchema.extend({ rut: rutField });
export type UpdateStaffFormValues = z.output<typeof updateStaffFormSchema>;

export const updateStaffStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
  reason: requiredText(3, 500, 'El motivo'),
});

export const resetStaffPasswordSchema = z.object({
  password: staffPassword,
  reason: requiredText(3, 500, 'El motivo'),
});
export const resetStaffPasswordFormSchema = resetStaffPasswordSchema.extend({
  password_confirm: z.string(),
}).refine(value => value.password === value.password_confirm, { path: ['password_confirm'], message: 'Las claves no coinciden' });
export type ResetStaffPasswordFormValues = z.output<typeof resetStaffPasswordFormSchema>;
