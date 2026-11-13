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

export async function queryOnboardingStatus(tenantId: number) {
  const firstBranch = await db
    .prepare(
      `SELECT id, name, code, address, commune, city, phone, timezone
       FROM branches
       WHERE tenant_id = ? AND status = 'active'
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get<Record<string, unknown>>(tenantId);
  const branchesRow = await db
    .prepare("SELECT COUNT(*) AS count FROM branches WHERE tenant_id = ? AND status = 'active'")
    .get<{ count: number }>(tenantId);
  const spacesRow = await db
    .prepare("SELECT COUNT(*) AS count FROM spaces WHERE tenant_id = ? AND type = 'parking'")
    .get<{ count: number }>(tenantId);
  const ratePlansRow = await db
    .prepare("SELECT COUNT(*) AS count FROM rate_plans WHERE tenant_id = ? AND status = 'active'")
    .get<{ count: number }>(tenantId);
  const staffRow = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM tenant_memberships tm
       JOIN staff s ON s.id = tm.staff_id
       WHERE tm.tenant_id = ? AND tm.status = 'active' AND s.status = 'active'`,
    )
    .get<{ count: number }>(tenantId);
  const ticketsRow = await db
    .prepare("SELECT COUNT(*) AS count FROM visitor_tickets WHERE tenant_id = ?")
    .get<{ count: number }>(tenantId);
  const settingsRow = await db
    .prepare("SELECT onboarding_dismissed, onboarding_staff_skipped FROM tenant_settings WHERE tenant_id = ?")
    .get<{ onboarding_dismissed: number | null; onboarding_staff_skipped: number | null }>(tenantId);

  return {
    firstBranch: firstBranch ?? null,
    branchesCount: Number(branchesRow?.count || 0),
    spacesCount: Number(spacesRow?.count || 0),
    ratePlansCount: Number(ratePlansRow?.count || 0),
    staffCount: Number(staffRow?.count || 0),
    ticketsCount: Number(ticketsRow?.count || 0),
    dismissed: Boolean(settingsRow?.onboarding_dismissed),
    staffSkipped: Boolean(settingsRow?.onboarding_staff_skipped),
  };
}

export async function updateOnboardingSettings(
  tenantId: number,
  input: { dismissed?: boolean; staffSkipped?: boolean },
): Promise<void> {
  const existing = await db
    .prepare("SELECT tenant_id FROM tenant_settings WHERE tenant_id = ?")
    .get<{ tenant_id: number }>(tenantId);
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO tenant_settings (tenant_id, onboarding_dismissed, onboarding_staff_skipped)
         VALUES (?, ?, ?)`,
      )
      .run(tenantId, input.dismissed ? 1 : 0, input.staffSkipped ? 1 : 0);
    return;
  }

  if (input.dismissed !== undefined) {
    await db
      .prepare("UPDATE tenant_settings SET onboarding_dismissed = ?, updated_at = datetime('now') WHERE tenant_id = ?")
      .run(input.dismissed ? 1 : 0, tenantId);
  }
  if (input.staffSkipped !== undefined) {
    await db
      .prepare("UPDATE tenant_settings SET onboarding_staff_skipped = ?, updated_at = datetime('now') WHERE tenant_id = ?")
      .run(input.staffSkipped ? 1 : 0, tenantId);
  }
}
