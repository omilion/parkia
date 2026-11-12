import { cleanupExpiredSessions } from "../../auth/sessions";
import { ensureUpcomingReceivables, refreshOverduePayments } from "../../billing";
import { db } from "../../db";
import { refreshOverdueExpenses } from "../../modules/finance/shared";
import { pruneExpiredLoginAttempts } from "../auth/repo";

export type JobName =
  | "receivables.generate"
  | "payments.refresh-overdue"
  | "sessions.cleanup";

export type JobDefinition = {
  name: JobName;
  cron: string;
  description: string;
  handler: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export function cleanupExpiredPasswordResets(): number {
  try {
    const result = db
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
    handler: () => {
      const result = ensureUpcomingReceivables();
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
    handler: () => {
      const updatedPayments = refreshOverduePayments();
      refreshOverdueExpenses();
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
    handler: () => {
      cleanupExpiredSessions();
      const loginAttemptsDeleted = pruneExpiredLoginAttempts();
      const passwordResetsDeleted = cleanupExpiredPasswordResets();
      return {
        job: "sessions.cleanup",
        loginAttemptsDeleted,
        passwordResetsDeleted,
      };
    },
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
  return {
    "receivables.generate": receivables,
    "payments.refresh-overdue": overdue,
    "sessions.cleanup": sessions,
  };
}

let activeInterval: ReturnType<typeof setInterval> | null = null;

export function startBackgroundJobs(options: { runOnStart?: boolean; intervalMs?: number } = {}) {
  const { runOnStart = true, intervalMs = 15 * 60 * 1000 } = options;

  if (runOnStart) {
    try {
      void runAllScheduledJobsOnce();
    } catch {
      // Non-fatal on startup
    }
  }

  if (!activeInterval && process.env.NODE_ENV !== "test") {
    activeInterval = setInterval(() => {
      void runAllScheduledJobsOnce();
    }, intervalMs);
    if (typeof activeInterval.unref === "function") {
      activeInterval.unref();
    }
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

