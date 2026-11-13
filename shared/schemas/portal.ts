import { z } from "zod";

export const portalRequestLinkSchema = z.object({
  email: z.string().trim().email("Correo inválido"),
  tenantSlug: z.string().trim().min(1).optional(),
});

export const portalVerifyTokenSchema = z.object({
  token: z.string().trim().min(16, "Token inválido"),
});


export type PortalRequestLinkInput = z.infer<typeof portalRequestLinkSchema>;
export type PortalVerifyTokenInput = z.infer<typeof portalVerifyTokenSchema>;

