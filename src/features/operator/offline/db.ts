import Dexie, { type Table } from 'dexie';
import type { LocalOp, StoredSnapshot } from './types';

/**
 * Base local del dispositivo (IndexedDB). Guarda lo necesario para operar sin red:
 * la cola de operaciones, la última instantánea de cada sucursal y datos menores (sucursales).
 * No guarda contraseñas ni la sesión.
 */
class OperatorDatabase extends Dexie {
  ops!: Table<LocalOp, number>;
  snapshots!: Table<StoredSnapshot, number>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'parkia-operator') {
    super(name);
    this.version(1).stores({
      ops: '++seq, &client_uuid, status, branch_id',
      snapshots: 'branch_id',
      meta: 'key',
    });
  }
}

let instance: OperatorDatabase | null = null;

export function operatorDb() {
  return (instance ??= new OperatorDatabase());
}

/** Solo para pruebas: cierra y borra la base para empezar limpio. */
export async function resetOperatorDbForTesting() {
  if (instance) { instance.close(); await instance.delete(); instance = null; }
}

export async function saveSnapshot(branchId: number, snapshot: Omit<StoredSnapshot, 'branch_id' | 'fetched_at'>) {
  await operatorDb().snapshots.put({ ...snapshot, branch_id: branchId, fetched_at: new Date().toISOString() });
}

export async function loadSnapshot(branchId: number) {
  return await operatorDb().snapshots.get(branchId);
}

export async function saveMeta(key: string, value: unknown) {
  await operatorDb().meta.put({ key, value });
}

export async function loadMeta<T>(key: string): Promise<T | undefined> {
  return (await operatorDb().meta.get(key))?.value as T | undefined;
}

/** Borra todo lo del dispositivo (al cerrar sesión: el siguiente usuario no debe ver datos ajenos). */
export async function clearOperatorData() {
  const db = operatorDb();
  await Promise.all([db.ops.clear(), db.snapshots.clear(), db.meta.clear()]);
}
