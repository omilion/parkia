import type { Express } from "express";
import { changePasswordSchema, loginSchema } from "../../../shared/schemas/auth";
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

const enableTotpSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});

const disableTotpSchema = z.object({
  password: z.string().min(1),
});

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;

    const result = authenticateStaffLogin(req, res, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/logout", (req, res) => {
    res.json(logoutCurrentStaff(req, res));
  });

  app.get("/api/auth/me", (req, res) => {
    const payload = getAuthenticatedUserPayload(req);
    if (!payload) return res.status(401).json({ error: "Authentication required" });
    res.json(payload);
  });

  app.post("/api/auth/change-password", (req, res) => {
    const body = parseBody(changePasswordSchema, req.body, res);
    if (!body) return;

    const result = changeAuthenticatedStaffPassword(req, res, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/forgot-password", (req, res) => {
    const body = parseBody(forgotPasswordSchema, req.body, res);
    if (!body) return;

    const result = requestPasswordReset(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/reset-password", (req, res) => {
    const body = parseBody(resetPasswordSchema, req.body, res);
    if (!body) return;

    const result = resetPasswordWithToken(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/setup", (req, res) => {
    const result = setupAdminTotp(req);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/enable", (req, res) => {
    const body = parseBody(enableTotpSchema, req.body, res);
    if (!body) return;

    const result = enableAdminTotp(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/auth/2fa/disable", (req, res) => {
    const body = parseBody(disableTotpSchema, req.body, res);
    if (!body) return;

    const result = disableAdminTotp(req, body);
    res.status(result.status).json(result.body);
  });
}
