import { db, sqliteRaw } from "../../db";

export async function listTotemsFromDb(tenantId: number) {
  return await db.prepare("SELECT * FROM totems WHERE tenant_id = ? ORDER BY id ASC").all(tenantId);
}

export async function updateTotemMaintenanceInDb(totemId: string | number, tenantId: number, maintenanceMode: boolean) {
  const result = await db.prepare("UPDATE totems SET maintenance_mode = ? WHERE id = ? AND tenant_id = ?")
    .run(maintenanceMode ? 1 : 0, totemId, tenantId);
  return result.changes;
}

export async function backupDatabaseFileInDb(backupPath: string) {
  if (!sqliteRaw) throw new Error("Los respaldos de archivo solo existen con SQLite; en PostgreSQL usa pg_dump (ver docs/POSTGRES.md)");
  await sqliteRaw.backup(backupPath);
}
