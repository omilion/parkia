import type { OperationResult } from '../../../../shared/schemas/operator';
import { applyResults, isNetworkFailure, markAttempt, pendingOps, rejectBatch } from './queue';

export type FlushOutcome = {
  /** Operaciones enviadas y respondidas por el servidor. */
  processed: number;
  /** El servidor no fue alcanzable o falló: quedan pendientes para reintentar. */
  networkError: boolean;
  /** La sesión venció: hay que iniciar sesión de nuevo antes de poder sincronizar. */
  authError: boolean;
  /** Hora del servidor de la última respuesta (sirve para limpiar operaciones ya reflejadas). */
  serverTime: string | null;
};

const BATCH_SIZE = 50;
let running: Promise<FlushOutcome> | null = null;

/**
 * Envía al servidor las operaciones pendientes, en orden y por lotes.
 *  - Nunca corre dos veces a la vez (un reenvío concurrente solo produciría duplicados que el servidor ignora).
 *  - Una caída de red deja todo pendiente; el reintento es seguro porque el servidor es idempotente por client_uuid.
 *  - Un 400 (formato inválido) marca el lote como rechazado: reenviarlo nunca funcionaría.
 */
export function flushQueue(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<FlushOutcome> {
  if (running) return running;
  running = (async () => {
    const outcome: FlushOutcome = { processed: 0, networkError: false, authError: false, serverTime: null };
    try {
      for (;;) {
        const batch = (await pendingOps()).slice(0, BATCH_SIZE);
        if (!batch.length) break;
        const uuids = batch.map(op => op.client_uuid);

        let response: Response;
        try {
          response = await fetchImpl('/api/operator/sync', {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operations: batch.map(op => op.operation) }),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (error) {
          if (!isNetworkFailure(error)) throw error;
          await markAttempt(uuids, 'Sin conexión con el servidor');
          outcome.networkError = true;
          break;
        }

        if (response.status === 401 || response.status === 403) { outcome.authError = true; break; }
        if (response.status === 400) {
          const body = await response.json().catch(() => ({}));
          await rejectBatch(uuids, 'INVALID', (body as { error?: string }).error ?? 'El servidor no reconoció el formato de la operación');
          continue;
        }
        if (!response.ok) {
          await markAttempt(uuids, `El servidor respondió ${response.status}`);
          outcome.networkError = true;
          break;
        }
        const body = await response.json() as { server_time: string; results: OperationResult[] };
        await applyResults(body.results, body.server_time);
        outcome.processed += body.results.length;
        outcome.serverTime = body.server_time;
        // Si el servidor no respondió por alguna operación del lote, no se vuelve a pedir en bucle.
        const answered = new Set(body.results.map(result => result.client_uuid));
        if (uuids.some(uuid => !answered.has(uuid))) { outcome.networkError = true; break; }
      }
    } finally {
      running = null;
    }
    return outcome;
  })();
  return running;
}

/** Comprueba si el servidor responde (navigator.onLine miente con redes sin salida a internet). */
export async function probeServer(fetchImpl: typeof fetch = (input, init) => fetch(input, init), timeoutMs = 4000) {
  try {
    const response = await fetchImpl('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    return response.status < 500;
  } catch {
    return false;
  }
}
