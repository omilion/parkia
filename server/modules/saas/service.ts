import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { hashPassword } from "../../auth/password";
import { createSession, getCurrentUser } from "../../auth/sessions";
import { allowPublicAttempt } from "../../middleware/publicAttempts";
import { publicBaseUrl } from "../../platform/http/baseUrl";
import { recentMailCount, sendMail } from "../../platform/mail";
import { DEFAULT_TIMEZONE, localDate } from "../../platform/timezone";
import { recordStaffAccessEvent } from "../../staffAccess";
import { getTenantIdFromRequest, isReservedPlatformEmail } from "../../tenant";
import {
  findStaffByEmail,
  findStarterPlanId,
  findValidEmailVerificationToken,
  insertEmailVerificationToken,
  insertSelfServeTenant,
  markEmailVerified,
  queryOnboardingStatus,
  updateOnboardingSettings,
} from "./repo";

const TRIAL_DAYS = 15;
const EMAIL_VERIFICATION_TTL_HOURS = 24;
const EMAIL_VERIFICATION_MAX_PER_HOUR = 3;

function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeRutDisplay(raw: string): string {
  const clean = raw.replace(/\./g, "").replace(/-/g, "").trim().toUpperCase();
  if (clean.length < 2) return clean;
  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

function expiresAtHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString().replace("T", " ").slice(0, 19);
}

const GENERIC_SIGNUP_MESSAGE =
  "Si el correo es válido, enviamos un enlace de confirmación válido por 24 horas.";

export async function registerSelfServeTenant(
  req: Request,
  input: {
    company_name: string;
    company_rut: string;
    owner_name: string;
    email: string;
    password: string;
    branch_name?: string | null;
  },
): Promise<
  | { status: 201 | 200; body: { success: true; message: string; verification_token?: string } }
  | { status: 429 | 500; body: { error: string } }
> {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  const email = input.email.trim().toLowerCase();

  if (!allowPublicAttempt(`signup:ip:${ip}`, 10) || !allowPublicAttempt(`signup:email:${email}`, 5)) {
    return {
      status: 429,
      body: { error: "Demasiados intentos de registro. Intenta nuevamente en unos minutos." },
    };
  }

  // No revelar si el correo ya existe: devolver respuesta identica sin crear duplicados.
  // Un correo reservado para la administracion de Parkia tampoco se puede registrar como cliente.
  const existing = isReservedPlatformEmail(email) ? { reserved: true } : await findStaffByEmail(email);
  if (existing) {
    return {
      status: 200,
      body: { success: true, message: GENERIC_SIGNUP_MESSAGE },
    };
  }

  const planId = await findStarterPlanId();
  if (!planId) {
    return {
      status: 500,
      body: { error: "No hay planes activos configurados para el registro" },
    };
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashVerificationToken(token);
  const trialStart = localDate(DEFAULT_TIMEZONE);
  const trialEnd = localDate(DEFAULT_TIMEZONE, new Date(Date.now() + TRIAL_DAYS * 86_400_000));

  await insertSelfServeTenant({
    companyName: input.company_name.trim(),
    companyRut: normalizeRutDisplay(input.company_rut),
    ownerName: input.owner_name.trim(),
    email,
    passwordHash: hashPassword(input.password),
    branchName: input.branch_name?.trim() || "Casa Matriz",
    planId,
    trialStart,
    trialEnd,
    tokenHash,
    expiresAt: expiresAtHoursFromNow(EMAIL_VERIFICATION_TTL_HOURS),
    ipAddress: ip,
    userAgent: req.get("user-agent") || null,
  });

  await sendMail({
    to: email,
    template: "email_verification",
    data: {
      name: input.owner_name.trim(),
      url: `${publicBaseUrl(req)}/verificar-correo?token=${token}`,
      expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
    },
  }).catch(() => undefined);

  return {
    status: 201,
    body: {
      success: true,
      message: GENERIC_SIGNUP_MESSAGE,
      ...(process.env.NODE_ENV !== "production" ? { verification_token: token } : {}),
    },
  };
}

export async function verifyEmailWithToken(
  req: Request,
  res: Response,
  input: { token: string },
): Promise<{ status: 200; body: { success: true; verified: true } } | { status: 400; body: { error: string } }> {
  const tokenHash = hashVerificationToken(input.token.trim());
  const row = await findValidEmailVerificationToken(tokenHash);
  if (!row) {
    return {
      status: 400,
      body: { error: "El enlace de verificación es inválido o expiró." },
    };
  }

  await markEmailVerified(tokenHash, row.staff_id);
  await createSession(res, row.staff_id);
  await recordStaffAccessEvent(req, {
    staffId: row.staff_id,
    eventType: "profile_updated",
    metadata: { email_verified: true },
  });

  return { status: 200, body: { success: true, verified: true } };
}

export async function resendVerificationEmail(
  req: Request,
  input: { email?: string },
): Promise<
  | { status: 200; body: { success: true; message: string; verification_token?: string } }
  | { status: 400 | 429; body: { error: string } }
> {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
  const sessionUser = await getCurrentUser(req);
  const email = (input.email || sessionUser?.email || "").trim().toLowerCase();

  if (!email) {
    return { status: 400, body: { error: "Ingresa un correo válido" } };
  }

  if (!allowPublicAttempt(`verify-resend:ip:${ip}`, 10) || !allowPublicAttempt(`verify-resend:email:${email}`, 5)) {
    return {
      status: 429,
      body: { error: "Demasiados reenvíos. Espera unos minutos antes de intentar de nuevo." },
    };
  }

  const staff = await findStaffByEmail(email);
  if (!staff || staff.status !== "active" || Boolean(staff.email_verified)) {
    return { status: 200, body: { success: true, message: GENERIC_SIGNUP_MESSAGE } };
  }

  if ((await recentMailCount(email, "email_verification", 60)) >= EMAIL_VERIFICATION_MAX_PER_HOUR) {
    return { status: 200, body: { success: true, message: GENERIC_SIGNUP_MESSAGE } };
  }

  const token = randomBytes(32).toString("hex");
  await insertEmailVerificationToken({
    tokenHash: hashVerificationToken(token),
    staffId: staff.id,
    email,
    expiresAt: expiresAtHoursFromNow(EMAIL_VERIFICATION_TTL_HOURS),
  });

  await sendMail({
    to: email,
    template: "email_verification",
    data: {
      name: staff.name,
      url: `${publicBaseUrl(req)}/verificar-correo?token=${token}`,
      expiresHours: EMAIL_VERIFICATION_TTL_HOURS,
    },
  }).catch(() => undefined);

  return {
    status: 200,
    body: {
      success: true,
      message: GENERIC_SIGNUP_MESSAGE,
      ...(process.env.NODE_ENV !== "production" ? { verification_token: token } : {}),
    },
  };
}

export async function getOnboardingStatusForRequest(req: Request) {
  const tenantId = await getTenantIdFromRequest(req);
  const raw = await queryOnboardingStatus(tenantId);

  const steps = {
    branch: { done: raw.branchesCount > 0, count: raw.branchesCount, first_branch: raw.firstBranch },
    spaces: { done: raw.spacesCount > 0, count: raw.spacesCount },
    rate_plan: { done: raw.ratePlansCount > 0, count: raw.ratePlansCount },
    staff: { done: raw.staffCount > 1 || raw.staffSkipped, count: raw.staffCount, skipped: raw.staffSkipped },
    test_ticket: { done: raw.ticketsCount > 0, count: raw.ticketsCount },
  };

  const ordered: Array<keyof typeof steps> = ["branch", "spaces", "rate_plan", "staff", "test_ticket"];
  const nextStep = ordered.find((key) => !steps[key].done) ?? null;

  return {
    steps,
    completed: nextStep === null,
    dismissed: raw.dismissed,
    next_step: nextStep,
  };
}

export async function updateOnboardingStateForRequest(
  req: Request,
  input: { dismissed?: boolean; staff_skipped?: boolean },
) {
  const tenantId = await getTenantIdFromRequest(req);
  await updateOnboardingSettings(tenantId, {
    dismissed: input.dismissed,
    staffSkipped: input.staff_skipped,
  });
  return await getOnboardingStatusForRequest(req);
}
