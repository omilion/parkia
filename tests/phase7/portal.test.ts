import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let runWithTenant: typeof import("../../server/db/engine/context").runWithTenant;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ runWithTenant } = await import("../../server/db/engine/context"));
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
});

after(async () => {
  await harness.close();
});

test("7.3 Portal del abonado: enlace magico de un solo uso, sesion, consulta de cuotas/vehiculos y pago", async () => {
  resetMemoryOutbox();
  const adminCookie = await harness.loginAs("admin@parkia.local", "admin123");

  // Obtener tenant y crear cliente, vehiculo, contrato y cuota pendiente
  const ctxRes = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(ctxRes.status, 200);
  const ctxJson = (await ctxRes.json()) as { tenant: { id: number; slug: string } };
  const tenantId = ctxJson.tenant.id;

  const clientRes = await fetch(`${harness.baseUrl}/api/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      name: "Abonado Portal SA",
      email: "portal.abonado@empresa.cl",
      phone: "+56911112222",
      rut: "77.123.456-7",
      type: "company",
    }),
  });
  assert.equal(clientRes.status, 201);
  const clientJson = (await clientRes.json()) as { id: number };

  const seeded = await runWithTenant(tenantId, async () => {
    const branchRow = await db
      .prepare("SELECT id FROM branches WHERE tenant_id = ? ORDER BY id ASC LIMIT 1")
      .get<{ id: number }>(tenantId);
    const branchId = branchRow?.id ?? null;

    await db
      .prepare(
        `INSERT INTO vehicles (tenant_id, client_id, plate, brand, model, color, status)
         VALUES (?, ?, 'PRTL99', 'Toyota', 'Corolla', 'Gris', 'active')`,
      )
      .run(tenantId, clientJson.id);

    const contractInsert = await db
      .prepare(
        `INSERT INTO contracts (tenant_id, branch_id, client_id, start_date, monthly_fee, billing_day, status)
         VALUES (?, ?, ?, '2026-11-01', 95000, 5, 'active')`,
      )
      .run(tenantId, branchId, clientJson.id);
    const contractId = Number(contractInsert.lastInsertRowid);

    const paymentInsert = await db
      .prepare(
        `INSERT INTO payments (tenant_id, branch_id, contract_id, amount, due_date, status)
         VALUES (?, ?, ?, 95000, '2026-11-05', 'pending')`,
      )
      .run(tenantId, branchId, contractId);

    return { contractId, paymentId: Number(paymentInsert.lastInsertRowid) };
  });

  // 1. Sin sesion de portal -> 401
  const unauthMe = await fetch(`${harness.baseUrl}/api/portal/me`);
  assert.equal(unauthMe.status, 401);

  // 2. Solicitar enlace magico
  const reqLinkRes = await fetch(`${harness.baseUrl}/api/portal/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "portal.abonado@empresa.cl" }),
  });
  assert.equal(reqLinkRes.status, 200);
  const reqLinkJson = (await reqLinkRes.json()) as { ok: boolean; debugToken?: string };
  assert.equal(reqLinkJson.ok, true);
  assert.ok(reqLinkJson.debugToken);
  assert.equal(memoryOutbox.length, 1);
  assert.ok(memoryOutbox[0].html.includes(reqLinkJson.debugToken) || memoryOutbox[0].text.includes(reqLinkJson.debugToken));

  // 3. Verificar enlace magico (un solo uso)
  const verifyRes = await fetch(`${harness.baseUrl}/api/portal/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: reqLinkJson.debugToken }),
  });
  assert.equal(verifyRes.status, 200);
  const verifyJson = (await verifyRes.json()) as { ok: boolean; sessionToken: string };
  assert.equal(verifyJson.ok, true);
  assert.ok(verifyJson.sessionToken.length >= 32);

  const reuseRes = await fetch(`${harness.baseUrl}/api/portal/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: reqLinkJson.debugToken }),
  });
  assert.equal(reuseRes.status, 401);

  // 4. Consultar /api/portal/me
  const meRes = await fetch(`${harness.baseUrl}/api/portal/me`, {
    headers: { Authorization: `Bearer ${verifyJson.sessionToken}` },
  });
  assert.equal(meRes.status, 200);
  const meJson = (await meRes.json()) as {
    client: { id: number; name: string };
    contracts: Array<{ id: number }>;
    payments: Array<{ id: number; status: string; amount: number }>;
    vehicles: Array<{ plate: string }>;
    invoices: unknown[];
    documents: unknown[];
  };
  assert.equal(meJson.client.id, clientJson.id);
  assert.equal(meJson.contracts.length, 1);
  assert.equal(meJson.payments.length, 1);
  assert.equal(meJson.payments[0].status, "pending");
  assert.equal(meJson.vehicles[0].plate, "PRTL99");

  // 5. Pagar cuota desde el portal
  const payRes = await fetch(`${harness.baseUrl}/api/portal/payments/${seeded.paymentId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${verifyJson.sessionToken}`,
    },
    body: JSON.stringify({ method: "card" }),
  });
  assert.equal(payRes.status, 200);
  const payJson = (await payRes.json()) as { ok: boolean; payment: { status: string; method: string } };
  assert.equal(payJson.ok, true);
  assert.equal(payJson.payment.status, "paid");
  assert.equal(payJson.payment.method, "card");

  const doublePayRes = await fetch(`${harness.baseUrl}/api/portal/payments/${seeded.paymentId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${verifyJson.sessionToken}`,
    },
    body: JSON.stringify({ method: "card" }),
  });
  assert.equal(doublePayRes.status, 409);

  // 6. Cerrar sesion de portal
  const logoutRes = await fetch(`${harness.baseUrl}/api/portal/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${verifyJson.sessionToken}` },
  });
  assert.equal(logoutRes.status, 200);

  const afterLogoutMe = await fetch(`${harness.baseUrl}/api/portal/me`, {
    headers: { Authorization: `Bearer ${verifyJson.sessionToken}` },
  });
  assert.equal(afterLogoutMe.status, 401);
});
