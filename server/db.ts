import Database from "better-sqlite3";
import { getParkiaEnv, getParkiaSeedDemoSetting } from "./env";
import { initializeSchema } from "./db/schema";
import { seedBaseData, seedDatabase } from "./db/seed";
import { SqliteDb } from "./db/engine/sqlite";
import type { Db } from "./db/engine/types";

/**
 * Conexion de la app. `db` tiene la misma forma que better-sqlite3 pero es asincrona.
 * `sqliteRaw` solo existe con el motor SQLite (respaldos de archivo).
 */

function openSqlite() {
  const raw = new Database(getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"));
  raw.pragma("foreign_keys = ON");
  raw.pragma("journal_mode = WAL");
  initializeSchema(raw);
  return raw;
}

export const sqliteRaw: Database.Database | null = openSqlite();
export const db: Db = new SqliteDb(sqliteRaw);

const seedDemoSetting = getParkiaSeedDemoSetting();
const shouldSeedDemoData =
  seedDemoSetting === "true" ||
  (process.env.NODE_ENV !== "production" && seedDemoSetting !== "false");

if (shouldSeedDemoData) {
  await seedDatabase(db);
} else {
  await seedBaseData(db);
}
