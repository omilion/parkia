import type { OperationResult, OperatorOperation } from '../../../../shared/schemas/operator';
import { operatorDb } from './db';
import type { LocalOp } from './types';

/** Cola de operaciones sin conexión. Todo lo que el operador hace sin red pasa por aquí antes de enviarse. */

const events = new EventTarget();
/** Avisa a la interfaz que la cola cambió (altas, resultados, descartes). */
export const queueEvents = {
  subscribe(listener: () => void) {
    events.addEventListener('change', listener);
    return () => events.removeEventListener('change', listener);
  },
  emit() {
    events.dispatchEvent(new Event('change'));
  },
};

export const newClientUuid = () => crypto.randomUUID();

/** Token del QR de pago de un ticket creado sin red (mismo formato que genera el servidor). */
export function newTicketToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `t_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

/** Distinguir un fallo de red (reintentable) de una respuesta del servidor. */
export const isNetworkFailure = (error: unknown) => error instanceof TypeError || (error as { name?: string })?.name === 'AbortError';

export async function enqueueOperation(branchId: number, operation: OperatorOperation): Promise<LocalOp> {
  const op: LocalOp = {
    client_uuid: operation.client_uuid, branch_id: branchId, operation, status: 'pending', attempts: 0,
    created_at: new Date().toISOString(), last_error: null, code: null, warnings: [], server_ticket_id: null, applied_server_time: null,
  };
  const seq = await operatorDb().ops.add(op);
  queueEvents.emit();
  return { ...op, seq };
}

export async function listOps(branchId?: number): Promise<LocalOp[]> {
  const all = await operatorDb().ops.orderBy('seq').toArray();
  return branchId === undefined ? all : all.filter(op => op.branch_id === branchId);
}

export async function pendingOps(): Promise<LocalOp[]> {
  return (await operatorDb().ops.where('status').equals('pending').sortBy('seq'));
}

export async function markAttempt(uuids: string[], error: string | null) {
  await operatorDb().transaction('rw', operatorDb().ops, async () => {
    for (const uuid of uuids) {
      const op = await operatorDb().ops.where('client_uuid').equals(uuid).first();
      if (op) await operatorDb().ops.update(op.seq!, { attempts: op.attempts + 1, last_error: error });
    }
  });
  queueEvents.emit();
}

/** Guarda lo que respondió el servidor para cada operación del lote. */
export async function applyResults(results: OperationResult[], serverTime: string) {
  await operatorDb().transaction('rw', operatorDb().ops, async () => {
    for (const result of results) {
      const op = await operatorDb().ops.where('client_uuid').equals(result.client_uuid).first();
      if (!op) continue;
      const applied = result.status === 'applied' || (result.status === 'duplicate' && result.original_status === 'applied');
      const operation = op.operation.type === 'entry' && result.public_token ? { ...op.operation, public_token: result.public_token } : op.operation;
      await operatorDb().ops.update(op.seq!, {
        operation, status: applied ? 'applied' : 'rejected', attempts: op.attempts + 1,
        last_error: applied ? null : (result.error ?? 'El servidor rechazó la operación'),
        code: applied ? null : (result.code ?? 'REJECTED'), warnings: result.warnings ?? [],
        server_ticket_id: result.ticket_id ?? null, applied_server_time: applied ? serverTime : null,
      });
    }
  });
  queueEvents.emit();
}

/** Marca un lote entero como rechazado (el servidor dijo que el formato no es válido: reintentar no sirve). */
export async function rejectBatch(uuids: string[], code: string, message: string) {
  await operatorDb().transaction('rw', operatorDb().ops, async () => {
    for (const uuid of uuids) {
      const op = await operatorDb().ops.where('client_uuid').equals(uuid).first();
      if (op) await operatorDb().ops.update(op.seq!, { status: 'rejected', code, last_error: message });
    }
  });
  queueEvents.emit();
}

/** Descarta una operación rechazada después de que una persona la resolvió. */
export async function discardOperation(uuid: string) {
  const op = await operatorDb().ops.where('client_uuid').equals(uuid).first();
  if (op?.status === 'rejected') await operatorDb().ops.delete(op.seq!);
  queueEvents.emit();
}

/** Quita las operaciones ya aplicadas que una instantánea posterior del servidor refleja. */
export async function purgeReflectedOps(snapshotServerTime: string) {
  const stale = (await operatorDb().ops.where('status').equals('applied').toArray())
    .filter(op => op.applied_server_time !== null && op.applied_server_time <= snapshotServerTime);
  if (stale.length) {
    await operatorDb().ops.bulkDelete(stale.map(op => op.seq!));
    queueEvents.emit();
  }
}
