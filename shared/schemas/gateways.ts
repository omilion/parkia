import { z } from 'zod';

/** Configuración de pasarelas de pago y pantallas públicas de pago. */

export const gatewayProviders = ['webpay', 'mock'] as const;

export const paymentSettingsSchema = z.object({
  provider: z.enum(gatewayProviders),
  environment: z.enum(['integration', 'production']).default('integration'),
  enabled: z.boolean().default(false),
  commerce_code: z.string().trim().max(30, 'El código de comercio es demasiado largo').optional(),
  api_secret: z.string().trim().max(200, 'La llave secreta es demasiado larga').optional(),
  exit_window_mins: z.coerce.number({ error: 'Ingresa los minutos para salir' }).int('Usa un número entero').min(0, 'Debe ser 0 o más').max(240, 'Máximo 240 minutos').default(15),
});
export type PaymentSettingsValues = z.output<typeof paymentSettingsSchema>;

export const startPaymentSchema = z.object({ provider: z.enum(gatewayProviders) });

export const mockDecisionSchema = z.object({ outcome: z.enum(['approve', 'reject', 'cancel']) });
