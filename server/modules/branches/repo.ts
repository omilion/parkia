import { db } from "../../db";

export function queryBranchesWithCounts(tenantId: number): Record<string, any>[] {
  return db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM spaces s WHERE s.branch_id = b.id AND s.tenant_id = ?) as spaces_count,
           (SELECT COUNT(*) FROM visitor_tickets vt WHERE vt.branch_id = b.id AND vt.status != 'completed' AND vt.tenant_id = ?) as active_tickets_count
    FROM branches b
    WHERE b.tenant_id = ?
    ORDER BY b.status ASC, b.name ASC
  `).all(tenantId, tenantId, tenantId) as Record<string, any>[];
}

export function findBranchByIdAndTenant(id: string | number, tenantId: number): Record<string, any> | undefined {
  return db.prepare("SELECT * FROM branches WHERE id = ? AND tenant_id = ?").get(id, tenantId) as Record<string, any> | undefined;
}

export function insertBranch(params: {
  name: string;
  code: string;
  address: string | null;
  commune: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
  status: "active" | "inactive";
  tenantId: number;
}): number | bigint {
  const result = db.prepare(`
    INSERT INTO branches (name, code, address, commune, city, phone, timezone, status, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.name,
    params.code,
    params.address,
    params.commune,
    params.city,
    params.phone,
    params.timezone,
    params.status,
    params.tenantId,
  );
  return result.lastInsertRowid;
}

export function updateBranchById(
  id: string | number,
  tenantId: number,
  fields: string[],
  values: unknown[],
): void {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  db.prepare(`UPDATE branches SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(
    ...values,
    id,
    tenantId,
  );
}
