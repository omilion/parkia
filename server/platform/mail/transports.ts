import nodemailer from "nodemailer";
import { logStructured } from "../http/logger";
import { MailDeliveryError, type MailMessage, type MailTransport } from "./types";

/** Correos "enviados" por el transporte de memoria. Solo para pruebas. */
export const memoryOutbox: Array<MailMessage & { from: string }> = [];
export function resetMemoryOutbox() {
  memoryOutbox.length = 0;
}

export function createMemoryTransport(): MailTransport {
  return {
    id: "memory",
    async send(message, from) {
      memoryOutbox.push({ ...message, from });
      return { providerId: `memory-${memoryOutbox.length}` };
    },
  };
}

/** Desarrollo: escribe el correo en la consola para poder abrir los enlaces. Nunca se usa en produccion. */
export function createConsoleTransport(): MailTransport {
  return {
    id: "console",
    async send(message, from) {
      console.log(`\n[correo simulado] De: ${from}\nPara: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n`);
      return { providerId: null };
    },
  };
}

export function createDisabledTransport(): MailTransport {
  return {
    id: "disabled",
    async send() {
      throw new MailDeliveryError("El envio de correos no esta configurado", false);
    },
  };
}

type Transporter = Pick<ReturnType<typeof nodemailer.createTransport>, "sendMail">;

/** SMTP (Amazon SES SMTP, Mailgun, Google Workspace, un servidor propio). Ejemplo de URL: smtps://usuario:clave@host:465 */
export function createSmtpTransport(options: { url: string; transporter?: Transporter }): MailTransport {
  const transporter: Transporter = options.transporter ?? nodemailer.createTransport(options.url, { connectionTimeout: 10_000, socketTimeout: 20_000 });
  return {
    id: "smtp",
    async send(message, from) {
      try {
        const info = await transporter.sendMail({ from, to: message.to, subject: message.subject, text: message.text, html: message.html, replyTo: message.replyTo });
        return { providerId: info.messageId ?? null };
      } catch (error) {
        const code = Number((error as { responseCode?: number })?.responseCode);
        // 5xx de SMTP = rechazo definitivo (casilla inexistente, dominio invalido): reintentar no sirve.
        const permanent = Number.isFinite(code) && code >= 500 && code < 600;
        throw new MailDeliveryError(`SMTP: ${(error as Error)?.message ?? "error desconocido"}`, !permanent);
      }
    },
  };
}

/** Resend (API HTTP). No requiere dependencias: usa fetch. */
export function createResendTransport(options: { apiKey: string; fetchImpl?: typeof fetch }): MailTransport {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: "resend",
    async send(message, from) {
      let response: Response;
      try {
        response = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text, reply_to: message.replyTo }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        throw new MailDeliveryError(`Resend no respondio: ${(error as Error)?.name === "TimeoutError" ? "tiempo agotado" : "error de red"}`, true);
      }
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (response.ok) return { providerId: body.id ?? null };
      // 4xx (salvo 429) son errores de la solicitud: reintentar no los arregla.
      const retryable = response.status >= 500 || response.status === 429;
      throw new MailDeliveryError(`Resend rechazo el envio (HTTP ${response.status})${body.message ? `: ${body.message}` : ""}`, retryable);
    },
  };
}

// ------------------------------------------------------------------ seleccion por entorno
export type MailConfig = {
  transport: MailTransport["id"];
  from: string;
  configured: boolean;
  problem: string | null;
};

const DEFAULT_FROM = "Parkia <no-reply@parkia.local>";

/**
 * PARKIA_MAIL_TRANSPORT = console | memory | smtp | resend | disabled.
 * Sin definirlo: memoria en pruebas, consola en desarrollo y deshabilitado en produccion
 * (en produccion nunca se "simula" un envio).
 */
export function getMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const declared = (env.PARKIA_MAIL_TRANSPORT || "").trim().toLowerCase();
  const fallback = env.NODE_ENV === "test" ? "memory" : env.NODE_ENV === "production" ? "disabled" : "console";
  const transport = (["console", "memory", "smtp", "resend", "disabled"].includes(declared) ? declared : fallback) as MailTransport["id"];
  const from = (env.PARKIA_MAIL_FROM || "").trim() || DEFAULT_FROM;

  let problem: string | null = null;
  if (declared && declared !== transport) problem = `PARKIA_MAIL_TRANSPORT="${declared}" no es valido`;
  else if (transport === "smtp" && !env.PARKIA_SMTP_URL) problem = "Falta PARKIA_SMTP_URL";
  else if (transport === "resend" && !env.RESEND_API_KEY) problem = "Falta RESEND_API_KEY";
  else if ((transport === "smtp" || transport === "resend") && !env.PARKIA_MAIL_FROM) problem = "Falta PARKIA_MAIL_FROM (remitente verificado)";
  else if (transport === "console" && env.NODE_ENV === "production") problem = "El transporte de consola no puede usarse en produccion";
  else if (transport === "disabled") problem = "El envio de correos esta deshabilitado";

  return { transport, from, configured: problem === null && transport !== "disabled", problem };
}

let override: MailTransport | undefined;
/** Solo para pruebas: fuerza un transporte concreto. */
export function setMailTransportForTesting(transport: MailTransport | undefined) {
  override = transport;
}

let memory: MailTransport | undefined;

export function resolveMailTransport(env: NodeJS.ProcessEnv = process.env): MailTransport {
  if (override) return override;
  const config = getMailConfig(env);
  if (config.problem && config.transport !== "disabled") {
    logStructured("warn", "mail.misconfigured", { problem: config.problem });
    return createDisabledTransport();
  }
  switch (config.transport) {
    case "memory": return (memory ??= createMemoryTransport());
    case "console": return createConsoleTransport();
    case "smtp": return createSmtpTransport({ url: env.PARKIA_SMTP_URL! });
    case "resend": return createResendTransport({ apiKey: env.RESEND_API_KEY! });
    default: return createDisabledTransport();
  }
}
