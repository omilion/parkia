import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ConnectionProvider } from "./postgres";

/**
 * Prepara una base PostgreSQL: migraciones de Drizzle, reglas equivalentes a SQLite,
 * politicas RLS, permisos del rol de la app y datos base. Es idempotente y usa un bloqueo
 * de PostgreSQL, asi que varias instancias pueden arrancar a la vez.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.resolve(ROOT, "server/db/migrations");
const LOCK_KEY = 72_746_101; // "parkia" migraciones

function readStatements(file: string) {
  return readFileSync(file, "utf8").split("--> statement-breakpoint").map(text => text.trim()).filter(Boolean);
}

export async function bootstrapPostgres(provider: ConnectionProvider, options: { createAppRole?: boolean } = {}) {
  const connection = await provider.acquire("admin", null);
  try {
    await connection.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await connection.query("SET TimeZone TO 'UTC'");

    // 1. Migraciones de Drizzle pendientes, cada una en su transaccion.
    const exists = await connection.query("SELECT to_regclass('public.schema_migrations') AS name");
    const applied = new Set<string>();
    if (exists.rows[0]?.name) {
      for (const row of (await connection.query("SELECT id FROM schema_migrations")).rows) applied.add(String(row.id));
    }
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      const id = `pg:${tag}`;
      if (applied.has(id)) continue;
      await connection.query("BEGIN");
      try {
        for (const statement of readStatements(path.join(MIGRATIONS_DIR, `${tag}.sql`))) await connection.query(statement);
        await connection.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw new Error(`Fallo la migracion PostgreSQL ${tag}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2. Rol de la app (sin BYPASSRLS). En produccion lo crea init-roles.sql; aqui solo si falta.
    if (options.createAppRole !== false) {
      await connection.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parkia_app') THEN
            CREATE ROLE parkia_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
          END IF;
        END
        $$;
      `);
    }

    // 3. Reglas, politicas RLS y permisos.
    await connection.query(readFileSync(path.resolve(ROOT, "server/db/postgres-extra.sql"), "utf8"));
    await connection.query(readFileSync(path.resolve(ROOT, "server/db/rls.sql"), "utf8"));
    await connection.query(`
      GRANT USAGE ON SCHEMA public TO parkia_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO parkia_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO parkia_app;
    `);

    // 4. Datos base que en SQLite crean las migraciones.
    await seedPostgresBaseData(connection);
  } finally {
    await connection.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await connection.release();
  }
}

async function seedPostgresBaseData(connection: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }) {
  await connection.query(`
    INSERT INTO plans (code, name, max_branches, max_spaces, max_users, monthly_ticket_limit, price_clp)
    SELECT * FROM (VALUES
      ('starter', 'Starter', 1, 40, 3, 5000, 29900),
      ('pro', 'Pro', 3, 150, 15, 20000, 79900),
      ('business', 'Business', NULL::integer, NULL::integer, NULL::integer, NULL::integer, 149900)
    ) AS v(code, name, max_branches, max_spaces, max_users, monthly_ticket_limit, price_clp)
    WHERE NOT EXISTS (SELECT 1 FROM plans)
  `);
  await connection.query(`INSERT INTO tenants (name, rut, status) SELECT 'Parkia SpA', '76.000.000-1', 'active' WHERE NOT EXISTS (SELECT 1 FROM tenants)`);
  const tenant = (await connection.query("SELECT id FROM tenants ORDER BY id ASC LIMIT 1")).rows[0];
  const tenantId = Number(tenant.id);
  await connection.query(`
    INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, notes)
    SELECT $1, p.id, 'active', date_trunc('month', CURRENT_DATE)::date, (CURRENT_DATE + interval '1 year')::date, 'Suscripcion default creada al iniciar PostgreSQL'
    FROM plans p WHERE p.code = 'pro'
      AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = $1 AND status IN ('trialing', 'active'))
  `, [tenantId]);
  await connection.query(`
    INSERT INTO tenant_settings (tenant_id, grace_days, late_interest, overdue_recovery_rate, company_name, company_rut)
    SELECT id, 5, 1.5, 60, name, rut FROM tenants
    ON CONFLICT (tenant_id) DO NOTHING
  `);
  await connection.query(`
    INSERT INTO branches (tenant_id, name, code, address, commune, city, status)
    SELECT $1, 'Sucursal Principal', 'MAIN', 'Pendiente de configurar', 'Santiago', 'Santiago', 'active'
    WHERE NOT EXISTS (SELECT 1 FROM branches WHERE tenant_id = $1)
  `, [tenantId]);
  await connection.query(`
    INSERT INTO access_rates (tenant_id, type, rate_per_hour, grace_period_mins)
    SELECT $1, v.type, v.rate, v.grace FROM (VALUES ('Proveedor', 0, 120), ('Visita Cliente', 1500, 15), ('Público General', 2500, 15)) AS v(type, rate, grace)
    WHERE NOT EXISTS (SELECT 1 FROM access_rates WHERE tenant_id = $1)
  `, [tenantId]);
}

/** Lista las migraciones SQL disponibles (para diagnostico). */
export function listPostgresMigrations() {
  return readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith(".sql")).sort();
}
