import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let memoryWhatsAppOutbox: typeof import("../../server/modules/phase7/notifications").memoryWhatsAppOutbox;
let resetMemoryWhatsAppOutbox: typeof import("../../server/modules/phase7/notifications").resetMemoryWhatsAppOutbox;
let setWhatsAppTransport: typeof import("../../server/modules/phase7/notifications").setWhatsAppTransport;
let runJobNow: typeof import("../../server/platform/jobs").runJobNow;

before(async () => {
  harness = await createSaasTestServer();
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({
    memoryWhatsAppOutbox,
    resetMemoryWhatsAppOutbox,
    setWhatsAppTransport,
  } = await import("../../server/modules/phase7/notifications"));
  ({ runJobNow } = await import("../../server/platform/jobs"));
});

after(async () => {
  await harness.close();
});

test("7.2 Notificaciones: correo, WhatsApp Business, plantillas, deduplicacion y reintento por job", async () => {
  resetMemoryOutbox();
  resetMemoryWhatsAppOutbox();

  const adminCookie = await harness.loginAs("admin@parkia.local", "admin123");

  // 1. Envio por correo: fee_due_soon
  const emailRes = await fetch(`${harness.baseUrl}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      channel: "email",
      recipient: "abonado@empresa.cl",
      template: "fee_due_soon",
      dedupe_key: "fee-due-1001",
      payload: {
        clientName: "Juan Perez",
        amountClp: 85000,
        dueDate: "2026-11-20",
        paymentUrl: "https://parkia.cl/portal?pay=1001",
      },
    }),
  });
  assert.equal(emailRes.status, 201);
  const emailJson = (await emailRes.json()) as { id: number; status: string; deduplicated?: boolean };
  assert.ok(emailJson.id > 0);
  assert.equal(emailJson.status, "sent");
  assert.equal(memoryOutbox.length, 1);
  assert.equal(memoryOutbox[0].to, "abonado@empresa.cl");
  assert.ok(memoryOutbox[0].html.includes("85.000") || memoryOutbox[0].text.includes("85.000"));

  // 2. Deduplicacion por dedupe_key
  const dupRes = await fetch(`${harness.baseUrl}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      channel: "email",
      recipient: "abonado@empresa.cl",
      template: "fee_due_soon",
      dedupe_key: "fee-due-1001",
      payload: { clientName: "Juan Perez", amountClp: 85000 },
    }),
  });
  assert.equal(dupRes.status, 201);
  const dupJson = (await dupRes.json()) as { deduplicated?: boolean };
  assert.equal(dupJson.deduplicated, true);
  assert.equal(memoryOutbox.length, 1);

  // 3. Plantillas por WhatsApp: visitor_pass_qr, fee_overdue, receipt_boleta
  for (const [template, payload] of [
    ["visitor_pass_qr", { visitorName: "Ana Visita", plate: "BBCD12", qrCode: "QR-9988" }],
    ["fee_overdue", { clientName: "Carlos Mora", amountClp: 90000, dueDate: "2026-11-01" }],
    ["receipt_boleta", { clientName: "Carlos Mora", amountClp: 90000, folio: "39-1042" }],
  ] as const) {
    const waRes = await fetch(`${harness.baseUrl}/api/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        channel: "whatsapp",
        recipient: "+56912345678",
        template,
        payload,
      }),
    });
    assert.equal(waRes.status, 201);
    const waJson = (await waRes.json()) as { status: string };
    assert.equal(waJson.status, "sent");
  }
  assert.equal(memoryWhatsAppOutbox.length, 3);
  assert.ok(memoryWhatsAppOutbox[0].bodyText.includes("QR-9988"));
  assert.ok(memoryWhatsAppOutbox[2].bodyText.includes("39-1042"));

  // 4. Falla transitoria de WhatsApp + reintento via job notifications.dispatch
  let shouldFail = true;
  const mockDelivered: string[] = [];
  setWhatsAppTransport({
    async send(message) {
      if (shouldFail) {
        return { ok: false, error: "meta_rate_limit" };
      }
      mockDelivered.push(message.bodyText);
      return { ok: true, messageId: "wa-mock-ok" };
    },
  });

  const failRes = await fetch(`${harness.baseUrl}/api/notifications/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      channel: "whatsapp",
      recipient: "+56987654321",
      template: "fee_due_soon",
      payload: { clientName: "Pedro Retry", amountClp: 50000, dueDate: "2026-11-25" },
    }),
  });
  assert.equal(failRes.status, 502);
  const failJson = (await failRes.json()) as { status: string };
  assert.equal(failJson.status, "failed");
  assert.equal(mockDelivered.length, 0);

  shouldFail = false;
  const jobResult = (await runJobNow("notifications.dispatch")) as { sent?: number };
  assert.equal(jobResult.sent, 1);
  assert.equal(mockDelivered.length, 1);

  // 5. Listado de outbox
  const listRes = await fetch(`${harness.baseUrl}/api/notifications/outbox`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(listRes.status, 200);
  const { items: rows } = (await listRes.json()) as { items: Array<{ status: string }> };
  assert.ok(rows.length >= 5);
  assert.ok(rows.every(r => r.status === "sent"));
});

