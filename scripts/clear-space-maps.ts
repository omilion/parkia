process.env.PARKIA_SEED_DEMO = process.env.PARKIA_SEED_DEMO || "false";

import { existsSync, rmSync } from "fs";
import path from "path";
import { db, sqliteRaw } from "../server/db";
import { getStorageRoot } from "../server/storage";

let backupFile: string | null = path.join("C:/tmp", `parkia-before-map-clear-${Date.now()}.db`);
let backupWarning: string | null = null;
try {
  if (!sqliteRaw) throw new Error("Respaldo de archivo solo disponible con SQLite");
  await sqliteRaw.backup(backupFile);
} catch (error: any) {
  backupWarning = error?.message || "No se pudo crear respaldo antes de limpiar mapas";
  backupFile = null;
}

const files = (await db.prepare("SELECT image_file_path FROM space_maps")
  .all())
  .map((row: any) => row.image_file_path)
  .filter(Boolean);

const before = {
  maps: (await db.prepare("SELECT COUNT(*) AS count FROM space_maps").get()).count,
  regions: (await db.prepare("SELECT COUNT(*) AS count FROM space_map_regions").get()).count,
};

const clearMaps = db.transaction(async () => {
  await db.prepare("DELETE FROM space_map_regions").run();
  await db.prepare("DELETE FROM space_maps").run();
  await db.prepare("DELETE FROM audit_events WHERE action LIKE 'space_map.%'").run();
  await db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('space_maps', 'space_map_regions')").run();
});

await clearMaps();

const storageRoot = path.resolve(getStorageRoot());
const deletedFiles: string[] = [];
for (const relativeFile of files) {
  const absoluteFile = path.resolve(storageRoot, path.normalize(relativeFile).replace(/^([\\/])+/, ""));
  if (absoluteFile.startsWith(`${storageRoot}${path.sep}`) && existsSync(absoluteFile)) {
    rmSync(absoluteFile, { force: true });
    deletedFiles.push(relativeFile);
  }
}

const after = {
  maps: (await db.prepare("SELECT COUNT(*) AS count FROM space_maps").get()).count,
  regions: (await db.prepare("SELECT COUNT(*) AS count FROM space_map_regions").get()).count,
};

console.log(JSON.stringify({ ok: true, backupFile, backupWarning, before, after, deletedFiles }, null, 2));
