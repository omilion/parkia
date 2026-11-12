import { db } from "../../db";

export async function queryTenantContextForUserRow(userId: number): Promise<Record<string, any> | undefined> {
  return await db.prepare(`
    SELECT t.id as tenant_id,
           t.name as tenant_name,
           t.rut as tenant_rut,
           t.status as tenant_status,
           tm.role as membership_role,
           p.id as plan_id,
           p.code as plan_code,
           p.name as plan_name,
           p.max_branches,
           p.max_spaces,
           p.max_users,
           p.monthly_ticket_limit,
           p.price_clp,
           s.id as subscription_id,
           s.status as subscription_status,
           s.current_period_start,
           s.current_period_end
    FROM tenant_memberships tm
    JOIN tenants t ON t.id = tm.tenant_id
    JOIN subscriptions s ON s.tenant_id = t.id
    JOIN plans p ON p.id = s.plan_id
    WHERE tm.staff_id = ?
      AND tm.status = 'active'
      AND t.status != 'archived'
    ORDER BY
      CASE s.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
      tm.id ASC
    LIMIT 1
  `).get(userId) as Record<string, any> | undefined;
}

export async function insertTenantMembershipForStaff(tenantId: number, staffId: number, membershipRole: "admin" | "member"): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO tenant_memberships (tenant_id, staff_id, role, status)
    VALUES (?, ?, ?, 'active')
  `).run(tenantId, staffId, membershipRole);
}

export async function queryTenantUsageCounts(tenantId: number): Promise<{
  branches: number;
  spaces: number;
  users: number;
  ticketsThisMonth: number;
}> {
  const branches = await db
    .prepare("SELECT COUNT(*) as count FROM branches WHERE tenant_id = ? AND status = 'active'")
    .get(tenantId) as { count: number };
  const spaces = await db
    .prepare("SELECT COUNT(*) as count FROM spaces WHERE tenant_id = ? AND type = 'parking'")
    .get(tenantId) as { count: number };
  const users = await db.prepare(`
    SELECT COUNT(*) as count
    FROM tenant_memberships tm
    JOIN staff s ON s.id = tm.staff_id
    WHERE tm.tenant_id = ? AND tm.status = 'active' AND s.status = 'active'
  `).get(tenantId) as { count: number };
  const ticketsThisMonth = await db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE tenant_id = ?
      AND strftime('%Y-%m', entry_time) = strftime('%Y-%m', 'now')
  `).get(tenantId) as { count: number };

  return {
    branches: Number(branches.count || 0),
    spaces: Number(spaces.count || 0),
    users: Number(users.count || 0),
    ticketsThisMonth: Number(ticketsThisMonth.count || 0),
  };
}

export async function queryTenantExportTables(tenantId: number): Promise<Record<string, Record<string, unknown>[]>> {
  return {
    branches: await db.prepare("SELECT * FROM branches WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    clients: await db.prepare("SELECT * FROM clients WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    vehicles: await db.prepare("SELECT * FROM vehicles WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    spaces: await db.prepare("SELECT * FROM spaces WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    contracts: await db.prepare("SELECT * FROM contracts WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    payments: await db.prepare("SELECT * FROM payments WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    expenses: await db.prepare("SELECT * FROM expenses WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    visitor_tickets: await db.prepare("SELECT * FROM visitor_tickets WHERE tenant_id = ? ORDER BY id ASC").all(tenantId) as Record<string, unknown>[],
    access_logs: await db.prepare("SELECT * FROM access_logs WHERE tenant_id = ? ORDER BY id ASC LIMIT 5000").all(tenantId) as Record<string, unknown>[],
  };
}
