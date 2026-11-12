import { Pool } from "pg";

/**
 * Pools de conexion a PostgreSQL (rol de la app y rol administrador). Sin dependencias de la
 * app, para que server/db.ts pueda abrir la base sin importaciones circulares.
 */

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
        max: Number(process.env.PARKIA_PG_ADMIN_POOL_SIZE || 5),
        options: "-c TimeZone=UTC",
      });
    }
    return adminPool;
  }
  if (!appPool) {
    appPool = new Pool({
      connectionString: getPgConnectionUrl("app"),
      max: Number(process.env.PARKIA_PG_POOL_SIZE || 20),
      options: "-c TimeZone=UTC",
    });
  }
  return appPool;
}

export function setPgPoolsForTesting(pools: { app: Pool | null; admin: Pool | null }) {
  appPool = pools.app;
  adminPool = pools.admin;
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
