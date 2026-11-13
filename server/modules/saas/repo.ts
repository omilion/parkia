import { db } from "../../db";
import { runWithTenant } from "../../db/engine/context";

export type StaffLookupRow = {
  id: number;
  name: string;
  email: string;
  status: string;
  email_verified: number | null;
};

export async function findStaffByEmail(email: string): Promise<StaffLookupRow | undefined> {
  return await db
    .prepare("SELECT id, name, email, status, email_verified FROM staff WHERE LOWER(email) = LOWER(?) LIMIT 1")
    .get<StaffLookupRow>(email.trim());
}

export async function findStarterPlanId(): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM plans WHERE status = 'active' ORDER BY price_clp ASC, id ASC LIMIT 1")
    .get<{ id: number }>();
  return row ? Number(row.id) : null;
}

export async function insertSelfServeTenant(input: {
  companyName: string;
  companyRut: string;
  ownerName: string;
  email: string;
  passwordHash: string;
  branchName: string;
  planId: number;
  trialStart: string;
  trialEnd: string;
  tokenHash: string;
  expiresAt: string;
}): Promise<{ tenantId: number; branchId: number; staffId: number }> {
  const tenantInsert = await db
    .prepare("INSERT INTO tenants (name, rut, status) VALUES (?, ?, 'active')")
    .run(input.companyName, input.companyRut);
  const tenantId = Number(tenantInsert.lastInsertRowid);

  return await runWithTenant(tenantId, async () => {
    const tx = db.transaction(async () => {
      await db
        .prepare("INSERT INTO tenant_settings (tenant_id, company_name, company_rut) VALUES (?, ?, ?)")
        .run(tenantId, input.companyName, input.companyRut);

      const branchCode = `MAIN-${tenantId}`;
      const branchInsert = await db
        .prepare(
          `INSERT INTO branches (tenant_id, name, code, timezone, status)
           VALUES (?, ?, ?, 'America/Santiago', 'active')`,
        )
        .run(tenantId, input.branchName, branchCode);
      const branchId = Number(branchInsert.lastInsertRowid);

      const staffInsert = await db
        .prepare(
          `INSERT INTO staff (name, rut, email, role, status, password_hash, must_change_password, email_verified, email_verified_at)
           VALUES (?, ?, ?, 'admin', 'active', ?, 0, 0, NULL)`,
        )
        .run(input.ownerName, input.companyRut, input.email.toLowerCase(), input.passwordHash);
      const staffId = Number(staffInsert.lastInsertRowid);

      await db
        .prepare(
          `INSERT INTO tenant_memberships (tenant_id, staff_id, role, status)
           VALUES (?, ?, 'owner', 'active')`,
        )
        .run(tenantId, staffId);

      await db
        .prepare(
          `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
           VALUES (?, ?, 'trialing', ?, ?)`,
        )
        .run(tenantId, input.planId, input.trialStart, input.trialEnd);

      await db
        .prepare(
          `INSERT INTO auth_email_verifications (token_hash, staff_id, email, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.tokenHash, staffId, input.email.toLowerCase(), input.expiresAt);

      await db
        .prepare(
          `INSERT INTO audit_events (tenant_id, staff_id, action, entity_type, entity_id, metadata)
           VALUES (?, ?, 'tenant.self_registered', 'tenant', ?, ?)`,
        )
        .run(
          tenantId,
          staffId,
          String(tenantId),
          JSON.stringify({
            company_name: input.companyName,
            branch_id: branchId,
            trial_end: input.trialEnd,
          }),
        );

      return { tenantId, branchId, staffId };
    });

    return await tx();
  });
}

export async function insertEmailVerificationToken(input: {
  tokenHash: string;
  staffId: number;
  email: string;
  expiresAt: string;
}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO auth_email_verifications (token_hash, staff_id, email, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.tokenHash, input.staffId, input.email.toLowerCase(), input.expiresAt);
}

export async function findValidEmailVerificationToken(
  tokenHash: string,
): Promise<{ token_hash: string; staff_id: number; email: string } | undefined> {
  return await db
    .prepare(
      `SELECT token_hash, staff_id, email
       FROM auth_email_verifications
       WHERE token_hash = ? AND verified_at IS NULL AND expires_at > datetime('now')`,
    )
    .get<{ token_hash: string; staff_id: number; email: string }>(tokenHash);
}

export async function markEmailVerified(tokenHash: string, staffId: number): Promise<void> {
  const tx = db.transaction(async () => {
    await db
      .prepare("UPDATE auth_email_verifications SET verified_at = datetime('now') WHERE token_hash = ?")
      .run(tokenHash);
    await db
      .prepare("UPDATE staff SET email_verified = 1, email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(staffId);
  });
  await tx();
}
