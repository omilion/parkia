import { db } from "../../db";

export type AuthStaffRow = {
  id: number;
  name: string;
  rut: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  last_access: string | null;
  must_change_password: number | boolean;
  password_changed_at: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: number | boolean;
};

export type LoginAttemptRow = {
  attempt_key: string;
  ip_address: string;
  email: string;
  count: number;
  reset_at: number;
};

export type PasswordResetRow = {
  token_hash: string;
  staff_id: number;
  expires_at: string;
  used_at: string | null;
};

export async function findStaffByEmailForAuth(email: string): Promise<AuthStaffRow | undefined> {
  return await db.prepare(`
    SELECT id, name, rut, email, phone, role, status, last_access, must_change_password, password_changed_at, password_hash, totp_secret, totp_enabled
    FROM staff
    WHERE email = ?
  `).get(email) as AuthStaffRow | undefined;
}

export async function findStaffPasswordHashById(staffId: number): Promise<{ password_hash: string | null; totp_secret: string | null; totp_enabled: number } | undefined> {
  return await db.prepare("SELECT password_hash, totp_secret, totp_enabled FROM staff WHERE id = ?").get(staffId) as
    | { password_hash: string | null; totp_secret: string | null; totp_enabled: number }
    | undefined;
}

export async function touchStaffLastAccess(staffId: number): Promise<void> {
  await db.prepare("UPDATE staff SET last_access = datetime('now') WHERE id = ?").run(staffId);
}

export async function updateStaffOwnPassword(staffId: number, passwordHash: string): Promise<void> {
  await db.prepare(`
    UPDATE staff
    SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(passwordHash, staffId);
}

/** Guarda el secreto ya sellado (ver totpSecret.ts) y deja el 2FA sin activar hasta confirmar un codigo. */
export async function saveStaffTotpSecret(staffId: number, sealedSecret: string): Promise<void> {
  await db.prepare(`
    UPDATE staff
    SET totp_secret = ?, totp_enabled = 0, totp_recovery_codes = NULL, totp_last_step = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(sealedSecret, staffId);
}

export async function enableStaffTotp(staffId: number, recoveryCodeHashes: string[], confirmedStep: number): Promise<void> {
  await db.prepare(`
    UPDATE staff
    SET totp_enabled = 1, totp_recovery_codes = ?, totp_last_step = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(recoveryCodeHashes), confirmedStep, staffId);
}

export async function disableStaffTotp(staffId: number): Promise<void> {
  await db.prepare(`
    UPDATE staff
    SET totp_secret = NULL, totp_enabled = 0, totp_recovery_codes = NULL, totp_last_step = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(staffId);
}

/** Acepta el intervalo solo si es posterior al ultimo usado. Atomico: dos logins simultaneos con el mismo codigo, solo uno pasa. */
export async function advanceTotpStep(staffId: number, step: number): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE staff SET totp_last_step = ?
    WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)
  `).run(step, staffId, step);
  return result.changes > 0;
}

/** Gasta un codigo de recuperacion (de un solo uso). Atomico: compara contra la lista leida para no gastarlo dos veces. */
export async function consumeRecoveryCode(staffId: number, codeHash: string): Promise<boolean> {
  const row = await db.prepare("SELECT totp_recovery_codes FROM staff WHERE id = ?").get(staffId) as { totp_recovery_codes: string | null } | undefined;
  if (!row?.totp_recovery_codes) return false;
  let hashes: string[];
  try { hashes = JSON.parse(row.totp_recovery_codes) as string[]; } catch { return false; }
  if (!hashes.includes(codeHash)) return false;
  const remaining = JSON.stringify(hashes.filter(hash => hash !== codeHash));
  const result = await db.prepare("UPDATE staff SET totp_recovery_codes = ? WHERE id = ? AND totp_recovery_codes = ?")
    .run(remaining, staffId, row.totp_recovery_codes);
  return result.changes > 0;
}

export async function countRecoveryCodes(staffId: number): Promise<number> {
  const row = await db.prepare("SELECT totp_recovery_codes FROM staff WHERE id = ?").get(staffId) as { totp_recovery_codes: string | null } | undefined;
  try { return row?.totp_recovery_codes ? (JSON.parse(row.totp_recovery_codes) as string[]).length : 0; } catch { return 0; }
}

export async function insertPasswordResetToken(params: {
  tokenHash: string;
  staffId: number;
  expiresAt: string;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO auth_password_resets (token_hash, staff_id, expires_at)
    VALUES (?, ?, ?)
  `).run(params.tokenHash, params.staffId, params.expiresAt);
}

export async function findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetRow | undefined> {
  return await db.prepare(`
    SELECT token_hash, staff_id, expires_at, used_at
    FROM auth_password_resets
    WHERE token_hash = ?
      AND used_at IS NULL
      AND expires_at > datetime('now')
  `).get(tokenHash) as PasswordResetRow | undefined;
}

export async function markPasswordResetUsed(tokenHash: string): Promise<void> {
  await db.prepare("UPDATE auth_password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(tokenHash);
}

export async function getLoginAttempt(attemptKey: string): Promise<LoginAttemptRow | undefined> {
  return await db.prepare(`
    SELECT attempt_key, ip_address, email, count, reset_at
    FROM auth_login_attempts
    WHERE attempt_key = ?
  `).get(attemptKey) as LoginAttemptRow | undefined;
}

export async function deleteLoginAttempt(attemptKey: string): Promise<void> {
  await db.prepare("DELETE FROM auth_login_attempts WHERE attempt_key = ?").run(attemptKey);
}

export async function upsertLoginAttempt(params: {
  attemptKey: string;
  ipAddress: string;
  email: string;
  count: number;
  resetAt: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO auth_login_attempts (attempt_key, ip_address, email, count, reset_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(attempt_key) DO UPDATE SET
      count = excluded.count,
      reset_at = excluded.reset_at,
      updated_at = datetime('now')
  `).run(params.attemptKey, params.ipAddress, params.email, params.count, params.resetAt);
}

export async function pruneExpiredLoginAttempts(nowMs = Date.now()): Promise<number> {
  const result = await db.prepare("DELETE FROM auth_login_attempts WHERE reset_at <= ?").run(nowMs);
  return result.changes;
}
