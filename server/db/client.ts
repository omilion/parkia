import type { Request } from "express";
import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema/index";
import { getTenantIdFromRequest } from "../tenant";

export type PgTx = NodePgDatabase<typeof schema>;

let appPool: Pool | null = null;
let adminPool: Pool | null = null;

export function getPgConnectionUrl(role: "app" | "admin" = "app"): string {
  if (role === "admin" && process.env.PARKIA_PG_ADMIN_URL) {
    return process.env.PARKIA_PG_ADMIN_URL;
  }
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.POSTGRES_HOST || "127.0.0.1";
  const port = process.env.POSTGRES_PORT || "5432";
  const dbName = process.env.POSTGRES_DB || "parkia";
  if (role === "admin") {
    const user = process.env.POSTGRES_USER || "parkia_admin";
    const pass = process.env.POSTGRES_PASSWORD || "parkia_admin_dev";
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${dbName}`;
  }
  const user = process.env.POSTGRES_APP_USER || "parkia_app";
  const pass = process.env.POSTGRES_APP_PASSWORD || "parkia_app_dev";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${dbName}`;
}

export function getPgPool(role: "app" | "admin" = "app"): Pool {
  if (role === "admin") {
    if (!adminPool) {
      adminPool = new Pool({
        connectionString: getPgConnectionUrl("admin"),
        max: 5,
      });
    }
    return adminPool;
  }
  if (!appPool) {
    appPool = new Pool({
      connectionString: getPgConnectionUrl("app"),
      max: 20,
    });
  }
  return appPool;
}

export function setPgPoolsForTesting(pools: { app: Pool | null; admin: Pool | null }) {
  appPool = pools.app;
  adminPool = pools.admin;
}

export function getAdminDb(): PgTx {
  return drizzle(getPgPool("admin"), { schema });
}

export async function closePgPools() {
  if (appPool) {
    await appPool.end();
    appPool = null;
  }
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
}

export interface TenantTxOptions {
  tenantId: number;
  branchIds?: number[];
}

/**
 * Ejecuta `fn` dentro de una transaccion PostgreSQL con el contexto del tenant
 * fijado mediante `SET LOCAL app.tenant_id` (y opcionalmente `app.branch_ids`),
 * de modo que todas las politicas RLS se apliquen automaticamente y se limpien
 * al cerrar la transaccion.
 */
export async function withTenantIdTx<T>(
  options: number | TenantTxOptions,
  fn: (tx: PgTx, client: PoolClient) => Promise<T>,
): Promise<T> {
  const tenantId = typeof options === "number" ? options : options.tenantId;
  const branchIds = typeof options === "number" ? undefined : options.branchIds;

  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("Invalid tenantId for withTenantIdTx");
  }

  const pool = getPgPool("app");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
    if (branchIds && branchIds.length > 0) {
      await client.query("SELECT set_config('app.branch_ids', $1, true)", [branchIds.join(",")]);
    }
    const txDb = drizzle(client, { schema });
    const result = await fn(txDb, client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Helper para rutas Express: resuelve el tenant actual desde `req` y abre una
 * transaccion aislada por RLS con `SET LOCAL app.tenant_id`.
 */
export async function withTenantTx<T>(
  req: Request,
  fn: (tx: PgTx, tenantId: number, client: PoolClient) => Promise<T>,
): Promise<T> {
  const tenantId = getTenantIdFromRequest(req);
  return withTenantIdTx(tenantId, (tx, client) => fn(tx, tenantId, client));
}

/**
 * Verifica que todas las tablas en el catalogo public que tienen columna `tenant_id`
 * (salvo las tablas de plataforma `tenant_memberships` y `subscriptions`) tengan
 * Row Level Security (`relrowsecurity` y `relforcerowsecurity`) activo.
 */
export async function assertCatalogRlsCoverage(customPool?: Pool) {
  const pool = customPool || getPgPool("admin");
  const PLATFORM_TABLES_WITH_TENANT_ID = ["tenant_memberships", "subscriptions"];

  const { rows } = await pool.query<{
    table_name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_count: number;
  }>(
    `
    SELECT c.table_name,
           cls.relrowsecurity AS rls_enabled,
           cls.relforcerowsecurity AS rls_forced,
           (
             SELECT COUNT(*)::int
             FROM pg_policy pol
             WHERE pol.polrelid = cls.oid
           ) AS policy_count
    FROM information_schema.columns c
    JOIN pg_class cls ON cls.relname = c.table_name
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace AND ns.nspname = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND cls.relkind = 'r'
      AND c.table_name != ALL($1::text[])
    ORDER BY c.table_name ASC
    `,
    [PLATFORM_TABLES_WITH_TENANT_ID],
  );

  const uncovered = rows.filter(
    (row) => !row.rls_enabled || !row.rls_forced || row.policy_count === 0,
  );

  return {
    totalTablesChecked: rows.length,
    rows,
    uncovered,
    ok: rows.length > 0 && uncovered.length === 0,
  };
}

export { schema, sql };
