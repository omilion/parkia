import type { Express } from "express";
import { z } from "zod";
import { resendVerificationSchema, selfServeSignupSchema, verifyEmailSchema } from "../../../shared/schemas/saas";
import { parseBody } from "../../validation";
import { registerSelfServeTenant, resendVerificationEmail, verifyEmailWithToken } from "./service";

const optionalEmailSchema = z.object({
  email: resendVerificationSchema.shape.email.optional(),
});

export function registerPublicSaasRoutes(app: Express) {
  app.post("/api/public/signup", async (req, res) => {
    const body = parseBody(selfServeSignupSchema, req.body, res);
    if (!body) return;
    const result = await registerSelfServeTenant(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/public/verify-email", async (req, res) => {
    const body = parseBody(verifyEmailSchema, req.body, res);
    if (!body) return;
    const result = await verifyEmailWithToken(req, res, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/public/resend-verification", async (req, res) => {
    const body = parseBody(optionalEmailSchema, req.body || {}, res);
    if (!body) return;
    const result = await resendVerificationEmail(req, body);
    res.status(result.status).json(result.body);
  });
}
