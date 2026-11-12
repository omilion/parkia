/**
 * Compara el esquema real de SQLite (migraciones de server/db/schema.ts) con el de PostgreSQL
 * (migraciones de Drizzle en server/db/migrations). Uso: npx tsx scripts/compare-schemas.ts
 * Sale con codigo 1 si a PostgreSQL le falta alguna tabla o columna que SQLite tiene.
 */
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { initializeSchema } from "../server/db/schema";

const sqlite = new Database(":memory:");
initializeSchema(sqlite);
const sqliteTables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(row => row.name);
const sqliteColumns = new Map<string, Map<string, string>>();
for (const table of sqliteTables) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
  sqliteColumns.set(table, new Map(columns.map(column => [column.name, column.type])));
}

const pg = new PGlite();
const migrationsDir = path.resolve("server/db/migrations");
for (const file of readdirSync(migrationsDir).filter(name => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(path.join(migrationsDir, file), "utf8").split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean)) {
    await pg.exec(statement);
  }
}
const pgRows = (await pg.query<{ table_name: string; column_name: string; data_type: string }>(
  "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'",
)).rows;
const pgColumns = new Map<string, Map<string, string>>();
for (const row of pgRows) {
  if (!pgColumns.has(row.table_name)) pgColumns.set(row.table_name, new Map());
  pgColumns.get(row.table_name)!.set(row.column_name, row.data_type);
}

let missing = 0;
const ignoredTables = new Set(["system_config"]); // tabla heredada, reemplazada por tenant_settings
for (const [table, columns] of sqliteColumns) {
  if (ignoredTables.has(table)) continue;
  const pgTable = pgColumns.get(table);
  if (!pgTable) {
    console.log(`FALTA TABLA ${table}`);
    missing += 1;
    continue;
  }
  for (const [column, type] of columns) {
    if (!pgTable.has(column)) {
      console.log(`FALTA COLUMNA ${table}.${column} (${type})`);
      missing += 1;
    } else if (pgTable.get(column) === "boolean") {
      console.log(`BOOLEANO ${table}.${column} (la app usa 0/1)`);
    }
  }
}
for (const [table, columns] of pgColumns) {
  if (!sqliteColumns.has(table)) { console.log(`SOLO EN PG: tabla ${table}`); continue; }
  for (const column of columns.keys()) if (!sqliteColumns.get(table)!.has(column)) console.log(`SOLO EN PG: ${table}.${column}`);
}
await pg.close();
console.log(missing ? `\n${missing} diferencias que bloquean` : "\nSin diferencias que bloqueen");
process.exit(missing ? 1 : 0);
