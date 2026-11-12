/**
 * Interfaz de acceso a datos de Parkia. Tiene la misma forma que better-sqlite3
 * (`prepare(sql).get/all/run`, `transaction(fn)`) pero es asincrona, para que el mismo
 * codigo funcione sobre SQLite (desarrollo y pruebas) y PostgreSQL (produccion).
 *
 * El SQL se escribe en el dialecto de SQLite que la app ya usa; el motor de PostgreSQL
 * lo traduce (ver translate.ts).
 */

export type RunResult = {
  changes: number;
  /** Id de la fila insertada (si la tabla tiene columna id). */
  lastInsertRowid: number | undefined;
};

export interface Statement {
  get<T = any>(...params: unknown[]): Promise<T | undefined>;
  all<T = any>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

export type Dialect = "sqlite" | "postgres";

export interface Db {
  readonly dialect: Dialect;
  prepare(sql: string): Statement;
  /** Ejecuta uno o mas comandos sin parametros. */
  exec(sql: string): Promise<void>;
  /**
   * Igual que better-sqlite3: devuelve una funcion que, al llamarla, ejecuta `fn` en una
   * transaccion. Dentro de `fn` se sigue usando `db` normalmente; las consultas van a la
   * misma transaccion. Las transacciones anidadas usan puntos de guardado.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>): (...args: A) => Promise<Awaited<R>>;
  close(): Promise<void>;
}
