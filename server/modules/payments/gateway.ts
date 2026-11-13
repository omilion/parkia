import { createHmac, timingSafeEqual } from "node:crypto";
import { getMasterKey } from "../../platform/secrets";

/**
 * Contrato comun de las pasarelas de pago. Cada adaptador (Webpay Plus, mock, y despues
 * Mercado Pago / POS) implementa esta interfaz; el resto del sistema no conoce sus detalles.
 */

export type ChargeRequest = {
  /** Numero de orden unico por intento (maximo 26 caracteres, exigencia de Transbank). */
  buyOrder: string;
  amount: number;
  /** Direccion a la que la pasarela devuelve al cliente despues de pagar. */
  returnUrl: string;
  /** Referencia opaca de sesion (id publico del intento). */
  sessionId: string;
};

export type Redirect = { url: string; method: "GET" | "POST"; fields: Record<string, string> };

export type ChargeResult = { providerToken: string; redirect: Redirect };

export type ChargeState = "paid" | "failed" | "cancelled" | "pending";

export type ChargeStatus = {
  state: ChargeState;
  authorizationCode?: string | null;
  cardLast4?: string | null;
  /** Monto que la pasarela dice haber cobrado; se compara con el del intento. */
  amount?: number | null;
  reason?: string | null;
  raw?: unknown;
};

export type WebhookEvent = {
  /** Id del evento en la pasarela; sirve para no procesar dos veces el mismo aviso. */
  eventId: string;
  providerToken: string;
  status: ChargeStatus;
};

export type RefundResult = { ok: boolean; raw?: unknown; reason?: string };

export interface PaymentGateway {
  readonly id: "webpay" | "mock";
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  /** Como volver a enviar al cliente a una sesion de pago ya creada. */
  redirectFor(providerToken: string): Redirect;
  /**
   * Cierra la transaccion luego del retorno del cliente. En Webpay es el "commit": hasta que se
   * ejecuta, el cargo no esta confirmado. Es idempotente: si ya estaba confirmado devuelve su estado.
   */
  confirm(providerToken: string): Promise<ChargeStatus>;
  getStatus(providerToken: string): Promise<ChargeStatus>;
  refund(providerToken: string, amount: number): Promise<RefundResult>;
  /** Valida la firma y devuelve el evento; lanza `WebhookSignatureError` si no es autentico. null = no aplica. */
  parseWebhook(input: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer }): WebhookEvent | null;
}

export class PaymentGatewayError extends Error {
  constructor(message: string, readonly status = 502, readonly code = "GATEWAY_ERROR") {
    super(message);
    this.name = "PaymentGatewayError";
  }
}

export class WebhookSignatureError extends Error {
  constructor(message = "Firma de webhook invalida") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

// ------------------------------------------------------------------ firma de webhooks
const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

/** Secreto de los webhooks, derivado de la clave maestra: no se guarda ni se configura aparte. */
export function webhookSecret(): Buffer {
  return createHmac("sha256", getMasterKey()).update("parkia.payments.webhook").digest();
}

export function signWebhook(rawBody: Buffer | string, timestamp: number = Date.now()) {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody;
  const signature = createHmac("sha256", webhookSecret()).update(`${timestamp}.`).update(body).digest("hex");
  return { timestamp: String(timestamp), signature: `sha256=${signature}` };
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, rawBody: Buffer, now = Date.now()) {
  const timestamp = header(headers, "x-parkia-timestamp");
  const signature = header(headers, "x-parkia-signature");
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) throw new WebhookSignatureError("Faltan los encabezados de firma");
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_MS) throw new WebhookSignatureError("El aviso esta fuera de la ventana de tiempo permitida");
  const expected = Buffer.from(signWebhook(rawBody, Number(timestamp)).signature);
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new WebhookSignatureError();
}

// ------------------------------------------------------------------ pasarela de pruebas
/**
 * Pasarela simulada para desarrollo, pruebas y demostraciones. El cliente "paga" en una pantalla
 * propia y el resultado llega como un webhook firmado, igual que con una pasarela real.
 * No se habilita en produccion.
 */
export function createMockGateway(): PaymentGateway {
  let sequence = 0;
  return {
    id: "mock",
    async createCharge(request) {
      sequence += 1;
      const providerToken = `mock_${Date.now().toString(36)}${sequence}${Math.random().toString(36).slice(2, 8)}`;
      return { providerToken, redirect: this.redirectFor(providerToken) };
    },
    redirectFor(providerToken) {
      return { url: `/pagar/simulado/${providerToken}`, method: "GET", fields: {} };
    },
    async confirm() {
      // El resultado llega por webhook; hasta entonces sigue pendiente.
      return { state: "pending" };
    },
    async getStatus() {
      return { state: "pending" };
    },
    async refund() {
      return { ok: true };
    },
    parseWebhook({ headers, rawBody }) {
      verifyWebhookSignature(headers, rawBody);
      let body: any;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        throw new WebhookSignatureError("Cuerpo del aviso invalido");
      }
      const state = body?.status === "paid" ? "paid" : body?.status === "cancelled" ? "cancelled" : "failed";
      if (!body?.event_id || !body?.token) throw new WebhookSignatureError("Aviso incompleto");
      return {
        eventId: String(body.event_id),
        providerToken: String(body.token),
        status: {
          state,
          authorizationCode: state === "paid" ? String(body.authorization_code || "000000") : null,
          cardLast4: state === "paid" ? String(body.card_last4 || "0000") : null,
          amount: body.amount == null ? null : Number(body.amount),
          reason: body.reason ?? null,
        },
      };
    },
  };
}
