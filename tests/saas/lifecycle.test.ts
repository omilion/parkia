import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let runSubscriptionLifecycleJob: typeof import("../../server/modules/saas/lifecycle").runSubscriptionLifecycleJob;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let resetPublicAttemptsForTesting: typeof import("../../server/middleware/publicAttempts").resetPublicAttemptsForTesting;

before(async () => {
  harness = await createSaasTestServer();
  ({ runSubscriptionLifecycleJob } = await import("../../server/modules/saas/lifecycle"));
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({ resetPublicAttemptsForTesting } = await import("../../server/middleware/publicAttempts"));
});

after(async () => {
  await harness.close();
});

test("6.3 ciclo de suscripcion: aviso 3 dias antes, past_due con 7 dias de gracia operativa y suspension conservando datos", async () => {
  resetMemoryOutbox();
  resetPublicAttemptsForTesting();

  // Crear tenant autoservicio y verificar correo
  const signupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Ciclo SpA",
      company_rut: "76.123.456-0",
      owner_name: "Valentina Mora",
      email: "valentina@ciclo.cl",
      password: "Password123!",
      accept_terms: true,
    }),
  });
  assert.equal(signupRes.status, 201);

  const verificationEmail = memoryOutbox.find((m) => m.to === "valentina@ciclo.cl");
  assert.ok(verificationEmail);
  const tokenMatch = verificationEmail.html.match(/token=([a-f0-9]+)/i);
  assert.ok(tokenMatch?.[1]);

  const verifyRes = await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenMatch[1] }),
  });
  assert.equal(verifyRes.status, 200);

  const cookie = await harness.loginAs("valentina@ciclo.cl", "Password123!");
  const ctxRes = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { Cookie: cookie },
  });
  const ctx = (await ctxRes.json()) as { tenant: { id: number } };
  const signupData = { tenant_id: ctx.tenant.id };
  resetMemoryOutbox();

  const today = new Date();
  const isoDay = (offsetDays: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  // 1. Trial vence en 2 dias -> envia aviso sin duplicar
  await harness.db
    .prepare("UPDATE subscriptions SET current_period_end = ? WHERE tenant_id = ?")
    .run(isoDay(2), signupData.tenant_id);

  const run1 = await runSubscriptionLifecycleJob(today);
  assert.equal(run1.trialEndingNotified, 1);
  assert.equal(memoryOutbox.filter((m) => m.to === "valentina@ciclo.cl").length, 1);

  // Segunda corrida el mismo dia no duplica correo
  await runSubscriptionLifecycleJob(today);
  assert.equal(memoryOutbox.filter((m) => m.to === "valentina@ciclo.cl").length, 1);

  // 2. Trial vencido -> pasa a past_due con 7 dias de gracia y sigue operando
  await harness.db
    .prepare("UPDATE subscriptions SET current_period_end = ? WHERE tenant_id = ?")
    .run(isoDay(-1), signupData.tenant_id);

  const run2 = await runSubscriptionLifecycleJob(today);
  assert.equal(run2.movedToPastDue, 1);

  const subPastDue = (await harness.db
    .prepare("SELECT status, grace_until FROM subscriptions WHERE tenant_id = ?")
    .get(signupData.tenant_id)) as { status: string; grace_until: string };
  assert.equal(subPastDue.status, "past_due");
  assert.equal(subPastDue.grace_until, isoDay(7));

  const branchesRes = await fetch(`${harness.baseUrl}/api/branches`, {
    headers: { Cookie: cookie },
  });
  const branches = (await branchesRes.json()) as Array<{ id: number }>;
  const branchId = branches[0].id;

  const createSpaceGraceRes = await fetch(`${harness.baseUrl}/api/spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ branch_id: branchId, name: "G-01", type: "parking", status: "available", price: 45000 }),
  });
  assert.equal(createSpaceGraceRes.status, 200);

  // 3. Vence la gracia -> pasa a suspended, bloquea escrituras (402) pero permite lectura y exportacion
  await harness.db
    .prepare("UPDATE subscriptions SET grace_until = ? WHERE tenant_id = ?")
    .run(isoDay(-1), signupData.tenant_id);

  const run3 = await runSubscriptionLifecycleJob(today);
  assert.equal(run3.movedToSuspended, 1);

  const subSuspended = (await harness.db
    .prepare("SELECT status, suspended_at FROM subscriptions WHERE tenant_id = ?")
    .get(signupData.tenant_id)) as { status: string; suspended_at: string | null };
  assert.equal(subSuspended.status, "suspended");
  assert.ok(subSuspended.suspended_at);

  const blockedWriteRes = await fetch(`${harness.baseUrl}/api/spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "G-02", status: "available", price: 45000 }),
  });
  assert.equal(blockedWriteRes.status, 402);

  // Lectura y exportacion siguen disponibles y los datos no se borran
  const spacesReadRes = await fetch(`${harness.baseUrl}/api/spaces`, {
    headers: { Cookie: cookie },
  });
  assert.equal(spacesReadRes.status, 200);
  const spaces = (await spacesReadRes.json()) as Array<{ name: string }>;
  assert.ok(spaces.some((s) => s.name === "G-01"));

  const exportRes = await fetch(`${harness.baseUrl}/api/tenant/export`, {
    headers: { Cookie: cookie },
  });
  assert.equal(exportRes.status, 200);
});

