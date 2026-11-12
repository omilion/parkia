import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword } from "../../auth/password";
import { clearSession, createSession, getCurrentUser, revokeUserSessions } from "../../auth/sessions";
import { recordStaffAccessEvent } from "../../staffAccess";
import { isPlatformAdmin } from "../../tenant";
import {
  deleteLoginAttempt,
  disableStaffTotp,
  enableStaffTotp,
  findStaffByEmailForAuth,
  findStaffPasswordHashById,
  findValidPasswordResetToken,
  getLoginAttempt,
  insertPasswordResetToken,
  markPasswordResetUsed,
  pruneExpiredLoginAttempts,
  saveStaffTotpSecret,
  touchStaffLastAccess,
  updateStaffOwnPassword,
  upsertLoginAttempt,
} from "./repo";
import { buildOtpAuthUrl, generateTotpSecret, verifyTotpCode } from "./totp";

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildLoginAttemptIdentity(req: Request, email: string) {
  const ipAddress = String(req.ip || req.socket?.remoteAddress || "unknown");
  const normalizedEmail = email.trim().toLowerCase();
  return {
    attemptKey: `${ipAddress}:${normalizedEmail}`,
    ipAddress,
    email: normalizedEmail,
  };
}

export function isLoginBlocked(attemptKey: string, nowMs = Date.now()): boolean {
  const attempt = getLoginAttempt(attemptKey);
  if (!attempt) return false;
  if (nowMs > Number(attempt.reset_at)) {
    deleteLoginAttempt(attemptKey);
    return false;
  }
  return Number(attempt.count) >= MAX_LOGIN_ATTEMPTS;
}

export function recordFailedLogin(
  identity: { attemptKey: string; ipAddress: string; email: string },
  nowMs = Date.now(),
): void {
  pruneExpiredLoginAttempts(nowMs);
  const current = getLoginAttempt(identity.attemptKey);
  if (!current || nowMs > Number(current.reset_at)) {
    upsertLoginAttempt({
      attemptKey: identity.attemptKey,
      ipAddress: identity.ipAddress,
      email: identity.email,
      count: 1,
      resetAt: nowMs + LOGIN_WINDOW_MS,
    });
    return;
  }
  upsertLoginAttempt({
    attemptKey: identity.attemptKey,
    ipAddress: identity.ipAddress,
    email: identity.email,
    count: Number(current.count) + 1,
    resetAt: Number(current.reset_at),
  });
}

export function clearFailedLogins(attemptKey: string): void {
  deleteLoginAttempt(attemptKey);
}

export function authenticateStaffLogin(
  req: Request,
  res: Response,
  input: { email: string; password: string; totp_code?: string },
):
  | { status: 200; body: { user: Record<string, unknown> } }
  | { status: 401 | 429; body: { error: string; totp_required?: boolean } } {
  const identity = buildLoginAttemptIdentity(req, input.email);
  if (isLoginBlocked(identity.attemptKey)) {
    return {
      status: 429,
      body: { error: "Demasiados intentos. Intenta nuevamente en unos minutos." },
    };
  }

  const staff = findStaffByEmailForAuth(input.email);
  if (!staff || staff.status !== "active" || !verifyPassword(input.password, staff.password_hash)) {
    recordFailedLogin(identity);
    return {
      status: 401,
      body: { error: "Credenciales invalidas" },
    };
  }

  if (Boolean(staff.totp_enabled) && staff.totp_secret) {
    if (!input.totp_code) {
      return {
        status: 401,
        body: { error: "Codigo 2FA requerido", totp_required: true },
      };
    }
    if (!verifyTotpCode(staff.totp_secret, input.totp_code)) {
      recordFailedLogin(identity);
      return {
        status: 401,
        body: { error: "Codigo 2FA invalido", totp_required: true },
      };
    }
  }

  clearFailedLogins(identity.attemptKey);
  createSession(res, staff.id);
  touchStaffLastAccess(staff.id);
  recordStaffAccessEvent(req, { staffId: staff.id, eventType: "login" });

  const { password_hash: _passwordHash, totp_secret: _totpSecret, ...user } = staff;
  return {
    status: 200,
    body: {
      user: {
        ...user,
        must_change_password: Boolean(user.must_change_password),
        totp_enabled: Boolean(user.totp_enabled),
      },
    },
  };
}

export function logoutCurrentStaff(req: Request, res: Response): { success: true } {
  const user = getCurrentUser(req);
  if (user) {
    recordStaffAccessEvent(req, { staffId: user.id, eventType: "logout" });
  }
  clearSession(req, res);
  return { success: true };
}

export function getAuthenticatedUserPayload(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return null;
  const authRow = findStaffPasswordHashById(user.id);
  return {
    user: {
      ...user,
      totp_enabled: Boolean(authRow?.totp_enabled),
    },
    is_platform_admin: isPlatformAdmin(user),
  };
}

export function changeAuthenticatedStaffPassword(
  req: Request,
  res: Response,
  input: { current_password: string; new_password: string },
): { status: 200; body: { success: true } } | { status: 400 | 401; body: { error: string } } {
  const user = getCurrentUser(req);
  if (!user) {
    return { status: 401, body: { error: "Authentication required" } };
  }

  const staff = findStaffPasswordHashById(user.id);
  if (!staff || !verifyPassword(input.current_password, staff.password_hash)) {
    return { status: 400, body: { error: "Clave actual incorrecta" } };
  }

  updateStaffOwnPassword(user.id, hashPassword(input.new_password));
  revokeUserSessions(user.id);
  createSession(res, user.id);
  recordStaffAccessEvent(req, { staffId: user.id, eventType: "password_changed" });
  return { status: 200, body: { success: true } };
}

export function requestPasswordReset(
  req: Request,
  input: { email: string },
): { status: 200; body: { success: true; reset_token?: string } } {
  const staff = findStaffByEmailForAuth(input.email.trim().toLowerCase());
  if (!staff || staff.status !== "active") {
    return { status: 200, body: { success: true } };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString().replace("T", " ").slice(0, 19);

  insertPasswordResetToken({
    tokenHash,
    staffId: staff.id,
    expiresAt,
  });

  recordStaffAccessEvent(req, { staffId: staff.id, eventType: "password_reset", metadata: { step: "requested" } });

  return {
    status: 200,
    body: {
      success: true,
      ...(process.env.NODE_ENV !== "production" ? { reset_token: token } : {}),
    },
  };
}

export function resetPasswordWithToken(
  req: Request,
  input: { token: string; new_password: string },
): { status: 200; body: { success: true } } | { status: 400; body: { error: string } } {
  const tokenHash = hashResetToken(input.token.trim());
  const resetRow = findValidPasswordResetToken(tokenHash);
  if (!resetRow) {
    return { status: 400, body: { error: "Token de recuperacion invalido o expirado" } };
  }

  updateStaffOwnPassword(resetRow.staff_id, hashPassword(input.new_password));
  markPasswordResetUsed(tokenHash);
  revokeUserSessions(resetRow.staff_id);
  recordStaffAccessEvent(req, { staffId: resetRow.staff_id, eventType: "password_changed", metadata: { via: "password_reset" } });

  return { status: 200, body: { success: true } };
}

export function setupAdminTotp(req: Request) {
  const user = getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const secret = generateTotpSecret();
  saveStaffTotpSecret(user.id, secret);
  const otpauthUrl = buildOtpAuthUrl({ secret, email: user.email });

  return {
    status: 200 as const,
    body: {
      secret,
      otpauth_url: otpauthUrl,
    },
  };
}

export function enableAdminTotp(req: Request, input: { code: string }) {
  const user = getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const row = findStaffPasswordHashById(user.id);
  if (!row?.totp_secret) {
    return { status: 400 as const, body: { error: "Primero debes iniciar la configuracion de 2FA" } };
  }

  if (!verifyTotpCode(row.totp_secret, input.code)) {
    return { status: 400 as const, body: { error: "Codigo 2FA invalido" } };
  }

  enableStaffTotp(user.id);
  recordStaffAccessEvent(req, { staffId: user.id, eventType: "profile_updated", metadata: { totp_enabled: true } });
  return { status: 200 as const, body: { success: true as const, totp_enabled: true } };
}

export function disableAdminTotp(req: Request, input: { password: string }) {
  const user = getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const row = findStaffPasswordHashById(user.id);
  if (!row || !verifyPassword(input.password, row.password_hash)) {
    return { status: 400 as const, body: { error: "Clave actual incorrecta" } };
  }

  disableStaffTotp(user.id);
  recordStaffAccessEvent(req, { staffId: user.id, eventType: "profile_updated", metadata: { totp_enabled: false } });
  return { status: 200 as const, body: { success: true as const, totp_enabled: false } };
}
