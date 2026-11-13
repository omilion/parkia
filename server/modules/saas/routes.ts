import type { Express } from "express";
import { z } from "zod";
import {
  onboardingStateSchema,
  resendVerificationSchema,
  selfServeSignupSchema,
  verifyEmailSchema,
} from "../../../shared/schemas/saas";
import { requireAnyRole } from "../../auth/sessions";
import { parseBody } from "../../validation";
import {
  getOnboardingStatusForRequest,
  registerSelfServeTenant,
  resendVerificationEmail,
  updateOnboardingStateForRequest,
  verifyEmailWithToken,
} from "./service";

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

export function registerSaasRoutes(app: Express) {
  app.get("/api/onboarding/status", requireAnyRole(["admin"]), async (req, res) => {
    res.json(await getOnboardingStatusForRequest(req));
  });

  app.post("/api/onboarding/state", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(onboardingStateSchema, req.body || {}, res);
    if (!body) return;
    res.json(await updateOnboardingStateForRequest(req, body));
  });
}
