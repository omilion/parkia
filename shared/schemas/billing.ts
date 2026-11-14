import { z } from "zod";

export const oneclickEnrollSchema = z.object({
  email: z.string().trim().email("Correo inválido").optional(),
  response_url: z.string().trim().url("URL de retorno inválida").optional(),
});

export const oneclickFinishSchema = z.object({
  token: z.string().trim().min(1, "Token de inscripción obligatorio"),
  simulate_rejected: z.boolean().optional(),
});

/** Cobro iniciado por el administrador de plataforma. `simulate_rejected` solo tiene efecto con la pasarela simulada. */
export const platformChargeSchema = z.object({
  simulate_rejected: z.boolean().optional(),
});

/** Pago recibido por fuera de la pasarela (transferencia, deposito). La referencia identifica el pago y no se repite. */
export const platformManualPaymentSchema = z.object({
  reference: z.string().trim().min(3, "Indica la referencia del pago (N° de transferencia)").max(60),
  amount_clp: z.coerce.number().int().positive("El monto debe ser mayor que cero").max(100_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

export const ufRateUpsertSchema = z.object({
  rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)"),
  value_clp: z.coerce.number().min(20_000, "Valor de UF fuera de rango").max(100_000, "Valor de UF fuera de rango"),
  source: z.string().trim().max(80).default("manual"),
});

export type OneclickEnrollInput = z.infer<typeof oneclickEnrollSchema>;
export type OneclickFinishInput = z.infer<typeof oneclickFinishSchema>;
export type PlatformChargeInput = z.infer<typeof platformChargeSchema>;
export type PlatformManualPaymentInput = z.infer<typeof platformManualPaymentSchema>;
export type UfRateUpsertInput = z.infer<typeof ufRateUpsertSchema>;

