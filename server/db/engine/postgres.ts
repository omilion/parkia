import type { PGlite } from "@electric-sql/pglite";
import pg, { type Pool } from "pg";
import { currentTenantId, TransactionScope } from "./context";
import { translateSqliteToPostgres, withReturning } from "./translate";
import type { Db, RunResult, Statement } from "./types";

/**
 * Motor PostgreSQL.
 *
 * Aislamiento por empresa: si hay una empresa en contexto (peticiones autenticadas), la
 * consulta corre con el rol `parkia_app` (sin BYPASSRLS) y `app.tenant_id` fijado, de modo
 * que las politicas RLS limitan cada consulta a esa empresa aunque el SQL olvide filtrar.
 * Sin empresa en contexto (login, trabajos de plataforma) corre con el rol administrador.
 */

export type QueryResultLike = { rows: Record<string, unknown>[]; rowCount: number };

export interface Connection {
  query(text: string, params?: unknown[]): Promise<QueryResultLike>;
  release(): Promise<void>;
}

export interface ConnectionProvider {
  /** "app" respeta RLS (con empresa fijada); "admin" no. */
  acquire(kind: "app" | "admin", tenantId: number | null): Promise<Connection>;
  end(): Promise<void>;
}

// ------------------------------------------------------------------ conversion de valores

/** Fechas en el mismo formato que SQLite ('YYYY-MM-DD HH:MM:SS', UTC) para no cambiar el resto de la app. */
export function normalizeTimestamp(value: string) {
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/(Z|[+-]\d\d(:?\d\d)?)$/, "");
}

const TYPE_PARSERS: Record<number, (value: string) => unknown> = {
  16: value => (value === "t" || value === "true" ? 1 : 0), // boolean -> 1/0 como SQLite
  20: value => Number(value), // bigint (COUNT, SUM)
  1700: value => Number(value), // numeric
  1082: value => value, // date: texto 'YYYY-MM-DD'
  1114: normalizeTimestamp, // timestamp
  1184: normalizeTimestamp, // timestamptz
};

function normalizeParam(value: unknown) {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return value;
}

// ------------------------------------------------------------------ proveedores

/** Servidor PostgreSQL real: un pool por rol. */
export function createPoolProvider(pools: { app: Pool; admin: Pool }): ConnectionProvider {
  // node-postgres usa parsers globales por tipo.
  for (const [oid, parser] of Object.entries(TYPE_PARSERS)) pg.types.setTypeParser(Number(oid), parser);
  return {
    async acquire(kind, tenantId) {
      const client = await (kind === "app" ? pools.app : pools.admin).connect();
      if (kind === "app" && tenantId != null) await client.query("SELECT set_config('app.tenant_id', $1, false)", [String(tenantId)]);
      return {
        query: async (text, params) => {
          const result = await client.query(text, params);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
        release: async () => {
          try {
            if (kind === "app" && tenantId != null) await client.query("SELECT set_config('app.tenant_id', '', false)");
          } finally {
            client.release();
          }
        },
      };
    },
    async end() {
      await Promise.all([pools.app.end(), pools.admin.end()]);
    },
  };
}

/**
 * PostgreSQL embebido (PGlite) para pruebas: una sola conexion compartida. Las conexiones se
 * entregan de a una (las transacciones no se mezclan) y el rol de la app se fija con SET ROLE.
 */
export function createPgliteProvider(pglite: PGlite): ConnectionProvider {
  let queue: Promise<void> = Promise.resolve();
  const parsers = Object.fromEntries(Object.entries(TYPE_PARSERS).map(([oid, parser]) => [Number(oid), parser]));
  const run = async (text: string, params?: unknown[]) => {
    const result = await pglite.query(text, (params || []) as any[], { parsers });
    return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? result.rows.length };
  };
  return {
    async acquire(kind, tenantId) {
      let releaseLock!: () => void;
      const previous = queue;
      queue = new Promise<void>(resolve => { releaseLock = resolve; });
      await previous;
      if (kind === "app") {
        await pglite.exec("SET ROLE parkia_app");
        if (tenantId != null) await run("SELECT set_config('app.tenant_id', $1, false)", [String(tenantId)]);
      }
      return {
        query: run,
        release: async () => {
          try {
            if (kind === "app") {
              await pglite.exec("RESET ROLE");
              await run("SELECT set_config('app.tenant_id', '', false)");
            }
          } finally {
            releaseLock();
          }
        },
      };
    },
    async end() {
      await pglite.close();
    },
  };
}

// ------------------------------------------------------------------ motor

export class PostgresDb implements Db {
  readonly dialect = "postgres" as const;
  private readonly scope = new TransactionScope<Connection>();

  constructor(private readonly provider: ConnectionProvider) {}

  private async query(text: string, params: unknown[]) {
    const values = params.map(normalizeParam);
    const transaction = this.scope.current(this);
    if (transaction) return transaction.handle.query(text, values);
    const tenantId = currentTenantId();
    const connection = await this.provider.acquire(tenantId == null ? "admin" : "app", tenantId);
    try {
      return await connection.query(text, values);
    } finally {
      await connection.release();
    }
  }

  prepare(sql: string): Statement {
    const text = translateSqliteToPostgres(sql);
    return {
      get: async <T>(...params: unknown[]) => (await this.query(text, params)).rows[0] as T | undefined,
      all: async <T>(...params: unknown[]) => (await this.query(text, params)).rows as T[],
      run: async (...params: unknown[]): Promise<RunResult> => {
        const result = await this.query(withReturning(text), params);
        const last = result.rows[result.rows.length - 1];
        const id = last && "id" in last ? Number(last.id) : undefined;
        return { changes: result.rowCount, lastInsertRowid: Number.isFinite(id) ? id : undefined };
      },
    };
  }

  async exec(sql: string) {
    const text = translateSqliteToPostgres(sql);
    const transaction = this.scope.current(this);
    if (transaction) {
      await transaction.handle.query(text);
      return;
    }
    const tenantId = currentTenantId();
    const connection = await this.provider.acquire(tenantId == null ? "admin" : "app", tenantId);
    try {
      await connection.query(text);
    } finally {
      await connection.release();
    }
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
    return async (...args: A): Promise<Awaited<R>> => {
      const current = this.scope.current(this);
      if (current) {
        const name = `sp_${current.depth + 1}`;
        await current.handle.query(`SAVEPOINT ${name}`);
        try {
          const result = await this.scope.run(this, current.handle, current.depth + 1, async () => fn(...args));
          await current.handle.query(`RELEASE SAVEPOINT ${name}`);
          return result as Awaited<R>;
        } catch (error) {
          await current.handle.query(`ROLLBACK TO SAVEPOINT ${name}`);
          throw error;
        }
      }

      const tenantId = currentTenantId();
      const connection = await this.provider.acquire(tenantId == null ? "admin" : "app", tenantId);
      try {
        await connection.query("BEGIN");
        const result = await this.scope.run(this, connection, 0, async () => fn(...args));
        await connection.query("COMMIT");
        return result as Awaited<R>;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await connection.release();
      }
    };
  }

  async close() {
    await this.provider.end();
  }
}
