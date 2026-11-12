import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de la peticion en curso: la empresa (para las politicas RLS de PostgreSQL) y la
 * transaccion abierta (para que las consultas dentro de `db.transaction` usen la misma conexion).
 */

const tenantStorage = new AsyncLocalStorage<{ tenantId: number }>();

/** Ejecuta `fn` con la empresa fijada; las consultas a PostgreSQL quedan limitadas por RLS a esa empresa. */
export function runWithTenant<T>(tenantId: number, fn: () => T): T {
  return tenantStorage.run({ tenantId }, fn);
}

export function currentTenantId(): number | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}

/** Ejecuta `fn` sin empresa fijada (tareas de plataforma, trabajos en segundo plano). */
export function runWithoutTenant<T>(fn: () => T): T {
  return tenantStorage.exit(fn);
}

export class TransactionScope<Handle> {
  private readonly storage = new AsyncLocalStorage<{ owner: object; handle: Handle; depth: number }>();

  current(owner: object) {
    const store = this.storage.getStore();
    return store && store.owner === owner ? store : null;
  }

  run<T>(owner: object, handle: Handle, depth: number, fn: () => Promise<T>): Promise<T> {
    return this.storage.run({ owner, handle, depth }, fn);
  }
}
