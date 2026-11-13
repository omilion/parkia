import { z } from "zod";

export const oneclickEnrollSchema = z.object({
  email: z.string().trim().email("Correo inválido").optional(),
  response_url: z.string().trim().url("URL de retorno inválida").optional(),
});

export const oneclickFinishSchema = z.object({
  token: z.string().trim().min(1, "Token de inscripción obligatorio"),
  simulate_rejected: z.boolean().optional(),
});

export const chargeSubscriptionSchema = z.object({
  uf_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)")
    .optional(),
  simulate_rejected: z.boolean().optional(),
});

export const ufRateUpsertSchema = z.object({
  rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)"),
  value_clp: z.coerce.number().positive("El valor de la UF debe ser positivo"),
  source: z.string().trim().max(80).default("manual"),
});

export type OneclickEnrollInput = z.infer<typeof oneclickEnrollSchema>;
export type OneclickFinishInput = z.infer<typeof oneclickFinishSchema>;
export type ChargeSubscriptionInput = z.infer<typeof chargeSubscriptionSchema>;
export type UfRateUpsertInput = z.infer<typeof ufRateUpsertSchema>;

