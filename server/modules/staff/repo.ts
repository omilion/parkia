import { db } from "../../db";

export function queryStaffForTenant(tenantId: number): Record<string, any>[] {
  return db.prepare(`
    SELECT id, name, rut, email, phone, role, status, last_access, must_change_password, password_changed_at, updated_at
    FROM staff
    WHERE id IN (
      SELECT staff_id
      FROM tenant_memberships
      WHERE tenant_id = ? AND status = 'active'
    )
    ORDER BY status ASC, role ASC, name ASC
  `).all(tenantId) as Record<string, any>[];
}

export function insertStaffMember(params: {
  name: string;
  rut: string;
  email: string;
  phone: string | null;
  role: "admin" | "finance" | "guard" | "cashier";
  passwordHash: string;
}): number | bigint {
  const result = db.prepare(`
    INSERT INTO staff (name, rut, email, phone, role, password_hash, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(params.name, params.rut, params.email, params.phone, params.role, params.passwordHash);
  return result.lastInsertRowid;
}

export function findActiveTenantStaffById(staffId: string | number, tenantId: number): {
  id: number;
  name: string;
  rut: string;
  email: string;
  phone: string | null;
  role: "admin" | "finance" | "guard" | "cashier";
  status: "active" | "inactive";
} | undefined {
  return db.prepare(`
    SELECT s.id, s.name, s.rut, s.email, s.phone, s.role, s.status
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.id = ? AND tm.tenant_id = ? AND tm.status = 'active'
  `).get(staffId, tenantId) as any;
}

export function queryStaffAccessEvents(staffId: string | number): Record<string, any>[] {
  return db.prepare(`
    SELECT id, staff_id, event_type, ip_address, user_agent, metadata, created_at
    FROM staff_access_events
    WHERE staff_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 80
  `).all(staffId) as Record<string, any>[];
}

export function countOtherActiveAdminsInTenant(excludeStaffId: number, tenantId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.role = 'admin'
      AND s.status = 'active'
      AND s.id != ?
      AND tm.tenant_id = ?
      AND tm.status = 'active'
  `).get(excludeStaffId, tenantId) as { count: number };
  return Number(row.count || 0);
}

export function updateStaffProfileAndRole(params: {
  staffId: number;
  tenantId: number;
  name: string;
  rut: string;
  email: string;
  phone: string | null;
  role: "admin" | "finance" | "guard" | "cashier";
  roleChanged: boolean;
}): void {
  db.prepare(`
    UPDATE staff
    SET name = ?, rut = ?, email = ?, phone = ?, role = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(params.name, params.rut, params.email, params.phone, params.role, params.staffId);

  if (params.roleChanged) {
    db.prepare(`
      UPDATE tenant_memberships
      SET role = ?, updated_at = datetime('now')
      WHERE tenant_id = ? AND staff_id = ? AND status = 'active'
    `).run(params.role === "admin" ? "admin" : "member", params.tenantId, params.staffId);
  }
}

export function updateStaffStatusById(staffId: number, status: "active" | "inactive"): void {
  db.prepare("UPDATE staff SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, staffId);
}

export function resetStaffPasswordHashById(staffId: number, passwordHash: string): void {
  db.prepare(`
    UPDATE staff
    SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(passwordHash, staffId);
}

