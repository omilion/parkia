import type { Express } from "express";
import { changePasswordSchema, disableTotpSchema, enableTotpSchema, loginSchema } from "../../../shared/schemas/auth";
import { z } from "zod";
import { parseBody } from "../../validation";
import {
  authenticateStaffLogin,
  changeAuthenticatedStaffPassword,
  disableAdminTotp,
  enableAdminTotp,
  getAuthenticatedUserPayload,
  logoutCurrentStaff,
  requestPasswordReset,
  resetPasswordWithToken,
  setupAdminTotp,
} from "./service";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(10),
  new_password: z.string().min(8),
});

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;

    const result = await authenticateStaffLogin(req, res, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/logout", async (req, res) => {
    res.json(await logoutCurrentStaff(req, res));
  });

  app.get("/api/auth/me", async (req, res) => {
    const payload = await getAuthenticatedUserPayload(req);
    if (!payload) return res.status(401).json({ error: "Authentication required" });
    res.json(payload);
  });

  app.post("/api/auth/change-password", async (req, res) => {
    const body = parseBody(changePasswordSchema, req.body, res);
    if (!body) return;

    const result = await changeAuthenticatedStaffPassword(req, res, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const body = parseBody(forgotPasswordSchema, req.body, res);
    if (!body) return;

    const result = await requestPasswordReset(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const body = parseBody(resetPasswordSchema, req.body, res);
    if (!body) return;

    const result = await resetPasswordWithToken(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/setup", async (req, res) => {
    const result = await setupAdminTotp(req);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/enable", async (req, res) => {
    const body = parseBody(enableTotpSchema, req.body, res);
    if (!body) return;

    const result = await enableAdminTotp(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/disable", async (req, res) => {
    const body = parseBody(disableTotpSchema, req.body, res);
    if (!body) return;

    const result = await disableAdminTotp(req, body);
    res.status(result.status).json(result.body);
  });
}
