import { z } from 'zod';
export const generalSettingsSchema = z.object({
  grace_days: z.number().int().min(0, 'Debe ser cero o mayor'),
  late_interest: z.number().min(0, 'Debe ser cero o mayor'),
  overdue_recovery_rate: z.number().min(0).max(100, 'El porcentaje máximo es 100'),
  company_name: z.string().trim(), company_rut: z.string().trim(), company_address: z.string().trim(),
});
export type GeneralSettingsValues = z.infer<typeof generalSettingsSchema>;

const emptyToNull = (value: unknown) => (value === '' ? null : value);

/** Integraciones: modo de emisión SII y credenciales externas. */
export const integrationSettingsSchema = z.object({
  sii_mode: z.enum(['disabled', 'mock', 'real']),
  sii_provider: z.enum(['local_mock', 'external_provider', 'sii_direct']),
  sii_environment: z.enum(['demo', 'production']),
  sii_api_key: z.preprocess(emptyToNull, z.string().trim().max(500, 'La credencial es demasiado larga').nullable().optional()),
  bank_api_key: z.preprocess(emptyToNull, z.string().trim().max(500, 'La credencial es demasiado larga').nullable().optional()),
});
export type IntegrationSettingsValues = z.output<typeof integrationSettingsSchema>;
