import { z } from "zod";

export const privacyTitularDeleteSchema = z
  .object({
    rut: z.string().trim().max(24).optional(),
    plate: z.string().trim().max(16).optional(),
    email: z.string().trim().email("Correo inválido").optional(),
    reason: z.string().trim().min(1, "El motivo es obligatorio").max(300),
  })
  .refine((value) => Boolean(value.rut || value.plate || value.email), {
    message: "Debes indicar al menos un identificador (RUT, patente o correo)",
    path: ["rut"],
  });

export const privacyConsentCreateSchema = z.object({
  subject_type: z.enum(["staff", "client", "visitor"]),
  subject_id: z.coerce.number().int().positive().nullable().optional(),
  subject_identifier: z.string().trim().min(1, "El identificador del titular es obligatorio").max(160),
  purpose: z.string().trim().min(1, "La finalidad es obligatoria").max(80),
  policy_version: z.string().trim().max(64).default("2026-11-ley-21719-v1"),
  granted: z.boolean().default(true),
});

export type PrivacyTitularDeleteInput = z.infer<typeof privacyTitularDeleteSchema>;
export type PrivacyConsentCreateInput = z.infer<typeof privacyConsentCreateSchema>;

