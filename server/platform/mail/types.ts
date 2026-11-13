/**
 * Contrato del modulo de correo. Quien envia un correo (recuperacion de clave, verificacion,
 * avisos de cobranza, boletas) usa `sendMail` con una plantilla; nunca habla con un proveedor.
 */

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export type MailSendResult = { providerId: string | null };

export interface MailTransport {
  readonly id: "console" | "memory" | "smtp" | "resend" | "disabled";
  send(message: MailMessage, from: string): Promise<MailSendResult>;
}

/** Error de entrega. `retryable` indica si tiene sentido reintentar (caida de red, 5xx) o no (direccion invalida, 4xx). */
export class MailDeliveryError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = "MailDeliveryError";
  }
}

export type SendMailStatus = "sent" | "queued" | "skipped" | "duplicate" | "failed";
export type SendMailResult = { status: SendMailStatus; id: number | null };
