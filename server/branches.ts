import { db } from "./db";

export function getDefaultBranchId() {
  const branch = db.prepare(`
    SELECT id
    FROM branches
    WHERE status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number } | undefined;

  if (!branch) throw new Error("No hay sucursal activa configurada");
  return Number(branch.id);
}

export function getBranchOrDefault(branchId?: number | null) {
  if (!branchId) return getDefaultBranchId();

  const branch = db.prepare("SELECT id FROM branches WHERE id = ? AND status = 'active'").get(branchId) as { id: number } | undefined;
  if (!branch) throw new Error("Sucursal no encontrada o inactiva");
  return Number(branch.id);
}
