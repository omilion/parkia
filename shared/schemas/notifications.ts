import { z } from "zod";

export const notificationSendSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  recipient: z.string().trim().min(3, "El destinatario es obligatorio").max(160),
  template: z.enum(["fee_due_soon", "fee_overdue", "receipt_boleta", "visitor_pass_qr"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  dedupe_key: z.string().trim().max(180).optional(),
});

export type NotificationSendInput = z.infer<typeof notificationSendSchema>;

