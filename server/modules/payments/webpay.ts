import { PaymentGatewayError, type ChargeStatus, type PaymentGateway, type Redirect } from "./gateway";

/**
 * Adaptador de Webpay Plus (Transbank, API REST v1.2).
 *
 * Flujo: `createCharge` abre la transaccion y devuelve token + URL; el cliente paga en Transbank y
 * vuelve a nuestra `returnUrl` con `token_ws`; recien al ejecutar `confirm` (commit) el cargo queda
 * autorizado. Webpay no envia webhooks: la confirmacion es el commit mas la conciliacion periodica.
 *
 * Credenciales de integracion publicas (documentadas por Transbank): sirven solo para el ambiente de pruebas.
 */

export const WEBPAY_INTEGRATION = {
  commerceCode: "597055555532",
  apiKey: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
} as const;

const HOSTS = {
  integration: "https://webpay3gint.transbank.cl",
  production: "https://webpay3g.transbank.cl",
} as const;

const API_PATH = "/rswebpaytransaction/api/webpay/v1.2/transactions";

export type WebpayOptions = {
  environment: "integration" | "production";
  commerceCode: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type WebpayResponse = {
  token?: string;
  url?: string;
  status?: string;
  amount?: number;
  buy_order?: string;
  response_code?: number;
  authorization_code?: string;
  card_detail?: { card_number?: string };
  type?: string;
  error_message?: string;
};

export function createWebpayGateway(options: WebpayOptions): PaymentGateway {
  const host = HOSTS[options.environment];
  const doFetch = options.fetchImpl ?? fetch;

  async function call(method: "POST" | "PUT" | "GET", path: string, body?: unknown): Promise<{ status: number; data: WebpayResponse }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await doFetch(`${host}${API_PATH}${path}`, {
        method,
        headers: {
          "Tbk-Api-Key-Id": options.commerceCode,
          "Tbk-Api-Key-Secret": options.apiKey,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data: WebpayResponse = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        /* Respuesta no JSON: se informa mas abajo segun el estado HTTP. */
      }
      return { status: response.status, data };
    } catch (error) {
      throw new PaymentGatewayError(
        (error as Error)?.name === "AbortError" ? "Webpay no respondio a tiempo" : "No se pudo conectar con Webpay",
        504,
        "GATEWAY_UNREACHABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function toStatus(data: WebpayResponse): ChargeStatus {
    const approved = data.status === "AUTHORIZED" && data.response_code === 0;
    const reversed = data.status === "REVERSED" || data.status === "NULLIFIED" || data.status === "PARTIALLY_NULLIFIED";
    return {
      state: approved ? "paid" : reversed ? "cancelled" : data.status === "FAILED" ? "failed" : data.status === "INITIALIZED" ? "pending" : "failed",
      authorizationCode: data.authorization_code ?? null,
      cardLast4: data.card_detail?.card_number ? String(data.card_detail.card_number).slice(-4) : null,
      amount: data.amount == null ? null : Number(data.amount),
      reason: approved ? null : `Webpay: ${data.status ?? "sin estado"}${data.response_code != null ? ` (codigo ${data.response_code})` : ""}`,
      raw: data,
    };
  }

  function redirectFor(token: string): Redirect {
    return { url: `${host}/webpayserver/initTransaction`, method: "POST", fields: { token_ws: token } };
  }

  return {
    id: "webpay",
    async createCharge(request) {
      const { status, data } = await call("POST", "", {
        buy_order: request.buyOrder.slice(0, 26),
        session_id: request.sessionId.slice(0, 61),
        amount: request.amount,
        return_url: request.returnUrl,
      });
      if (status < 200 || status >= 300 || !data.token || !data.url) {
        throw new PaymentGatewayError(data.error_message || `Webpay rechazo la creacion del cobro (HTTP ${status})`, 502, "GATEWAY_REJECTED");
      }
      return { providerToken: data.token, redirect: { url: data.url, method: "POST", fields: { token_ws: data.token } } };
    },
    redirectFor,
    async confirm(token) {
      const { status, data } = await call("PUT", `/${encodeURIComponent(token)}`);
      if (status >= 200 && status < 300) return toStatus(data);
      // Ya confirmada antes (reintento del retorno o carrera con la conciliacion): se consulta su estado.
      if (status === 422 || status === 409) return this.getStatus(token);
      throw new PaymentGatewayError(data.error_message || `Webpay no pudo confirmar la transaccion (HTTP ${status})`, 502, "GATEWAY_REJECTED");
    },
    async getStatus(token) {
      const { status, data } = await call("GET", `/${encodeURIComponent(token)}`);
      if (status < 200 || status >= 300) throw new PaymentGatewayError(data.error_message || `Webpay no pudo consultar la transaccion (HTTP ${status})`, 502, "GATEWAY_REJECTED");
      return toStatus(data);
    },
    async refund(token, amount) {
      const { status, data } = await call("POST", `/${encodeURIComponent(token)}/refunds`, { amount });
      if (status >= 200 && status < 300) return { ok: true, raw: data };
      return { ok: false, raw: data, reason: data.error_message || `HTTP ${status}` };
    },
    parseWebhook() {
      return null; // Webpay Plus no usa webhooks.
    },
  };
}
