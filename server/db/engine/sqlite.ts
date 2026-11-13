import type Database from "better-sqlite3";
import { localDateOfInstant, todayLocal } from "../../../shared/dates";
import { TransactionScope } from "./context";
import type { Db, RunResult, Statement } from "./types";

/** date('now'...) y strftime(f, 'now'...) pasan a usar el dia de Santiago; datetime('now') sigue en UTC (es lo que se guarda). */
export function localizeNow(sql: string): string {
  return sql
    .replace(/\bdate\(\s*'now'/gi, "date(parkia_today()")
    .replace(/(\bstrftime\(\s*'[^']*'\s*,\s*)'now'/gi, "$1parkia_today()");
}

/**
 * Motor SQLite asincrono sobre una sola conexion better-sqlite3.
 *
 * SQLite tiene una sola conexion, asi que mientras una transaccion esta abierta (y espera
 * algo asincrono), las consultas de otras peticiones esperan a que termine: si no, quedarian
 * dentro de esa transaccion por accidente.
 */
export class SqliteDb implements Db {
  readonly dialect = "sqlite" as const;
  private readonly statements = new Map<string, Database.Statement>();
  private readonly scope = new TransactionScope<null>();
  /** Se resuelve cuando termina la transaccion en curso; null si no hay ninguna. */
  private activeTransaction: Promise<void> | null = null;

  constructor(readonly raw: Database.Database) {
    // SQLite calcula date('now') en UTC. El negocio vive en el calendario de Santiago: estas funciones lo reemplazan
    // (ver localizeNow) y hacen que SQLite y PostgreSQL (translate.ts) coincidan.
    raw.function("parkia_today", () => todayLocal());
    raw.function("parkia_local_date", { deterministic: true }, (value: unknown) => localDateOfInstant(value));
  }

  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(localizeNow(sql));
      this.statements.set(sql, statement);
    }
    return statement;
  }

  /** Espera a que no haya transacciones de otros contextos. Luego se ejecuta sin ceder el turno. */
  private async ready() {
    if (this.scope.current(this)) return;
    while (this.activeTransaction !== null) await this.activeTransaction;
  }

  prepare(sql: string): Statement {
    return {
      get: async <T>(...params: unknown[]) => {
        await this.ready();
        return this.statement(sql).get(...params) as T | undefined;
      },
      all: async <T>(...params: unknown[]) => {
        await this.ready();
        return this.statement(sql).all(...params) as T[];
      },
      run: async (...params: unknown[]): Promise<RunResult> => {
        await this.ready();
        const result = this.statement(sql).run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid === undefined ? undefined : Number(result.lastInsertRowid) };
      },
    };
  }

  async exec(sql: string) {
    await this.ready();
    this.raw.exec(sql);
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) {
    return async (...args: A): Promise<Awaited<R>> => {
      const current = this.scope.current(this);
      if (current) {
        // Anidada: punto de guardado dentro de la transaccion abierta.
        const name = `sp_${current.depth + 1}`;
        this.raw.exec(`SAVEPOINT ${name}`);
        try {
          const result = await this.scope.run(this, null, current.depth + 1, async () => fn(...args));
          this.raw.exec(`RELEASE ${name}`);
          return result as Awaited<R>;
        } catch (error) {
          this.raw.exec(`ROLLBACK TO ${name}`);
          this.raw.exec(`RELEASE ${name}`);
          throw error;
        }
      }

      while (this.activeTransaction !== null) await this.activeTransaction;
      let finish!: () => void;
      this.activeTransaction = new Promise<void>(resolve => { finish = resolve; });
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await this.scope.run(this, null, 0, async () => fn(...args));
        this.raw.exec("COMMIT");
        return result as Awaited<R>;
      } catch (error) {
        if (this.raw.inTransaction) this.raw.exec("ROLLBACK");
        throw error;
      } finally {
        this.activeTransaction = null;
        finish();
      }
    };
  }

  async close() {
    this.raw.close();
  }
}
