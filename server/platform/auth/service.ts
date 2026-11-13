import { createHash, randomBytes } from "crypto";
import type { Request, Response } from "express";
import { hashPassword, verifyPassword } from "../../auth/password";
import { clearSession, createSession, getCurrentUser, revokeUserSessions } from "../../auth/sessions";
import { recordStaffAccessEvent } from "../../staffAccess";
import { isPlatformAdmin } from "../../tenant";
import { publicBaseUrl } from "../http/baseUrl";
import { recentMailCount, sendMail } from "../mail";
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
// Limite por direccion: evita usar la recuperacion de clave para inundar la bandeja de alguien.
const PASSWORD_RESET_MAX_EMAILS_PER_HOUR = 3;

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

export async function isLoginBlocked(attemptKey: string, nowMs = Date.now()): Promise<boolean> {
  const attempt = await getLoginAttempt(attemptKey);
  if (!attempt) return false;
  if (nowMs > Number(attempt.reset_at)) {
    await deleteLoginAttempt(attemptKey);
    return false;
  }
  return Number(attempt.count) >= MAX_LOGIN_ATTEMPTS;
}

export async function recordFailedLogin(
  identity: { attemptKey: string; ipAddress: string; email: string },
  nowMs = Date.now(),
): Promise<void> {
  await pruneExpiredLoginAttempts(nowMs);
  const current = await getLoginAttempt(identity.attemptKey);
  if (!current || nowMs > Number(current.reset_at)) {
    await upsertLoginAttempt({
      attemptKey: identity.attemptKey,
      ipAddress: identity.ipAddress,
      email: identity.email,
      count: 1,
      resetAt: nowMs + LOGIN_WINDOW_MS,
    });
    return;
  }
  await upsertLoginAttempt({
    attemptKey: identity.attemptKey,
    ipAddress: identity.ipAddress,
    email: identity.email,
    count: Number(current.count) + 1,
    resetAt: Number(current.reset_at),
  });
}

export async function clearFailedLogins(attemptKey: string): Promise<void> {
  await deleteLoginAttempt(attemptKey);
}

export async function authenticateStaffLogin(
  req: Request,
  res: Response,
  input: { email: string; password: string; totp_code?: string },
):
  Promise<| { status: 200; body: { user: Record<string, unknown> } }
  | { status: 401 | 429; body: { error: string; totp_required?: boolean } }> {
  const identity = buildLoginAttemptIdentity(req, input.email);
  if (await isLoginBlocked(identity.attemptKey)) {
    return {
      status: 429,
      body: { error: "Demasiados intentos. Intenta nuevamente en unos minutos." },
    };
  }

  const staff = await findStaffByEmailForAuth(input.email);
  if (!staff || staff.status !== "active" || !verifyPassword(input.password, staff.password_hash)) {
    await recordFailedLogin(identity);
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
      await recordFailedLogin(identity);
      return {
        status: 401,
        body: { error: "Codigo 2FA invalido", totp_required: true },
      };
    }
  }

  await clearFailedLogins(identity.attemptKey);
  await createSession(res, staff.id);
  await touchStaffLastAccess(staff.id);
  await recordStaffAccessEvent(req, { staffId: staff.id, eventType: "login" });

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

export async function logoutCurrentStaff(req: Request, res: Response): Promise<{ success: true }> {
  const user = await getCurrentUser(req);
  if (user) {
    await recordStaffAccessEvent(req, { staffId: user.id, eventType: "logout" });
  }
  await clearSession(req, res);
  return { success: true };
}

export async function getAuthenticatedUserPayload(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return null;
  const authRow = await findStaffPasswordHashById(user.id);
  return {
    user: {
      ...user,
      totp_enabled: Boolean(authRow?.totp_enabled),
    },
    is_platform_admin: isPlatformAdmin(user),
  };
}

export async function changeAuthenticatedStaffPassword(
  req: Request,
  res: Response,
  input: { current_password: string; new_password: string },
): Promise<{ status: 200; body: { success: true } } | { status: 400 | 401; body: { error: string } }> {
  const user = await getCurrentUser(req);
  if (!user) {
    return { status: 401, body: { error: "Authentication required" } };
  }

  const staff = await findStaffPasswordHashById(user.id);
  if (!staff || !verifyPassword(input.current_password, staff.password_hash)) {
    return { status: 400, body: { error: "Clave actual incorrecta" } };
  }

  await updateStaffOwnPassword(user.id, hashPassword(input.new_password));
  await revokeUserSessions(user.id);
  await createSession(res, user.id);
  await recordStaffAccessEvent(req, { staffId: user.id, eventType: "password_changed" });
  return { status: 200, body: { success: true } };
}

export async function requestPasswordReset(
  req: Request,
  input: { email: string },
): Promise<{ status: 200; body: { success: true; reset_token?: string } }> {
  const staff = await findStaffByEmailForAuth(input.email.trim().toLowerCase());
  if (!staff || staff.status !== "active") {
    return { status: 200, body: { success: true } };
  }

  if (await recentMailCount(input.email, "password_reset", 60) >= PASSWORD_RESET_MAX_EMAILS_PER_HOUR) {
    // Misma respuesta que en el caso normal: no se revela si la direccion existe ni que se alcanzo el limite.
    return { status: 200, body: { success: true } };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString().replace("T", " ").slice(0, 19);

  await insertPasswordResetToken({
    tokenHash,
    staffId: staff.id,
    expiresAt,
  });

  await recordStaffAccessEvent(req, { staffId: staff.id, eventType: "password_reset", metadata: { step: "requested" } });

  // El enlace solo viaja por correo. Si el envio falla, el usuario puede pedir otro: la respuesta no cambia.
  await sendMail({
    to: input.email,
    template: "password_reset",
    data: { name: staff.name, url: `${publicBaseUrl(req)}/restablecer?token=${token}`, expiresMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60_000) },
  }).catch(() => undefined);

  return {
    status: 200,
    body: {
      success: true,
      ...(process.env.NODE_ENV !== "production" ? { reset_token: token } : {}),
    },
  };
}

export async function resetPasswordWithToken(
  req: Request,
  input: { token: string; new_password: string },
): Promise<{ status: 200; body: { success: true } } | { status: 400; body: { error: string } }> {
  const tokenHash = hashResetToken(input.token.trim());
  const resetRow = await findValidPasswordResetToken(tokenHash);
  if (!resetRow) {
    return { status: 400, body: { error: "Token de recuperacion invalido o expirado" } };
  }

  await updateStaffOwnPassword(resetRow.staff_id, hashPassword(input.new_password));
  await markPasswordResetUsed(tokenHash);
  await revokeUserSessions(resetRow.staff_id);
  await recordStaffAccessEvent(req, { staffId: resetRow.staff_id, eventType: "password_changed", metadata: { via: "password_reset" } });

  return { status: 200, body: { success: true } };
}

export async function setupAdminTotp(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const secret = generateTotpSecret();
  await saveStaffTotpSecret(user.id, secret);
  const otpauthUrl = buildOtpAuthUrl({ secret, email: user.email });

  return {
    status: 200 as const,
    body: {
      secret,
      otpauth_url: otpauthUrl,
    },
  };
}

export async function enableAdminTotp(req: Request, input: { code: string }) {
  const user = await getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const row = await findStaffPasswordHashById(user.id);
  if (!row?.totp_secret) {
    return { status: 400 as const, body: { error: "Primero debes iniciar la configuracion de 2FA" } };
  }

  if (!verifyTotpCode(row.totp_secret, input.code)) {
    return { status: 400 as const, body: { error: "Codigo 2FA invalido" } };
  }

  await enableStaffTotp(user.id);
  await recordStaffAccessEvent(req, { staffId: user.id, eventType: "profile_updated", metadata: { totp_enabled: true } });
  return { status: 200 as const, body: { success: true as const, totp_enabled: true } };
}

export async function disableAdminTotp(req: Request, input: { password: string }) {
  const user = await getCurrentUser(req);
  if (!user) return { status: 401 as const, body: { error: "Authentication required" } };
  if (user.role !== "admin") return { status: 403 as const, body: { error: "2FA TOTP solo disponible para administradores" } };

  const row = await findStaffPasswordHashById(user.id);
  if (!row || !verifyPassword(input.password, row.password_hash)) {
    return { status: 400 as const, body: { error: "Clave actual incorrecta" } };
  }

  await disableStaffTotp(user.id);
  await recordStaffAccessEvent(req, { staffId: user.id, eventType: "profile_updated", metadata: { totp_enabled: false } });
  return { status: 200 as const, body: { success: true as const, totp_enabled: false } };
}
