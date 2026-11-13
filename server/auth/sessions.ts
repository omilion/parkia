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
  email_verified: boolean;
  impersonation?: {
    by_staff_id: number;
    by_email: string;
    tenant_id: number;
    reason: string;
    expires_at: string;
  } | null;
}

export function getSessionTokenHash(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] || cookies[LEGACY_SESSION_COOKIE];
  return token ? hashToken(token) : null;
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

export async function cleanupExpiredSessions() {
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')").run();
}

export async function revokeUserSessions(staffId: number) {
  await db.prepare("DELETE FROM auth_sessions WHERE staff_id = ?").run(staffId);
}

export async function createSession(res: Response, staffId: number) {
  await cleanupExpiredSessions();

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

  await db.prepare("INSERT INTO auth_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, staffId, expiresAt);

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export async function clearSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || parseCookies(req.headers.cookie)[LEGACY_SESSION_COOKIE];
  if (token) {
    await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hashToken(token));
  }

  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(LEGACY_SESSION_COOKIE, { path: "/" });
}

export async function getCurrentUser(req: Request): Promise<AuthUser | null> {
  const tokenHash = getSessionTokenHash(req);
  if (!tokenHash) return null;

  const user = await db.prepare(`
    SELECT s.id, s.name, s.rut, s.email, s.phone, s.role, s.status, s.last_access,
           s.must_change_password, s.password_changed_at, s.email_verified,
           a.impersonated_by_staff_id, a.impersonated_tenant_id,
           a.impersonation_expires_at, a.impersonation_reason,
           imp.email AS impersonated_by_email
    FROM auth_sessions a
    JOIN staff s ON s.id = a.staff_id
    LEFT JOIN staff imp ON imp.id = a.impersonated_by_staff_id
    WHERE a.token_hash = ? AND a.expires_at > datetime('now') AND s.status = 'active'
  `).get(tokenHash) as (Omit<AuthUser, "must_change_password" | "email_verified" | "impersonation"> & {
    must_change_password: number;
    password_changed_at: string | null;
    email_verified: number | null;
    impersonated_by_staff_id: number | null;
    impersonated_tenant_id: number | null;
    impersonation_expires_at: string | null;
    impersonation_reason: string | null;
    impersonated_by_email: string | null;
  }) | undefined;

  if (!user) return null;

  const expTime = user.impersonation_expires_at ? new Date(user.impersonation_expires_at).getTime() : 0;
  const impersonation =
    user.impersonated_by_staff_id &&
    user.impersonated_tenant_id &&
    expTime > Date.now()
      ? {
          by_staff_id: Number(user.impersonated_by_staff_id),
          by_email: String(user.impersonated_by_email || user.email),
          tenant_id: Number(user.impersonated_tenant_id),
          reason: String(user.impersonation_reason || ""),
          expires_at: new Date(expTime).toISOString(),
        }
      : null;

  const {
    impersonated_by_staff_id: _b,
    impersonated_tenant_id: _t,
    impersonation_expires_at: _e,
    impersonation_reason: _r,
    impersonated_by_email: _be,
    ...baseUser
  } = user;

  return {
    ...baseUser,
    must_change_password: Boolean(user.must_change_password),
    email_verified: user.email_verified === null || user.email_verified === undefined ? true : Boolean(user.email_verified),
    impersonation,
  };
}

function ensurePasswordCanProceed(user: AuthUser, res: Response) {
  if (!user.must_change_password) return true;

  res.status(403).json({
    error: "Debes cambiar tu clave antes de continuar.",
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  return false;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!ensurePasswordCanProceed(user, res)) return;
  next();
}

export function requireAnyRole(roles: AuthRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!ensurePasswordCanProceed(user, res)) return;
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}
