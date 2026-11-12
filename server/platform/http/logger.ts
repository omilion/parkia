import type { Request } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = {
  level: LogLevel;
  time: string;
  request_id?: string | null;
  tenant_id?: number | null;
  msg: string;
  [key: string]: unknown;
};

export type CapturedException = {
  error: string;
  stack?: string;
  request_id?: string | null;
  method?: string;
  path?: string;
  dsn_configured: boolean;
  timestamp: string;
};

const recentExceptions: CapturedException[] = [];

export function formatStructuredLog(record: LogRecord): string {
  return JSON.stringify(record);
}

export function logStructured(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const record: LogRecord = {
    level,
    time: new Date().toISOString(),
    msg,
    ...fields,
  };

  if (process.env.PARKIA_LOG_FORMAT === "json" || process.env.NODE_ENV === "production") {
    const out = formatStructuredLog(record);
    if (level === "error") {
      console.error(out);
    } else {
      console.log(out);
    }
  }
  return record;
}

export function captureException(error: unknown, req?: Request): CapturedException {
  const dsn = process.env.PARKIA_SENTRY_DSN || process.env.SENTRY_DSN || "";
  const errObj = error instanceof Error ? error : new Error(String(error));
  const requestId = (req as (Request & { requestId?: string }) | undefined)?.requestId || null;

  const entry: CapturedException = {
    error: errObj.message,
    stack: errObj.stack,
    request_id: requestId,
    method: req?.method,
    path: req?.path,
    dsn_configured: Boolean(dsn),
    timestamp: new Date().toISOString(),
  };

  recentExceptions.push(entry);
  if (recentExceptions.length > 50) {
    recentExceptions.shift();
  }

  return entry;
}

export function getRecentCapturedExceptions(): CapturedException[] {
  return [...recentExceptions];
}

