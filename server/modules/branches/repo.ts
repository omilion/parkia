import { db } from "../../db";

export async function queryBranchesWithCounts(tenantId: number): Promise<Record<string, any>[]> {
  return await db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM spaces s WHERE s.branch_id = b.id AND s.tenant_id = ?) as spaces_count,
           (SELECT COUNT(*) FROM visitor_tickets vt WHERE vt.branch_id = b.id AND vt.status != 'completed' AND vt.tenant_id = ?) as active_tickets_count
    FROM branches b
    WHERE b.tenant_id = ?
    ORDER BY b.status ASC, b.name ASC
  `).all(tenantId, tenantId, tenantId) as Record<string, any>[];
}

export async function findBranchByIdAndTenant(id: string | number, tenantId: number): Promise<Record<string, any> | undefined> {
  return await db.prepare("SELECT * FROM branches WHERE id = ? AND tenant_id = ?").get(id, tenantId) as Record<string, any> | undefined;
}

export async function insertBranch(params: {
  name: string;
  code: string;
  address: string | null;
  commune: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
  status: "active" | "inactive";
  tenantId: number;
}): Promise<number | bigint> {
  const result = await db.prepare(`
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

export async function updateBranchById(
  id: string | number,
  tenantId: number,
  fields: string[],
  values: unknown[],
): Promise<void> {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  await db.prepare(`UPDATE branches SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(
    ...values,
    id,
    tenantId,
  );
}
