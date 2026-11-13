import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let resetPublicAttemptsForTesting: typeof import("../../server/middleware/publicAttempts").resetPublicAttemptsForTesting;

before(async () => {
  harness = await createSaasTestServer();
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({ resetPublicAttemptsForTesting } = await import("../../server/middleware/publicAttempts"));
});

after(async () => {
  await harness.close();
});

test("6.2 asistente de inicio: estado resumible, importacion CSV de plazas, tarifa, omitir personal y ticket de prueba", async () => {
  resetMemoryOutbox();
  resetPublicAttemptsForTesting();

  const signupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Sur SpA",
      company_rut: "76.123.456-0",
      owner_name: "Diego Soto",
      email: "diego@sur.cl",
      password: "Password123!",
      accept_terms: true,
    }),
  });
  assert.equal(signupRes.status, 201);

  const email = memoryOutbox.find((m) => m.to === "diego@sur.cl");
  assert.ok(email);
  const tokenMatch = email.html.match(/token=([a-f0-9]+)/i);
  assert.ok(tokenMatch?.[1]);

  const verifyRes = await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenMatch[1] }),
  });
  assert.equal(verifyRes.status, 200);

  const cookie = await harness.loginAs("diego@sur.cl", "Password123!");

  // 1. Estado inicial del onboarding
  const status1Res = await fetch(`${harness.baseUrl}/api/onboarding/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(status1Res.status, 200);
  const status1 = (await status1Res.json()) as any;
  assert.equal(status1.completed, false);
  assert.equal(status1.dismissed, false);
  assert.equal(status1.steps.branch.done, true);
  assert.equal(status1.steps.spaces.done, false);
  assert.equal(status1.next_step, "spaces");

  const branchName = String(status1.steps.branch.first_branch.name);
  const branchId = Number(status1.steps.branch.first_branch.id);

  // 2. Importacion masiva CSV de plazas (incluye duplicado en el mismo CSV)
  const csv = [
    "Sucursal,Nombre,Estado,Precio mensual",
    `${branchName},P-01,available,50000`,
    `${branchName},P-02,available,50000`,
    `${branchName},P-01,available,50000`,
  ].join("\n");

  const importRes = await fetch(`${harness.baseUrl}/api/spaces/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ csv }),
  });
  assert.equal(importRes.status, 200);
  const importBody = (await importRes.json()) as { imported: number; skipped: number };
  assert.equal(importBody.imported, 2);
  assert.equal(importBody.skipped, 1);

  // 3. Crear tarifa base
  const rateRes = await fetch(`${harness.baseUrl}/api/rate-plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: "Tarifa Base",
      branch_id: branchId,
      vehicle_type: "all",
      mode: "per_minute",
      grace_mins: 15,
      daily_cap: 15000,
      first_block_minutes: null,
      block_minutes: null,
      rules: [
        {
          weekdays: null,
          from: "00:00",
          to: "24:00",
          priority: 0,
          price_per_minute: 35,
          first_block_price: null,
          block_price: null,
        },
      ],
    }),
  });
  assert.equal(rateRes.status, 201);

  // 4. Omitir paso de personal y verificar resumibilidad
  const skipStaffRes = await fetch(`${harness.baseUrl}/api/onboarding/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ staff_skipped: true }),
  });
  assert.equal(skipStaffRes.status, 200);

  const status2Res = await fetch(`${harness.baseUrl}/api/onboarding/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(status2Res.status, 200);
  const status2 = (await status2Res.json()) as any;
  assert.equal(status2.steps.spaces.done, true);
  assert.equal(status2.steps.rate_plan.done, true);
  assert.equal(status2.steps.staff.done, true);
  assert.equal(status2.steps.staff.skipped, true);
  assert.equal(status2.next_step, "test_ticket");

  // 5. Emitir ticket de prueba completa el asistente
  const ticketRes = await fetch(`${harness.baseUrl}/api/visitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      branch_id: branchId,
      plate: "ABCD12",
      vehicle_type: "car",
    }),
  });
  assert.equal(ticketRes.status, 200);

  const status3Res = await fetch(`${harness.baseUrl}/api/onboarding/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(status3Res.status, 200);
  const status3 = (await status3Res.json()) as any;
  assert.equal(status3.completed, true);
  assert.equal(status3.next_step, null);

  // 6. Ocultar banner persistente
  const dismissRes = await fetch(`${harness.baseUrl}/api/onboarding/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ dismissed: true }),
  });
  assert.equal(dismissRes.status, 200);
  const dismissedBody = (await dismissRes.json()) as any;
  assert.equal(dismissedBody.dismissed, true);
});

