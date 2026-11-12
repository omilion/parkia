import Database from "better-sqlite3";
import { getParkiaEnv, getParkiaSeedDemoSetting } from "./env";
import { initializeSchema } from "./db/schema";
import { seedBaseData, seedDatabase } from "./db/seed";
import { SqliteDb } from "./db/engine/sqlite";
import { createPgliteProvider, createPoolProvider, PostgresDb } from "./db/engine/postgres";
import { bootstrapPostgres } from "./db/engine/bootstrap";
import type { Db } from "./db/engine/types";

/**
 * Conexion de la app. `db` tiene la misma forma que better-sqlite3 pero es asincrona.
 *
 * Motor (PARKIA_DB_ENGINE):
 *  - "postgres": servidor PostgreSQL (produccion). Ver docs/POSTGRES.md.
 *  - "pglite":   PostgreSQL embebido en memoria o en PARKIA_PGLITE_DIR (pruebas).
 *  - "sqlite":   archivo SQLite (PARKIA_DB_PATH). Desarrollo local y respaldo de transicion.
 *
 * `sqliteRaw` solo existe con SQLite (respaldos de archivo).
 */

export type DbEngine = "sqlite" | "postgres" | "pglite";

export function getDbEngine(): DbEngine {
  const value = (process.env.PARKIA_DB_ENGINE || "sqlite").trim().toLowerCase();
  if (value === "postgres" || value === "pglite" || value === "sqlite") return value;
  throw new Error(`PARKIA_DB_ENGINE invalido: ${value} (usa postgres, pglite o sqlite)`);
}

async function openDatabase(): Promise<{ db: Db; raw: Database.Database | null }> {
  const engine = getDbEngine();
  if (engine === "sqlite") {
    const raw = new Database(getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"));
    raw.pragma("foreign_keys = ON");
    raw.pragma("journal_mode = WAL");
    initializeSchema(raw);
    return { db: new SqliteDb(raw), raw };
  }

  if (engine === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const pglite = new PGlite(process.env.PARKIA_PGLITE_DIR || undefined);
    await pglite.exec("SET TimeZone TO 'UTC'");
    const provider = createPgliteProvider(pglite);
    await bootstrapPostgres(provider);
    return { db: new PostgresDb(provider), raw: null };
  }

  const { getPgPool } = await import("./db/pgPools");
  const provider = createPoolProvider({ app: getPgPool("app"), admin: getPgPool("admin") });
  await bootstrapPostgres(provider, { createAppRole: process.env.PARKIA_PG_CREATE_APP_ROLE !== "false" });
  return { db: new PostgresDb(provider), raw: null };
}

const opened = await openDatabase();
export const db: Db = opened.db;
export const sqliteRaw: Database.Database | null = opened.raw;

const seedDemoSetting = getParkiaSeedDemoSetting();
const shouldSeedDemoData =
  seedDemoSetting === "true" ||
  (process.env.NODE_ENV !== "production" && seedDemoSetting !== "false");

if (shouldSeedDemoData) {
  await seedDatabase(db);
} else {
  await seedBaseData(db);
}
