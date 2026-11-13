import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let runWithoutTenant: typeof import("../../server/db/engine/context").runWithoutTenant;
let getUfRate: typeof import("../../server/modules/saas/uf").getUfRate;
let syncUfFromProvider: typeof import("../../server/modules/saas/uf").syncUfFromProvider;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ runWithoutTenant } = await import("../../server/db/engine/context"));
  ({ getUfRate, syncUfFromProvider } = await import("../../server/modules/saas/uf"));
});

after(async () => {
  await harness.close();
});

test("6.6 cobro de suscripcion: UF diaria con respaldo historico, inscripcion Oneclick y cobro en CLP", async () => {
  const cookie = await harness.loginAs("admin@parkia.local", "admin123");

  // 1. Sync UF via mock fetch (mindicador.cl format) y verificar respaldo historico
  const synced = await syncUfFromProvider(
    async () =>
      new Response(
        JSON.stringify({
          serie: [{ fecha: "2026-11-10T03:00:00.000Z", valor: 38250.5 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  assert.equal(synced.rate_date, "2026-11-10");
  assert.equal(synced.value_clp, 38250.5);

  const fallback = await getUfRate("2026-11-12");
  assert.equal(fallback.rate_date, "2026-11-10");
  assert.equal(fallback.value_clp, 38250.5);
  assert.equal(fallback.exact, false);

  // Upsert UF exacta para 2026-11-13 via API
  const ufRes = await fetch(`${harness.baseUrl}/api/billing/uf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      rate_date: "2026-11-13",
      value_clp: 38500,
      source: "test",
    }),
  });
  assert.equal(ufRes.status, 201);

  // Asegurar plan con price_uf_centis = 200 (2.00 UF -> $77.000 CLP)
  await runWithoutTenant(async () => {
    await db
      .prepare(
        `UPDATE plans
         SET price_uf_centis = 200
         WHERE id = (SELECT plan_id FROM subscriptions WHERE tenant_id = 1 ORDER BY id DESC LIMIT 1)`,
      )
      .run();
  });

  // 2. Inscribir tarjeta Oneclick
  const enrollRes = await fetch(`${harness.baseUrl}/api/billing/oneclick/enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ email: "finanzas@parkia.local" }),
  });
  assert.equal(enrollRes.status, 201);
  const enrollJson = (await enrollRes.json()) as { token: string; url_webpay: string };
  assert.ok(enrollJson.token);
  assert.ok(enrollJson.url_webpay.includes(enrollJson.token));

  const finishRes = await fetch(`${harness.baseUrl}/api/billing/oneclick/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ token: enrollJson.token }),
  });
  assert.equal(finishRes.status, 200);
  const finishJson = (await finishRes.json()) as { approved: boolean; card_last4: string };
  assert.equal(finishJson.approved, true);
  assert.equal(finishJson.card_last4, "6623");

  // 3. Cobrar suscripcion usando UF 2026-11-13 (2.00 * 38500 = 77000)
  const chargeRes = await fetch(`${harness.baseUrl}/api/billing/charge-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ uf_date: "2026-11-13" }),
  });
  assert.equal(chargeRes.status, 200);
  const chargeJson = (await chargeRes.json()) as {
    approved: boolean;
    amount_clp: number;
    amount_uf_centis: number;
    authorization_code: string;
    dte: { dteStatus: string };
  };
  assert.equal(chargeJson.approved, true);
  assert.equal(chargeJson.amount_uf_centis, 200);
  assert.equal(chargeJson.amount_clp, 77000);
  assert.ok(chargeJson.authorization_code);
  assert.equal(chargeJson.dte.dteStatus, "platform_tenant_not_configured");

  // 4. Cobro rechazado simulado devuelve 402 y registra factura failed
  const rejectedRes = await fetch(`${harness.baseUrl}/api/billing/charge-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ uf_date: "2026-11-13", simulate_rejected: true }),
  });
  assert.equal(rejectedRes.status, 402);

  // 5. Resumen /api/billing/subscription incluye tarjeta e historial de 2 facturas
  const summaryRes = await fetch(`${harness.baseUrl}/api/billing/subscription`, {
    headers: { cookie },
  });
  assert.equal(summaryRes.status, 200);
  const summaryJson = (await summaryRes.json()) as {
    oneclick: { card_last4: string } | null;
    invoices: Array<{ status: string; amount_clp: number }>;
  };
  assert.equal(summaryJson.oneclick?.card_last4, "6623");
  assert.equal(summaryJson.invoices.length, 2);
  assert.equal(summaryJson.invoices[0]?.status, "failed");
  assert.equal(summaryJson.invoices[1]?.status, "paid");
  assert.equal(summaryJson.invoices[1]?.amount_clp, 77000);
});

