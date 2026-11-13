import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Request } from "express";

const reporting = await import("../../server/platform/http/errorReporting");
const { captureException } = await import("../../server/platform/http/logger");
after(async () => { await reporting.resetErrorReportingForTesting(); });

type Envelope = [unknown, Array<[{ type: string }, any]>];
const sent: Envelope[] = [];
const events = () => sent.flatMap(envelope => envelope[1]).filter(([header]) => header.type === "event").map(([, payload]) => payload);

test("sin DSN no se carga el SDK y reportar no hace nada", async () => {
  delete process.env.PARKIA_SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  assert.equal(await reporting.initErrorReporting(), false);
  assert.equal(reporting.isErrorReportingActive(), false);
  reporting.reportError(new Error("nadie escucha"), { request_id: "x" });
  assert.deepEqual(events(), []);
});

test("scrubPath reemplaza tokens largos y descarta la query", () => {
  assert.equal(reporting.scrubPath("/pagar/t_AbCdEfGhIjKlMnOpQrStUvWx"), "/pagar/:token");
  assert.equal(reporting.scrubPath("/api/public/payments/return/abcdefghijklmnopqrstuvwxyz0123?token=secreto&rut=1-9"), "/api/public/payments/return/:token");
  assert.equal(reporting.scrubPath("/api/tickets/42/receipt"), "/api/tickets/42/receipt");
  assert.equal(reporting.scrubPath(undefined), undefined);
});

test("scrubEvent quita usuario, cookies, cabeceras, cuerpo y datos sensibles", () => {
  const event: any = {
    user: { id: 1, email: "a@b.cl", ip_address: "1.2.3.4" },
    request: { method: "POST", url: "https://app.parkia.cl/pagar/t_AbCdEfGhIjKlMnOpQrStUvWx?x=1", cookies: { s: "1" }, headers: { cookie: "s=1", authorization: "Bearer x" }, data: { rut: "1-9" } },
    extra: { rut: "1-9", password: "x", source: "unhandledRejection", session_token: "t" },
    transaction: "GET /pagar/t_AbCdEfGhIjKlMnOpQrStUvWx",
  };
  const scrubbed = reporting.scrubEvent(event);
  assert.equal(scrubbed.user, undefined);
  assert.deepEqual(scrubbed.request, { method: "POST", url: "https://app.parkia.cl/pagar/:token" });
  assert.deepEqual(scrubbed.extra, { source: "unhandledRejection" });
  assert.equal(scrubbed.transaction, "GET /pagar/:token");
});

test("con DSN, captureException envía el error a Sentry con request_id y sin datos personales", async () => {
  const active = await reporting.initErrorReporting({
    dsn: "https://clavepublica@o0.ingest.sentry.io/1",
    transport: () => ({ send: async envelope => { sent.push(envelope as unknown as Envelope); return {}; }, flush: async () => true }),
  });
  assert.equal(active, true);
  assert.equal(reporting.isErrorReportingActive(), true);

  const token = "abcdefghij".repeat(3); // armado en ejecucion: el SDK adjunta la linea de codigo del stack
  const req = { method: "GET", path: `/api/public/payments/return/${token}`, requestId: "req-123", headers: { cookie: "parkia_session=secreto" } } as unknown as Request;
  captureException(new Error("falla del cobro"), req);
  await reporting.flushErrorReporting();

  const [event] = events();
  assert.ok(event, "llegó un evento");
  assert.equal(event.exception.values[0].value, "falla del cobro");
  assert.equal(event.tags.request_id, "req-123");
  assert.equal(event.tags["http.method"], "GET");
  assert.equal(event.tags["http.path"], "/api/public/payments/return/:token");
  assert.equal(event.user, undefined);
  assert.ok(!JSON.stringify(event).includes("parkia_session=secreto"), "no viaja la cookie");
  assert.ok(!JSON.stringify(event).includes(token), "no viaja el token de la ruta");
});

test("un error al reportar nunca rompe la solicitud", () => {
  assert.doesNotThrow(() => reporting.reportError(undefined, { path: "/x" }));
  assert.doesNotThrow(() => reporting.reportError({ circular: null }, { tenant_id: 5 }));
});
