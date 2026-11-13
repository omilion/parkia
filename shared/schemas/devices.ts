import { z } from "zod";

export const deviceCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio").max(100),
  branch_id: z.coerce.number().int().positive().nullable().optional(),
  type: z.enum(["lpr", "barrier", "totem", "pos"]),
  direction: z.enum(["entry", "exit", "both"]).default("both"),
  vendor: z.enum(["generic", "hikvision", "dahua", "shelly"]).default("generic"),
  endpoint_url: z.string().trim().url("URL inválida").nullable().optional().or(z.literal("")),
});

export const deviceCommandCreateSchema = z.object({
  command: z.enum(["open_barrier", "close_barrier", "ping"]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const deviceEventIngestSchema = z
  .object({
    event_type: z.enum(["lpr_plate", "qr_scan", "barrier_open", "barrier_status"]).optional(),
    plate: z.string().trim().max(24).optional(),
    licensePlate: z.string().trim().max(24).optional(),
    PlateNumber: z.string().trim().max(24).optional(),
    qr_token: z.string().trim().max(120).optional(),
    confidence: z.coerce.number().min(0).max(100).optional(),
  })
  .passthrough();

export type DeviceCreateInput = z.infer<typeof deviceCreateSchema>;
export type DeviceCommandCreateInput = z.infer<typeof deviceCommandCreateSchema>;
export type DeviceEventIngestInput = z.infer<typeof deviceEventIngestSchema>;
