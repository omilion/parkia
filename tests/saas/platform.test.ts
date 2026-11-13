import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let resetPublicAttemptsForTesting: typeof import("../../server/middleware/publicAttempts").resetPublicAttemptsForTesting;

before(async () => {
  harness = await createSaasTestServer({ platformAdmins: "admin@parkia.local" });
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({ resetPublicAttemptsForTesting } = await import("../../server/middleware/publicAttempts"));
});

after(async () => {
  await harness.close();
});

test("6.4 panel plataforma y suplantacion auditada: separa rol de plataforma, suspende/reactiva y registra suplantacion", async () => {
  resetMemoryOutbox();
  resetPublicAttemptsForTesting();

  // Crear un segundo tenant autoservicio
  const signupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Centro SpA",
      company_rut: "76.123.456-0",
      owner_name: "Ignacio Perez",
      email: "ignacio@centro.cl",
      password: "Password123!",
      accept_terms: true,
    }),
  });
  assert.equal(signupRes.status, 201);

  const email = memoryOutbox.find((m) => m.to === "ignacio@centro.cl");
  assert.ok(email);
  const tokenMatch = email.html.match(/token=([a-f0-9]+)/i);
  assert.ok(tokenMatch?.[1]);
  await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenMatch[1] }),
  });

  // 1. Admin del tenant NO puede acceder a /api/platform/*
  const tenantCookie = await harness.loginAs("ignacio@centro.cl", "Password123!");
  const tenantCtxRes = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { Cookie: tenantCookie },
  });
  const tenantCtx = (await tenantCtxRes.json()) as { tenant: { id: number } };
  const targetTenantId = tenantCtx.tenant.id;

  const forbiddenRes = await fetch(`${harness.baseUrl}/api/platform/tenants`, {
    headers: { Cookie: tenantCookie },
  });
  assert.equal(forbiddenRes.status, 403);

  // 2. Platform admin si accede y ve ambos tenants
  const platformCookie = await harness.loginAs("admin@parkia.local", "admin123");
  const listRes = await fetch(`${harness.baseUrl}/api/platform/tenants`, {
    headers: { Cookie: platformCookie },
  });
  assert.equal(listRes.status, 200);
  const listBody = (await listRes.json()) as { tenants: Array<{ id: number; name: string; status: string }> };
  assert.ok(listBody.tenants.some((t) => t.id === targetTenantId && t.name === "Estacionamiento Centro SpA"));

  // 3. Suspender y reactivar empresa
  const suspendRes = await fetch(`${harness.baseUrl}/api/platform/tenants/${targetTenantId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: platformCookie },
    body: JSON.stringify({ status: "suspended", reason: "Morosidad" }),
  });
  assert.equal(suspendRes.status, 200);

  const reactivateRes = await fetch(`${harness.baseUrl}/api/platform/tenants/${targetTenantId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: platformCookie },
    body: JSON.stringify({ status: "active", reason: "Pago regularizado" }),
  });
  assert.equal(reactivateRes.status, 200);

  // 4. Suplantacion auditada: cambia contexto de tenant, se marca en /api/auth/me y escribe audit_events
  const impRes = await fetch(`${harness.baseUrl}/api/platform/impersonate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: platformCookie },
    body: JSON.stringify({
      tenant_id: targetTenantId,
      reason: "Revision de configuracion SII",
      minutes: 30,
    }),
  });
  assert.equal(impRes.status, 200);

  const meRes = await fetch(`${harness.baseUrl}/api/auth/me`, {
    headers: { Cookie: platformCookie },
  });
  assert.equal(meRes.status, 200);
  const meBody = (await meRes.json()) as any;
  assert.equal(meBody.is_platform_admin, true);
  assert.equal(meBody.user.impersonation.tenant_id, targetTenantId);
  assert.equal(meBody.user.impersonation.reason, "Revision de configuracion SII");

  const ctxRes = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { Cookie: platformCookie },
  });
  assert.equal(ctxRes.status, 200);
  const ctxBody = (await ctxRes.json()) as any;
  assert.equal(ctxBody.tenant.id, targetTenantId);

  // 5. Salir de suplantacion restaura contexto y deja auditoria completa
  const stopRes = await fetch(`${harness.baseUrl}/api/platform/stop-impersonation`, {
    method: "POST",
    headers: { Cookie: platformCookie },
  });
  assert.equal(stopRes.status, 200);

  const meAfterRes = await fetch(`${harness.baseUrl}/api/auth/me`, {
    headers: { Cookie: platformCookie },
  });
  const meAfter = (await meAfterRes.json()) as any;
  assert.equal(meAfter.user.impersonation, null);

  const auditRows = (await harness.db
    .prepare("SELECT action FROM audit_events WHERE tenant_id = ? AND action LIKE 'platform.%' ORDER BY id ASC")
    .all(targetTenantId)) as Array<{ action: string }>;
  const actions = auditRows.map((r) => r.action);
  assert.ok(actions.includes("platform.impersonation_started"));
  assert.ok(actions.includes("platform.impersonation_stopped"));
});

