/**
 * Reporte de errores a Sentry. Solo se activa con PARKIA_SENTRY_DSN (o SENTRY_DSN); sin él no se carga el SDK.
 *
 * Privacidad: Parkia maneja patentes, RUT y tokens de pago. Al evento solo viaja el mensaje, el stack, el id de
 * la solicitud, el método y la ruta (con los tokens de las URL reemplazados). Nunca cookies, cabeceras, cuerpos,
 * query string ni IP.
 */
import type * as SentryNode from "@sentry/node";

type SentryModule = typeof SentryNode;
type SentryTransport = NonNullable<Parameters<SentryModule["init"]>[0]>["transport"];

export type ErrorContext = {
  request_id?: string | null;
  method?: string;
  path?: string;
  tenant_id?: number | null;
  [key: string]: unknown;
};

let sentry: SentryModule | null = null;

export function configuredSentryDsn(): string {
  return process.env.PARKIA_SENTRY_DSN || process.env.SENTRY_DSN || "";
}

/** Segmentos largos y opacos de una ruta (tokens de ticket, de pago, de reseteo) no deben salir de Parkia. */
export function scrubPath(path: string | undefined): string | undefined {
  if (!path) return path;
  return path.split("?")[0].replace(/[A-Za-z0-9_-]{20,}/g, ":token");
}

const SENSITIVE_KEYS = /authorization|cookie|token|password|clave|secret|rut|set-cookie/i;

/** Quita de un evento de Sentry todo lo que pueda identificar a una persona o dar acceso. */
export function scrubEvent<T extends SentryNode.ErrorEvent>(event: T): T {
  delete event.user;
  if (event.request) {
    event.request = { method: event.request.method, url: scrubPath(event.request.url) };
  }
  if (event.extra) {
    for (const key of Object.keys(event.extra)) if (SENSITIVE_KEYS.test(key)) delete event.extra[key];
  }
  if (event.transaction) event.transaction = scrubPath(event.transaction);
  return event;
}

export async function initErrorReporting(options: { dsn?: string; transport?: SentryTransport } = {}): Promise<boolean> {
  const dsn = options.dsn ?? configuredSentryDsn();
  if (!dsn || sentry) return Boolean(sentry);
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    environment: process.env.PARKIA_ENV || process.env.NODE_ENV || "development",
    release: process.env.PARKIA_RELEASE || undefined,
    // Todo lo que el SDK recolecta por omisión (usuario, cookies, cabeceras, cuerpos, query) se apaga a proposito.
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0, // solo errores; el rendimiento se mide aparte
    beforeSend: event => scrubEvent(event),
    ...(options.transport ? { transport: options.transport } : {}),
  });
  sentry = Sentry;
  return true;
}

export function isErrorReportingActive(): boolean {
  return sentry !== null;
}

/** Envía el error a Sentry si está activo; nunca lanza (un fallo al reportar no debe romper la solicitud). */
export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!sentry) return;
  try {
    const { request_id, method, path, tenant_id, ...rest } = context;
    sentry.withScope(scope => {
      if (request_id) scope.setTag("request_id", request_id);
      if (method) scope.setTag("http.method", method);
      if (tenant_id) scope.setTag("tenant_id", String(tenant_id));
      if (path) scope.setTag("http.path", scrubPath(path) ?? "");
      scope.setExtras(rest);
      sentry!.captureException(error);
    });
  } catch {
    // El reporte es de mejor esfuerzo.
  }
}

/** Espera a que salgan los eventos pendientes (antes de cerrar el proceso tras un error fatal). */
export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  await sentry.flush(timeoutMs).catch(() => undefined);
}

/** Solo para pruebas: apaga el SDK y deja el módulo como recién cargado. */
export async function resetErrorReportingForTesting(): Promise<void> {
  if (sentry) await sentry.close(500).catch(() => undefined);
  sentry = null;
}
