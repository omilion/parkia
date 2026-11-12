import type Database from "better-sqlite3";
import { TransactionScope } from "./context";
import type { Db, RunResult, Statement } from "./types";

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

  constructor(readonly raw: Database.Database) {}

  private statement(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
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
