import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Pool, PoolClient } from "pg";
import { assertCatalogRlsCoverage, closePgPools, getPgPool } from "../server/db/client";
import { bootstrapPostgres } from "../server/db/engine/bootstrap";
import { createPoolProvider } from "../server/db/engine/postgres";
import { getParkiaEnv } from "../server/env";

const ORDERED_TABLES = [
  "tenants",
  "plans",
  "staff",
  "tenant_memberships",
  "subscriptions",
  "auth_sessions",
  "auth_login_attempts",
  "auth_password_resets",
  "staff_access_events",
  "tenant_settings",
  "branches",
  "clients",
  "vehicles",
  "spaces",
  "space_status_history",
  "space_maps",
  "space_map_regions",
  "contracts",
  "payments",
  "bank_movements",
  "payment_allocations",
  "payment_adjustments",
  "collection_actions",
  "expenses",
  "financial_budgets",
  "monthly_finance_closures",
  "invoices",
  "sii_events",
  "dte_settings",
  "dte_certificates",
  "dte_cafs",
  "dte_envios",
  "dte_documents",
  "dte_events",
  "access_rates",
  "guard_shift_logs",
  "cash_sessions",
  "cash_movements",
  "cash_session_closures",
  "visitor_tickets",
  "visitor_ticket_quotes",
  "visitor_passes",
  "access_logs",
  "totems",
  "operational_tasks",
  "guard_shift_log_entries",
  "shift_log_entry_attachments",
  "task_comments",
  "task_attachments",
  "documents",
  "audit_events",
] as const;

const BOOLEAN_COLUMNS: Record<string, Set<string>> = {
  staff: new Set(["must_change_password", "totp_enabled"]),
  space_maps: new Set(["is_default"]),
  totems: new Set(["maintenance_mode"]),
  guard_shift_log_entries: new Set(["follow_up_required"]),
};

const INTEGER_MONEY_COLUMNS: Record<string, Set<string>> = {
  spaces: new Set(["price"]),
  contracts: new Set(["monthly_fee", "deposit_amount"]),
  payments: new Set(["amount"]),
  bank_movements: new Set(["amount"]),
  payment_allocations: new Set(["amount"]),
  payment_adjustments: new Set(["amount", "previous_amount", "new_amount"]),
  expenses: new Set(["amount_net", "tax_amount", "amount_total"]),
  financial_budgets: new Set(["planned_amount"]),
  invoices: new Set(["amount"]),
  access_rates: new Set(["rate_per_hour", "rate_per_minute"]),
  cash_sessions: new Set([
    "opening_cash",
    "expected_cash",
    "counted_cash",
    "counted_transfer",
    "counted_card",
    "difference_cash",
  ]),
  cash_movements: new Set(["amount"]),
  visitor_tickets: new Set(["amount", "quoted_amount"]),
  visitor_ticket_quotes: new Set(["rate_per_hour", "rate_per_minute", "subtotal", "discount_amount", "total"]),
};

function sqliteTableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return Boolean(row);
}

async function getPgTableColumns(client: PoolClient, table: string): Promise<Set<string>> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((r) => r.column_name));
}

function normalizeRowValue(table: string, column: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (BOOLEAN_COLUMNS[table]?.has(column)) {
    return Number(value) ? 1 : 0;
  }
  if (INTEGER_MONEY_COLUMNS[table]?.has(column)) {
    return Math.round(Number(value));
  }
  return value;
}

export async function applyPgSchemaAndRls(adminPool: Pool) {
  await bootstrapPostgres(createPoolProvider({ app: adminPool, admin: adminPool }));
}

export interface MigrationReport {
  tablesCopied: number;
  rowCounts: Record<string, { sqlite: number; pg: number }>;
  moneySumsByTenant: Record<
    number,
    {
      payments: { sqlite: number; pg: number };
      expenses: { sqlite: number; pg: number };
      invoices: { sqlite: number; pg: number };
      visitorTickets: { sqlite: number; pg: number };
    }
  >;
  rlsCoverageOk: boolean;
}

export async function migrateSqliteToPg(options?: {
  sqlitePath?: string;
  adminPool?: Pool;
  applySchema?: boolean;
}): Promise<MigrationReport> {
  const sqlitePath = options?.sqlitePath || path.resolve(process.cwd(), getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"));
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });

  try {
    const adminPool = options?.adminPool || getPgPool("admin");
    if (options?.applySchema !== false) {
      await applyPgSchemaAndRls(adminPool);
    }

    const client = await adminPool.connect();
    const rowCounts: Record<string, { sqlite: number; pg: number }> = {};
    let tablesCopied = 0;

    try {
    await client.query("BEGIN");
    // Deshabilitar FKs / triggers temporalmente durante la carga masiva ordenada
    await client.query("SET LOCAL session_replication_role = 'replica'");

    // Limpiar en orden inverso para permitir ejecucion idempotente
    for (const table of [...ORDERED_TABLES].reverse()) {
      await client.query(`TRUNCATE TABLE public."${table}" CASCADE`);
    }

    const defaultTenantRow = sqlite
      .prepare("SELECT id FROM tenants ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;
    const defaultTenantId = defaultTenantRow?.id || 1;

    for (const table of ORDERED_TABLES) {
      if (!sqliteTableExists(sqlite, table)) continue;

      const pgCols = await getPgTableColumns(client, table);
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];

      if (rows.length > 0) {
        const columns = Object.keys(rows[0]).filter((col) => pgCols.has(col));
        const colListSql = columns.map((c) => `"${c}"`).join(", ");

        for (const row of rows) {
          const values = columns.map((col) => {
            const raw = col === "tenant_id" && (row[col] === null || row[col] === undefined) ? defaultTenantId : row[col];
            return normalizeRowValue(table, col, raw);
          });
          const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(", ");
          await client.query(
            `INSERT INTO public."${table}" (${colListSql}) VALUES (${placeholders})`,
            values,
          );
        }

        if (pgCols.has("id")) {
          await client.query(`
            SELECT setval(
              pg_get_serial_sequence('public."${table}"', 'id'),
              COALESCE((SELECT MAX(id) FROM public."${table}"), 1),
              (SELECT COUNT(*) > 0 FROM public."${table}")
            )
          `);
        }
      }

      const pgCountRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public."${table}"`,
      );
      const pgCount = Number(pgCountRes.rows[0]?.count || 0);
      rowCounts[table] = { sqlite: rows.length, pg: pgCount };
      if (rows.length !== pgCount) {
        throw new Error(`Diferencia de conteo en tabla ${table}: SQLite=${rows.length}, PG=${pgCount}`);
      }
      tablesCopied++;
    }

    await client.query("COMMIT");

    // Validar sumas de montos por tenant
    const tenantsRows = sqlite.prepare("SELECT id FROM tenants ORDER BY id ASC").all() as { id: number }[];
    const moneySumsByTenant: MigrationReport["moneySumsByTenant"] = {};

    const sumSqlite = (table: string, col: string, tenantId: number) => {
      if (!sqliteTableExists(sqlite, table)) return 0;
      const r = sqlite
        .prepare(`SELECT COALESCE(SUM(ROUND(${col})), 0) AS total FROM "${table}" WHERE tenant_id = ?`)
        .get(tenantId) as { total: number };
      return Number(r?.total || 0);
    };

    const sumPg = async (table: string, col: string, tenantId: number) => {
      const r = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM("${col}"), 0)::text AS total FROM public."${table}" WHERE tenant_id = $1`,
        [tenantId],
      );
      return Number(r.rows[0]?.total || 0);
    };

    for (const { id: tenantId } of tenantsRows) {
      const summary = {
        payments: {
          sqlite: sumSqlite("payments", "amount", tenantId),
          pg: await sumPg("payments", "amount", tenantId),
        },
        expenses: {
          sqlite: sumSqlite("expenses", "amount_total", tenantId),
          pg: await sumPg("expenses", "amount_total", tenantId),
        },
        invoices: {
          sqlite: sumSqlite("invoices", "amount", tenantId),
          pg: await sumPg("invoices", "amount", tenantId),
        },
        visitorTickets: {
          sqlite: sumSqlite("visitor_tickets", "amount", tenantId),
          pg: await sumPg("visitor_tickets", "amount", tenantId),
        },
      };

      for (const [key, pair] of Object.entries(summary)) {
        if (pair.sqlite !== pair.pg) {
          throw new Error(
            `Suma de montos no coincide para tenant ${tenantId} en ${key}: SQLite=${pair.sqlite}, PG=${pair.pg}`,
          );
        }
      }
      moneySumsByTenant[tenantId] = summary;
    }

    const rlsCheck = await assertCatalogRlsCoverage(adminPool);
    if (!rlsCheck.ok) {
      throw new Error(
        `Tablas sin RLS activo: ${rlsCheck.uncovered.map((u) => u.table_name).join(", ")}`,
      );
    }

    return {
      tablesCopied,
      rowCounts,
      moneySumsByTenant,
      rlsCoverageOk: rlsCheck.ok,
    };
    } finally {
      client.release();
    }
  } finally {
    sqlite.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  migrateSqliteToPg()
    .then(async (report) => {
      console.log(JSON.stringify(report, null, 2));
      return await closePgPools();
    })
    .catch(async (error) => {
      console.error("Error migrando SQLite a PostgreSQL:", error);
      await closePgPools();
      process.exit(1);
    });
}

