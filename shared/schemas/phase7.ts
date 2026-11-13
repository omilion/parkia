import { z } from "zod";

export const reservationCreateSchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
  space_id: z.coerce.number().int().positive().optional(),
  client_id: z.coerce.number().int().positive().optional(),
  plate: z.string().trim().min(4, "Patente requerida").max(16),
  visitor_name: z.string().trim().max(120).optional(),
  starts_at: z.string().trim().min(10, "Fecha de inicio requerida"),
  ends_at: z.string().trim().min(10, "Fecha de término requerida"),
  notes: z.string().trim().max(300).optional(),
});

export const ipcRateUpsertSchema = z.object({
  period: z.string().trim().regex(/^\d{4}-\d{2}$/, "Periodo debe ser YYYY-MM"),
  // Variacion MENSUAL del IPC (historicamente entre -1% y +2%): el rango es amplio pero descarta errores de digitacion absurdos.
  variation_pct: z.coerce.number().min(-5).max(10),
  source: z.string().trim().min(1).max(60).default("manual"),
});

export const contractReajusteSchema = z.object({
  index_type: z.enum(["ipc", "uf"]),
  period_key: z.string().trim().min(4).max(20).optional(),
  uf_value_clp: z.coerce.number().positive().optional(),
});

export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>;
export type IpcRateUpsertInput = z.infer<typeof ipcRateUpsertSchema>;
export type ContractReajusteInput = z.infer<typeof contractReajusteSchema>;

