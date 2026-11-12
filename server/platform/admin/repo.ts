import { db } from "../../db";

export function listTotemsFromDb(tenantId: number) {
  return db.prepare("SELECT * FROM totems WHERE tenant_id = ? ORDER BY id ASC").all(tenantId);
}

export function updateTotemMaintenanceInDb(totemId: string | number, tenantId: number, maintenanceMode: boolean) {
  const result = db.prepare("UPDATE totems SET maintenance_mode = ? WHERE id = ? AND tenant_id = ?")
    .run(maintenanceMode ? 1 : 0, totemId, tenantId);
  return result.changes;
}

export async function backupDatabaseFileInDb(backupPath: string) {
  await db.backup(backupPath);
}
