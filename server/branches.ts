import { db } from "./db";

export function getDefaultBranchId(tenantId?: number | null) {
  const params: number[] = [];
  let tenantFilter = "";
  if (tenantId) {
    tenantFilter = "AND tenant_id = ?";
    params.push(tenantId);
  }

  const branch = db.prepare(`
    SELECT id
    FROM branches
    WHERE status = 'active'
      ${tenantFilter}
    ORDER BY id ASC
    LIMIT 1
  `).get(...params) as { id: number } | undefined;

  if (!branch) throw new Error("No hay sucursal activa configurada");
  return Number(branch.id);
}

export function getBranchOrDefault(branchId?: number | null, tenantId?: number | null) {
  if (!branchId) return getDefaultBranchId(tenantId);

  const params: number[] = [branchId];
  let tenantFilter = "";
  if (tenantId) {
    tenantFilter = "AND tenant_id = ?";
    params.push(tenantId);
  }

  const branch = db.prepare(`SELECT id FROM branches WHERE id = ? AND status = 'active' ${tenantFilter}`).get(...params) as { id: number } | undefined;
  if (!branch) throw new Error("Sucursal no encontrada o inactiva");
  return Number(branch.id);
}
