import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OperatorOperation } from '../../../../shared/schemas/operator';
import { loadSnapshot, saveSnapshot } from './db';
import { projectTickets } from './projection';
import { discardOperation, enqueueOperation, listOps, purgeReflectedOps, queueEvents } from './queue';
import { flushQueue, probeServer } from './sync';
import type { LocalOp, ProjectedTicket, StoredSnapshot } from './types';

const PROBE_INTERVAL_MS = 20_000;
const REFRESH_INTERVAL_MS = 30_000;

export type OperatorOfflineState = {
  /** El servidor responde (no solo "hay wifi"). */
  online: boolean;
  syncing: boolean;
  /** La sesión venció: hay operaciones guardadas que no se pueden enviar hasta iniciar sesión. */
  authError: boolean;
  snapshot: StoredSnapshot | null;
  tickets: ProjectedTicket[];
  ops: LocalOp[];
  pendingCount: number;
  rejected: LocalOp[];
  lastSyncAt: string | null;
};

/**
 * Une la cola local, la instantánea de la sucursal y la conectividad.
 * Con red: descarga la instantánea, envía lo pendiente y la vuelve a descargar.
 * Sin red: trabaja con la última instantánea más las operaciones locales (ver `projectTickets`).
 */
export function useOperatorOffline(branchId: number | null) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null>(null);
  const [ops, setOps] = useState<LocalOp[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const branchRef = useRef(branchId);
  branchRef.current = branchId;

  const reloadOps = useCallback(async () => setOps(await listOps()), []);

  // Instantánea guardada: la pantalla funciona desde el primer instante, incluso sin red.
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    if (branchId) void loadSnapshot(branchId).then(stored => { if (!cancelled) setSnapshot(stored ?? null); });
    return () => { cancelled = true; };
  }, [branchId]);

  useEffect(() => {
    void reloadOps();
    return queueEvents.subscribe(() => { void reloadOps(); });
  }, [reloadOps]);

  /** Descarga la instantánea de la sucursal. Devuelve false si no hay red. */
  const refresh = useCallback(async () => {
    const id = branchRef.current;
    if (!id) return false;
    try {
      const response = await fetch(`/api/operator/snapshot?branch_id=${id}`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || response.status === 403) { setAuthError(true); return true; }
      if (!response.ok) return false;
      const data = await response.json();
      await saveSnapshot(id, data);
      await purgeReflectedOps(data.server_time);
      if (branchRef.current === id) setSnapshot(await loadSnapshot(id) ?? null);
      setAuthError(false);
      setOnline(true);
      setLastSyncAt(new Date().toISOString());
      return true;
    } catch {
      setOnline(false);
      return false;
    }
  }, []);

  /** Envía lo pendiente y refresca. Seguro de llamar muchas veces: la cola serializa los envíos. */
  const flush = useCallback(async () => {
    setSyncing(true);
    try {
      const outcome = await flushQueue();
      if (outcome.authError) setAuthError(true);
      if (outcome.networkError) setOnline(false);
      if (outcome.processed > 0 || !outcome.networkError) await refresh();
      return outcome;
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const pendingCount = useMemo(() => ops.filter(op => op.status === 'pending').length, [ops]);

  // Conectividad: eventos del navegador + comprobación periódica contra el servidor.
  useEffect(() => {
    const check = async () => { const ok = await probeServer(); setOnline(ok); return ok; };
    const goOffline = () => setOnline(false);
    const goOnline = () => { void check(); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVisible);
    void check();
    const timer = window.setInterval(() => { void check(); }, PROBE_INTERVAL_MS);
    return () => {
      window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline);
      document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer);
    };
  }, []);

  // Al recuperar la red (o cambiar de sucursal): enviar pendientes y refrescar. Mientras haya red: refresco periódico.
  useEffect(() => {
    if (!online || !branchId) return;
    void flush();
    const timer = window.setInterval(() => { void flush(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [online, branchId, flush]);

  const branchOps = useMemo(() => ops.filter(op => op.branch_id === branchId), [ops, branchId]);
  const tickets = useMemo(() => projectTickets(snapshot?.tickets ?? [], branchOps), [snapshot, branchOps]);
  const rejected = useMemo(() => ops.filter(op => op.status === 'rejected'), [ops]);

  const enqueue = useCallback(async (operation: OperatorOperation) => {
    if (!branchRef.current) throw new Error('Selecciona una sucursal');
    const op = await enqueueOperation(branchRef.current, operation);
    if (navigator.onLine) void flush();
    return op;
  }, [flush]);

  return {
    state: { online, syncing, authError, snapshot, tickets, ops: branchOps, pendingCount, rejected, lastSyncAt } satisfies OperatorOfflineState,
    enqueue, flush, refresh, discard: discardOperation,
    /** Los envíos al servidor que fallan por red avisan aquí para pasar a modo sin conexión de inmediato. */
    markOffline: () => setOnline(false),
  };
}
