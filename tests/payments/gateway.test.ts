import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PARKIA_MASTER_KEY = "ab".repeat(32);
const { createWebpayGateway } = await import("../../server/modules/payments/webpay");
const { PaymentGatewayError, WebhookSignatureError, createMockGateway, signWebhook, verifyWebhookSignature } = await import("../../server/modules/payments/gateway");

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function fakeFetch(responder: (call: Call) => { status?: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const impl = (async (input: any, init: any) => {
    const call: Call = { url: String(input), method: String(init?.method), headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const result = responder(call);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}
const options = (fetchImpl: typeof fetch, environment: "integration" | "production" = "integration") => ({ environment, commerceCode: "COMERCIO", apiKey: "LLAVE", fetchImpl });

test("Webpay: crea el cobro con las credenciales y el host del ambiente", async () => {
  const integration = fakeFetch(() => ({ body: { token: "tok1", url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" } }));
  const charge = await createWebpayGateway(options(integration.impl)).createCharge({ buyOrder: "X".repeat(40), amount: 12000, returnUrl: "https://app/return", sessionId: "s".repeat(80) });
  assert.equal(charge.providerToken, "tok1");
  assert.deepEqual(charge.redirect, { url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction", method: "POST", fields: { token_ws: "tok1" } });
  const call = integration.calls[0];
  assert.equal(call.url, "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions");
  assert.equal(call.headers["Tbk-Api-Key-Id"], "COMERCIO");
  assert.equal(call.headers["Tbk-Api-Key-Secret"], "LLAVE");
  assert.equal(call.body.buy_order.length, 26, "Transbank limita la orden de compra a 26 caracteres");
  assert.equal(call.body.session_id.length, 61);
  assert.equal(call.body.amount, 12000);

  const production = fakeFetch(() => ({ body: { token: "tok2", url: "https://webpay3g.transbank.cl/webpayserver/initTransaction" } }));
  await createWebpayGateway(options(production.impl, "production")).createCharge({ buyOrder: "A", amount: 1000, returnUrl: "https://app/return", sessionId: "s" });
  assert.match(production.calls[0].url, /^https:\/\/webpay3g\.transbank\.cl\//);
});

test("Webpay: un rechazo o una caida se informan sin filtrar detalles internos", async () => {
  const rejected = fakeFetch(() => ({ status: 401, body: { error_message: "Not Authorized" } }));
  await assert.rejects(() => createWebpayGateway(options(rejected.impl)).createCharge({ buyOrder: "A", amount: 1000, returnUrl: "u", sessionId: "s" }), (error: any) => error instanceof PaymentGatewayError && error.code === "GATEWAY_REJECTED");
  const down = fakeFetch(() => new Error("ECONNREFUSED 10.0.0.1"));
  await assert.rejects(() => createWebpayGateway(options(down.impl)).createCharge({ buyOrder: "A", amount: 1000, returnUrl: "u", sessionId: "s" }), (error: any) => error instanceof PaymentGatewayError && error.code === "GATEWAY_UNREACHABLE" && !/10\.0\.0\.1/.test(error.message));
});

test("Webpay: el commit decide el estado del cobro", async () => {
  const approved = fakeFetch(() => ({ body: { status: "AUTHORIZED", response_code: 0, amount: 5000, authorization_code: "A1", card_detail: { card_number: "6623" } } }));
  const paid = await createWebpayGateway(options(approved.impl)).confirm("tok");
  assert.deepEqual([paid.state, paid.amount, paid.authorizationCode, paid.cardLast4], ["paid", 5000, "A1", "6623"]);
  assert.equal(approved.calls[0].method, "PUT");

  for (const [body, state] of [
    [{ status: "FAILED", response_code: -1, amount: 5000 }, "failed"],
    [{ status: "AUTHORIZED", response_code: -2, amount: 5000 }, "failed"],
    [{ status: "REVERSED", amount: 5000 }, "cancelled"],
    [{ status: "INITIALIZED" }, "pending"],
  ] as const) {
    const gateway = createWebpayGateway(options(fakeFetch(() => ({ body })).impl));
    assert.equal((await gateway.confirm("tok")).state, state, JSON.stringify(body));
  }
});

test("Webpay: si el commit ya se ejecuto, consulta el estado en vez de fallar", async () => {
  const flow = fakeFetch(call => call.method === "PUT"
    ? { status: 422, body: { error_message: "Transaction already locked" } }
    : { body: { status: "AUTHORIZED", response_code: 0, amount: 7000, authorization_code: "A9", card_detail: { card_number: "1111" } } });
  const status = await createWebpayGateway(options(flow.impl)).confirm("tok");
  assert.equal(status.state, "paid");
  assert.deepEqual(flow.calls.map(call => call.method), ["PUT", "GET"]);
});

test("Webpay: reembolsos y webhooks", async () => {
  const refunds = fakeFetch(call => call.url.endsWith("/refunds") ? { body: { type: "REVERSED" } } : { status: 500 });
  const gateway = createWebpayGateway(options(refunds.impl));
  assert.equal((await gateway.refund("tok", 3000)).ok, true);
  assert.deepEqual(refunds.calls[0].body, { amount: 3000 });
  const failing = createWebpayGateway(options(fakeFetch(() => ({ status: 422, body: { error_message: "No refundable" } })).impl));
  assert.deepEqual({ ...(await failing.refund("tok", 3000)), raw: undefined }, { ok: false, raw: undefined, reason: "No refundable" });
  assert.equal(gateway.parseWebhook({ headers: {}, rawBody: Buffer.from("{}") }), null, "Webpay Plus no usa webhooks");
});

test("Webhooks firmados: aceptan lo autentico y rechazan lo alterado, viejo o sin firma", () => {
  const body = Buffer.from(JSON.stringify({ event_id: "e1", token: "mock_1", status: "paid", amount: 1000 }));
  const { timestamp, signature } = signWebhook(body);
  const headers = { "x-parkia-timestamp": timestamp, "x-parkia-signature": signature };
  assert.doesNotThrow(() => verifyWebhookSignature(headers, body));

  assert.throws(() => verifyWebhookSignature(headers, Buffer.from(body.toString().replace("1000", "1"))), WebhookSignatureError, "cuerpo alterado");
  assert.throws(() => verifyWebhookSignature({ ...headers, "x-parkia-signature": "sha256=" + "0".repeat(64) }, body), WebhookSignatureError, "firma falsa");
  assert.throws(() => verifyWebhookSignature({ "x-parkia-timestamp": timestamp }, body), WebhookSignatureError, "sin firma");
  assert.throws(() => verifyWebhookSignature({}, body), WebhookSignatureError, "sin encabezados");
  const old = signWebhook(body, Date.now() - 10 * 60_000);
  assert.throws(() => verifyWebhookSignature({ "x-parkia-timestamp": old.timestamp, "x-parkia-signature": old.signature }, body), WebhookSignatureError, "repeticion de un aviso viejo");
  // Cambiar la marca de tiempo invalida la firma: no se puede "rejuvenecer" un aviso capturado.
  assert.throws(() => verifyWebhookSignature({ "x-parkia-timestamp": String(Date.now()), "x-parkia-signature": old.signature }, body), WebhookSignatureError);
});

test("Pasarela simulada: interpreta avisos firmados", () => {
  const gateway = createMockGateway();
  const body = Buffer.from(JSON.stringify({ event_id: "e2", token: "mock_2", status: "failed", amount: 500, reason: "rechazada" }));
  const signed = signWebhook(body);
  const event = gateway.parseWebhook({ headers: { "x-parkia-timestamp": signed.timestamp, "x-parkia-signature": signed.signature }, rawBody: body });
  assert.deepEqual([event?.eventId, event?.providerToken, event?.status.state, event?.status.amount], ["e2", "mock_2", "failed", 500]);
  assert.throws(() => gateway.parseWebhook({ headers: {}, rawBody: body }), WebhookSignatureError);
});
