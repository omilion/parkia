import { z } from "zod";

export const portalRequestLinkSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  tenantSlug: z.string().trim().min(1).optional(),
});

export const portalVerifyTokenSchema = z.object({
  token: z.string().trim().min(16, "Token inválido"),
});

export const portalPayPaymentSchema = z.object({
  method: z.enum(["card", "transfer"]).default("card"),
  reference: z.string().trim().max(120).optional(),
});

export type PortalRequestLinkInput = z.infer<typeof portalRequestLinkSchema>;
export type PortalVerifyTokenInput = z.infer<typeof portalVerifyTokenSchema>;
export type PortalPayPaymentInput = z.infer<typeof portalPayPaymentSchema>;

