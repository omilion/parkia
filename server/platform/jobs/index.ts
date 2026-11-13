import { hostname } from "os";
import { cleanupExpiredSessions } from "../../auth/sessions";
import { ensureUpcomingReceivables, refreshOverduePayments } from "../../billing";
import { db } from "../../db";
import { dteService } from "../../modules/dte/instance";
import { reconcilePendingIntents } from "../../modules/payments/service";
import { processMailOutbox } from "../mail";
import { refreshOverdueExpenses } from "../../modules/finance/shared";
import { runSubscriptionLifecycleJob } from "../../modules/saas/lifecycle";
import { runPrivacyRetentionJob } from "../../modules/saas/privacy";
import { syncUfFromProvider } from "../../modules/saas/uf";
import { pruneExpiredLoginAttempts } from "../auth/repo";
import { lastScheduledSlot, parseCron, type CronSpec } from "./cron";
import { logStructured } from "../http/logger";

export type JobName =
  | "receivables.generate"
  | "payments.refresh-overdue"
  | "sessions.cleanup"
  | "dte.send-pending"
  | "dte.poll-status"
  | "payments.reconcile"
  | "mail.send-pending"
  | "subscriptions.lifecycle"
  | "privacy.retention"
  | "uf.sync";

export type JobDefinition = {
  name: JobName;
  cron: string;
  description: string;
  /** Tiempo maximo de una ejecucion (por omision 5 minutos). Una tarea colgada no debe retrasar a las demas. */
  timeoutMs?: number;
  handler: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export async function cleanupExpiredPasswordResets(): Promise<number> {
  try {
    const result = await db
      .prepare("DELETE FROM auth_password_resets WHERE expires_at <= datetime('now') OR used_at IS NOT NULL")
      .run();
    return result.changes;
  } catch {
    return 0;
  }
}

export const JOB_DEFINITIONS: Record<JobName, JobDefinition> = {
  "receivables.generate": {
    name: "receivables.generate",
    cron: "0 3 * * *",
    description: "Genera cobros futuros para contratos abiertos (diario 03:00)",
    handler: async () => {
      const result = await ensureUpcomingReceivables();
      return {
        job: "receivables.generate",
        ...result,
      };
    },
  },
  "payments.refresh-overdue": {
    name: "payments.refresh-overdue",
    cron: "10 3 * * *",
    description: "Actualiza estado vencido de cobros y gastos (diario 03:10)",
    handler: async () => {
      const updatedPayments = await refreshOverduePayments();
      await refreshOverdueExpenses();
      return {
        job: "payments.refresh-overdue",
        updatedPayments,
      };
    },
  },
  "sessions.cleanup": {
    name: "sessions.cleanup",
    cron: "0 * * * *",
    description: "Limpia sesiones, intentos de login y tokens de reseteo expirados (cada hora)",
    handler: async () => {
      await cleanupExpiredSessions();
      const loginAttemptsDeleted = await pruneExpiredLoginAttempts();
      const passwordResetsDeleted = await cleanupExpiredPasswordResets();
      const jobRunsDeleted = await pruneJobRuns();
      await failStaleJobRuns();
      return {
        job: "sessions.cleanup",
        loginAttemptsDeleted,
        passwordResetsDeleted,
        jobRunsDeleted,
      };
    },
  },
  "dte.send-pending": {
    name: "dte.send-pending",
    cron: "*/15 * * * *",
    description: "Emite boletas pendientes y envia al SII los documentos en cola (cada 15 minutos)",
    handler: async () => {
      const reconciled = await dteService.reconcileAllTenants();
      const sent = await dteService.sendPending();
      return { job: "dte.send-pending", reconciled, sent };
    },
  },
  "dte.poll-status": {
    name: "dte.poll-status",
    cron: "*/15 * * * *",
    description: "Consulta al SII el resultado de los envios pendientes (cada 15 minutos)",
    handler: async () => {
      const polled = await dteService.pollStatuses();
      return { job: "dte.poll-status", polled };
    },
  },
  "payments.reconcile": {
    name: "payments.reconcile",
    cron: "*/15 * * * *",
    description: "Confirma pagos en linea que la pasarela cobro y vence los intentos abandonados (cada 15 minutos)",
    handler: async () => ({ job: "payments.reconcile", ...(await reconcilePendingIntents()) }),
  },
  "mail.send-pending": {
    name: "mail.send-pending",
    cron: "*/15 * * * *",
    description: "Reintenta los correos que no pudieron enviarse y limpia los antiguos (cada 15 minutos)",
    handler: async () => ({ job: "mail.send-pending", ...(await processMailOutbox()) }),
  },
  "subscriptions.lifecycle": {
    name: "subscriptions.lifecycle",
    cron: "0 4 * * *",
    description: "Evalua vencimientos de trial, gracia de 7 dias y suspension de suscripciones (diario 04:00)",
    handler: async () => ({ job: "subscriptions.lifecycle", ...(await runSubscriptionLifecycleJob()) }),
  },
  "privacy.retention": {
    name: "privacy.retention",
    cron: "30 4 * * *",
    description: "Anonimiza tickets vencidos y purga registros expirados segun Ley 21.719 (diario 04:30)",
    handler: async () => ({ job: "privacy.retention", ...(await runPrivacyRetentionJob()) }),
  },
  "uf.sync": {
    name: "uf.sync",
    cron: "15 8 * * *",
    description: "Sincroniza el valor diario de la UF desde mindicador.cl (diario 08:15)",
    handler: async () => ({ job: "uf.sync", ...(await syncUfFromProvider()) }),
  },
};

export async function runJobNow(name: JobName): Promise<Record<string, unknown>> {
  const def = JOB_DEFINITIONS[name];
  if (!def) throw new Error(`Job desconocido: ${name}`);
  return await def.handler();
}

export async function runAllScheduledJobsOnce(): Promise<Record<JobName, Record<string, unknown>>> {
  const receivables = await runJobNow("receivables.generate");
  const overdue = await runJobNow("payments.refresh-overdue");
  const sessions = await runJobNow("sessions.cleanup");
  // El SII es externo: una falla ahi nunca debe detener las tareas internas.
  const dteSend = await runJobNow("dte.send-pending").catch(error => ({ job: "dte.send-pending", error: String(error?.message || error) }));
  const dtePoll = await runJobNow("dte.poll-status").catch(error => ({ job: "dte.poll-status", error: String(error?.message || error) }));
  const payments = await runJobNow("payments.reconcile").catch(error => ({ job: "payments.reconcile", error: String(error?.message || error) }));
  const mail = await runJobNow("mail.send-pending").catch(error => ({ job: "mail.send-pending", error: String(error?.message || error) }));
  const subscriptions = await runJobNow("subscriptions.lifecycle").catch(error => ({ job: "subscriptions.lifecycle", error: String(error?.message || error) }));
  const privacy = await runJobNow("privacy.retention").catch(error => ({ job: "privacy.retention", error: String(error?.message || error) }));
  const uf = await runJobNow("uf.sync").catch(error => ({ job: "uf.sync", error: String(error?.message || error) }));
  return {
    "receivables.generate": receivables,
    "payments.refresh-overdue": overdue,
    "sessions.cleanup": sessions,
    "dte.send-pending": dteSend,
    "dte.poll-status": dtePoll,
    "payments.reconcile": payments,
    "mail.send-pending": mail,
    "subscriptions.lifecycle": subscriptions,
    "privacy.retention": privacy,
    "uf.sync": uf,
  };
}

// ---------------------------------------------------------------- planificador
// Cada job corre en su hora (campo `cron`, en America/Santiago). Para cada ejecucion programada hay una fila
// en job_runs con UNIQUE(job_name, slot): quien logra insertarla la ejecuta, asi que con varias instancias o
// con un reinicio justo a la hora nunca corre dos veces. Si el servidor estuvo caido a la hora programada, al
// volver se recupera la ultima ejecucion pendiente (hasta 26 horas atras).
const JOB_RUN_RETENTION_DAYS = 30;
const DEFAULT_JOB_TIMEOUT_MS = 5 * 60_000;
const CATCH_UP_MINUTES = 26 * 60;
const MAX_RESULT_CHARS = 4000;
const instanceId = `${hostname()}:${process.pid}`;
const specs = new Map<JobName, CronSpec>();
const claimedSlots = new Map<JobName, string>();

function specFor(name: JobName): CronSpec {
  let spec = specs.get(name);
  if (!spec) {
    spec = parseCron(JOB_DEFINITIONS[name].cron);
    specs.set(name, spec);
  }
  return spec;
}

export async function pruneJobRuns(): Promise<number> {
  try {
    const result = await db.prepare(`DELETE FROM job_runs WHERE started_at < datetime('now', '-${JOB_RUN_RETENTION_DAYS} days')`).run();
    return result.changes;
  } catch {
    return 0;
  }
}

/**
 * Una ejecucion que sigue "running" mucho despues de su tiempo maximo quedo huerfana: el servidor se reinicio o cayo
 * a mitad de la tarea. Se marca como fallida para que el historial y el chequeo de salud no mientan.
 */
export async function failStaleJobRuns(): Promise<number> {
  try {
    const result = await db.prepare(`
      UPDATE job_runs
      SET status = 'error', finished_at = CURRENT_TIMESTAMP, error = 'Interrumpida: no termino (reinicio o caida del servidor)'
      WHERE status = 'running' AND started_at < datetime('now', '-15 minutes')
    `).run();
    return result.changes;
  } catch {
    return 0;
  }
}

export type JobRunOutcome = { job: JobName; slot: string; ran: boolean; status?: "ok" | "error"; error?: string };

/** Reclama la ejecucion `slot` del job y la corre. `ran: false` si otra instancia (o una vuelta anterior) ya la tomo. */
export async function claimAndRunJob(name: JobName, slot: string): Promise<JobRunOutcome> {
  const claim = await db.prepare("INSERT OR IGNORE INTO job_runs (job_name, slot, instance) VALUES (?, ?, ?)").run(name, slot, instanceId);
  if (!claim.changes) return { job: name, slot, ran: false };
  const startedAt = Date.now();
  const timeoutMs = JOB_DEFINITIONS[name].timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Los jobs corren en serie: si uno espera para siempre (una API externa que no responde), el planificador
    // lo da por fallido y sigue con los demas. El trabajo ya iniciado no se puede abortar, pero deja de bloquear.
    const result = await Promise.race([
      Promise.resolve(JOB_DEFINITIONS[name].handler()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tiempo agotado: la tarea supero ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
      }),
    ]);
    await db.prepare("UPDATE job_runs SET status = 'ok', finished_at = CURRENT_TIMESTAMP, duration_ms = ?, result_json = ? WHERE job_name = ? AND slot = ?")
      .run(Date.now() - startedAt, JSON.stringify(result).slice(0, MAX_RESULT_CHARS), name, slot);
    return { job: name, slot, ran: true, status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStructured("error", "job failed", { job: name, slot, error: message });
    await db.prepare("UPDATE job_runs SET status = 'error', finished_at = CURRENT_TIMESTAMP, duration_ms = ?, error = ? WHERE job_name = ? AND slot = ?")
      .run(Date.now() - startedAt, message.slice(0, MAX_RESULT_CHARS), name, slot).catch(() => undefined);
    return { job: name, slot, ran: true, status: "error", error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Una vuelta del planificador: corre lo que toca y lo que quedo pendiente. Un job que falla no detiene a los demas. */
export async function runDueJobs(now: Date = new Date()): Promise<JobRunOutcome[]> {
  const outcomes: JobRunOutcome[] = [];
  for (const name of Object.keys(JOB_DEFINITIONS) as JobName[]) {
    const slot = lastScheduledSlot(specFor(name), now, CATCH_UP_MINUTES);
    if (!slot || claimedSlots.get(name) === slot) continue;
    claimedSlots.set(name, slot);
    outcomes.push(await claimAndRunJob(name, slot));
  }
  return outcomes;
}

/** Ultimas ejecuciones por job (para diagnostico y el chequeo de salud). */
export async function getJobsStatus(): Promise<Array<{ job_name: string; status: string; slot: string; started_at: string; duration_ms: number | null; error: string | null }>> {
  return await db.prepare(`
    SELECT r.job_name, r.status, r.slot, r.started_at, r.duration_ms, r.error
    FROM job_runs r
    JOIN (SELECT job_name, MAX(id) AS id FROM job_runs GROUP BY job_name) latest ON latest.id = r.id
    ORDER BY r.job_name
  `).all() as Array<{ job_name: string; status: string; slot: string; started_at: string; duration_ms: number | null; error: string | null }>;
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const text = String(value ?? "");
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(text);
  return new Date(hasZone ? text : `${text.replace(" ", "T")}Z`).getTime() || 0;
}

/** Minutos desde la ultima ejecucion de cualquier job (null si nunca corrio) y los jobs cuya ultima ejecucion fallo. */
export async function getSchedulerHealth(now: number = Date.now()): Promise<{ minutesIdle: number | null; failedJobs: string[] }> {
  const rows: Awaited<ReturnType<typeof getJobsStatus>> = await getJobsStatus().catch(() => []);
  const newest = rows.reduce((latest, row) => Math.max(latest, toMillis(row.started_at)), 0);
  return {
    minutesIdle: newest ? Math.round((now - newest) / 60_000) : null,
    failedJobs: rows.filter(row => row.status === "error").map(row => row.job_name),
  };
}

let activeInterval: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tick() {
  if (ticking) return; // una vuelta lenta no se solapa con la siguiente
  ticking = true;
  try {
    await runDueJobs();
  } catch (error) {
    logStructured("error", "job scheduler tick failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    ticking = false;
  }
}

export function startBackgroundJobs(options: { runOnStart?: boolean; tickMs?: number } = {}) {
  const { runOnStart = true, tickMs = 30_000 } = options;

  if (runOnStart) void failStaleJobRuns().then(() => tick()); // cierra lo que quedo a medias y recupera lo pendiente

  if (!activeInterval && process.env.NODE_ENV !== "test") {
    activeInterval = setInterval(() => { void tick(); }, tickMs);
    if (typeof activeInterval.unref === "function") activeInterval.unref();
  }

  return {
    stop() {
      if (activeInterval) {
        clearInterval(activeInterval);
        activeInterval = null;
      }
    },
  };
}
