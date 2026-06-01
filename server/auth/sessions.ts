import type { NextFunction, Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { db } from "../db";

const SESSION_COOKIE = "parkia_session";
const LEGACY_SESSION_COOKIE = "tl_session";
const SESSION_DAYS = 7;

export type AuthRole = "admin" | "finance" | "guard" | "cashier";

export interface AuthUser {
  id: number;
  name: string;
  rut: string;
  email: string;
  phone: string | null;
  role: AuthRole;
  status: "active" | "inactive";
  last_access: string | null;
  must_change_password: boolean;
  password_changed_at: string | null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined) {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }

  return cookies;
}

function shouldUseSecureCookie() {
  const explicit = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;

  try {
    return new URL(process.env.APP_URL || "").protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export function cleanupExpiredSessions() {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')").run();
}

export function revokeUserSessions(staffId: number) {
  db.prepare("DELETE FROM auth_sessions WHERE staff_id = ?").run(staffId);
}

export function createSession(res: Response, staffId: number) {
  cleanupExpiredSessions();

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

  db.prepare("INSERT INTO auth_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, staffId, expiresAt);

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || parseCookies(req.headers.cookie)[LEGACY_SESSION_COOKIE];
  if (token) {
    db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
  }

  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(LEGACY_SESSION_COOKIE, { path: "/" });
}

export function getCurrentUser(req: Request): AuthUser | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] || cookies[LEGACY_SESSION_COOKIE];
  if (!token) return null;

  const user = db.prepare(`
    SELECT s.id, s.name, s.rut, s.email, s.phone, s.role, s.status, s.last_access,
           s.must_change_password, s.password_changed_at
    FROM auth_sessions a
    JOIN staff s ON s.id = a.staff_id
    WHERE a.token_hash = ? AND a.expires_at > datetime('now') AND s.status = 'active'
  `).get(hashToken(token)) as (Omit<AuthUser, "must_change_password"> & { must_change_password: number, password_changed_at: string | null }) | undefined;

  if (!user) return null;
  return { ...user, must_change_password: Boolean(user.must_change_password) };
}

function ensurePasswordCanProceed(user: AuthUser, res: Response) {
  if (!user.must_change_password) return true;

  res.status(403).json({
    error: "Debes cambiar tu clave antes de continuar.",
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!ensurePasswordCanProceed(user, res)) return;
  next();
}

export function requireAnyRole(roles: AuthRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!ensurePasswordCanProceed(user, res)) return;
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}
