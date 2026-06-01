import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { recordStaffAccessEvent } from "../staffAccess";
import { createSession, clearSession, getCurrentUser, revokeUserSessions } from "../auth/sessions";
import { hashPassword, verifyPassword } from "../auth/password";
import { parseBody } from "../validation";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function loginAttemptKey(req: any, email: string) {
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${email.toLowerCase()}`;
}

function isLoginBlocked(key: string) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return false;
  if (Date.now() > attempt.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now > current.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearFailedLogins(key: string) {
  loginAttempts.delete(key);
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/login", (req, res) => {
    const body = parseBody(loginSchema, req.body, res);
    if (!body) return;

    const attemptKey = loginAttemptKey(req, body.email);
    if (isLoginBlocked(attemptKey)) {
      return res.status(429).json({ error: "Demasiados intentos. Intenta nuevamente en unos minutos." });
    }

    const staff = db.prepare(`
      SELECT id, name, rut, email, phone, role, status, last_access, must_change_password, password_changed_at, password_hash
      FROM staff
      WHERE email = ?
    `).get(body.email) as any;

    if (!staff || staff.status !== "active" || !verifyPassword(body.password, staff.password_hash)) {
      recordFailedLogin(attemptKey);
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    clearFailedLogins(attemptKey);
    createSession(res, staff.id);
    db.prepare("UPDATE staff SET last_access = datetime('now') WHERE id = ?").run(staff.id);
    recordStaffAccessEvent(req, { staffId: staff.id, eventType: "login" });

    const { password_hash, ...user } = staff;
    res.json({ user: { ...user, must_change_password: Boolean(user.must_change_password) } });
  });

  app.post("/api/auth/logout", (req, res) => {
    const user = getCurrentUser(req);
    if (user) recordStaffAccessEvent(req, { staffId: user.id, eventType: "logout" });
    clearSession(req, res);
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    res.json({ user });
  });

  app.post("/api/auth/change-password", (req, res) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const body = parseBody(changePasswordSchema, req.body, res);
    if (!body) return;

    const staff = db.prepare("SELECT password_hash FROM staff WHERE id = ?").get(user.id) as { password_hash: string | null } | undefined;
    if (!staff || !verifyPassword(body.current_password, staff.password_hash)) {
      return res.status(400).json({ error: "Clave actual incorrecta" });
    }

    db.prepare(`
      UPDATE staff
      SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(hashPassword(body.new_password), user.id);
    revokeUserSessions(user.id);
    createSession(res, user.id);
    recordStaffAccessEvent(req, { staffId: user.id, eventType: "password_changed" });
    res.json({ success: true });
  });
}
