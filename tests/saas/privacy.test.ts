import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let runWithoutTenant: typeof import("../../server/db/engine/context").runWithoutTenant;
let runPrivacyRetentionJob: typeof import("../../server/modules/saas/privacy").runPrivacyRetentionJob;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ runWithoutTenant } = await import("../../server/db/engine/context"));
  ({ runPrivacyRetentionJob } = await import("../../server/modules/saas/privacy"));
});

after(async () => {
  await harness.close();
});

test("6.5 Ley 21.719: consentimiento en alta, exportacion/anonimizacion por titular conservando DTE y job de retencion", async () => {
  // 1. Alta autoservicio registra consentimiento
  const signupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Privacidad SpA",
      company_rut: "76.123.456-0",
      owner_name: "Camila Titular",
      email: "camila@privacidad.cl",
      password: "PasswordSegura123!",
      branch_name: "Sucursal Ley",
      accept_terms: true,
    }),
  });
  assert.equal(signupRes.status, 201);
  const signupJson = (await signupRes.json()) as { verification_token?: string };
  assert.ok(signupJson.verification_token);

  const verifyRes = await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: signupJson.verification_token }),
  });
  assert.equal(verifyRes.status, 200);
  const cookie = await harness.loginAs("camila@privacidad.cl", "PasswordSegura123!");

  // Verificar registro de consentimiento en /api/privacy/consents
  const consentsRes = await fetch(`${harness.baseUrl}/api/privacy/consents`, {
    headers: { cookie },
  });
  assert.equal(consentsRes.status, 200);
  const consentsJson = (await consentsRes.json()) as {
    consents: Array<{ subject_identifier: string; purpose: string; granted: number }>;
  };
  assert.ok(
    consentsJson.consents.some(
      (c) => c.subject_identifier === "camila@privacidad.cl" && c.purpose === "saas_signup" && c.granted === 1,
    ),
  );

  // Obtener tenantId del nuevo tenant
  let tenantId = 0;
  await runWithoutTenant(async () => {
    const row = await db
      .prepare("SELECT id FROM tenants WHERE name = 'Estacionamiento Privacidad SpA' ORDER BY id DESC LIMIT 1")
      .get<{ id: number }>();
    tenantId = Number(row?.id || 0);
  });
  assert.ok(tenantId > 1);

  // 2. Crear cliente + vehiculo + ticket + factura tributaria en ese tenant
  let clientId = 0;
  let oldTicketId = 0;
  let recentTicketId = 0;
  await runWithoutTenant(async () => {
    const branch = await db
      .prepare("SELECT id FROM branches WHERE tenant_id = ? LIMIT 1")
      .get<{ id: number }>(tenantId);
    const branchId = Number(branch!.id);

    const clientRes = await db
      .prepare(
        `INSERT INTO clients (tenant_id, name, email, phone, rut, type, status)
         VALUES (?, 'Juan Perez Titular', 'juan.titular@ejemplo.cl', '+56911112222', '15.222.333-4', 'natural', 'active')`,
      )
      .run(tenantId);
    clientId = Number(clientRes.lastInsertRowid);

    await db
      .prepare(
        `INSERT INTO vehicles (tenant_id, client_id, plate, brand, model, status)
         VALUES (?, ?, 'PRIV99', 'Toyota', 'Yaris', 'active')`,
      )
      .run(tenantId, clientId);

    const oldDate = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const recentDate = new Date(Date.now() - 5 * 86_400_000).toISOString();

    const t1 = await db
      .prepare(
        `INSERT INTO visitor_tickets (tenant_id, branch_id, plate, entry_time, exit_time, amount, status)
         VALUES (?, ?, 'PRIV99', ?, ?, 2500, 'completed')`,
      )
      .run(tenantId, branchId, oldDate, oldDate);
    oldTicketId = Number(t1.lastInsertRowid);

    const t2 = await db
      .prepare(
        `INSERT INTO visitor_tickets (tenant_id, branch_id, plate, entry_time, exit_time, amount, status)
         VALUES (?, ?, 'RECI01', ?, ?, 1500, 'completed')`,
      )
      .run(tenantId, branchId, recentDate, recentDate);
    recentTicketId = Number(t2.lastInsertRowid);

    await db
      .prepare(
        `INSERT INTO invoices (tenant_id, client_id, folio, type, amount, status_sii, date)
         VALUES (?, ?, 9001, 'boleta', 50000, 'accepted', ?)`,
      )
      .run(tenantId, clientId, oldDate);
  });

  // 3. Exportacion ARCO por RUT
  const exportRes = await fetch(
    `${harness.baseUrl}/api/privacy/titular/export?rut=${encodeURIComponent("15.222.333-4")}`,
    { headers: { cookie } },
  );
  assert.equal(exportRes.status, 200);
  const exportJson = (await exportRes.json()) as {
    clients: Array<{ id: number; rut: string }>;
    vehicles: Array<{ plate: string }>;
    visitor_tickets: Array<{ plate: string }>;
    tax_documents: Array<{ folio: number; amount: number }>;
  };
  assert.equal(exportJson.clients.length, 1);
  assert.equal(exportJson.vehicles[0]?.plate, "PRIV99");
  assert.equal(exportJson.visitor_tickets.length, 1);
  assert.equal(exportJson.tax_documents[0]?.amount, 50000);

  // 4. Supresion / anonimizacion por titular conservando factura SII
  const deleteRes = await fetch(`${harness.baseUrl}/api/privacy/titular/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      rut: "15.222.333-4",
      reason: "Solicitud de supresion Ley 21.719",
    }),
  });
  assert.equal(deleteRes.status, 200);
  const deleteJson = (await deleteRes.json()) as {
    clients_anonymized: number;
    vehicles_anonymized: number;
    tickets_anonymized: number;
    tax_documents_preserved: boolean;
  };
  assert.equal(deleteJson.clients_anonymized, 1);
  assert.equal(deleteJson.vehicles_anonymized, 1);
  assert.equal(deleteJson.tickets_anonymized, 1);
  assert.equal(deleteJson.tax_documents_preserved, true);

  // Verificar en BD que cliente y ticket se anonimizaron pero factura SII sigue integra
  await runWithoutTenant(async () => {
    const clientAfter = await db
      .prepare("SELECT name, rut, email, anonymized_at FROM clients WHERE id = ?")
      .get<{ name: string; rut: string | null; email: string | null; anonymized_at: string | null }>(clientId);
    assert.ok(clientAfter?.name.startsWith("Titular Anonimizado"));
    assert.equal(clientAfter?.rut, null);
    assert.equal(clientAfter?.email, null);
    assert.ok(clientAfter?.anonymized_at);

    const ticketAfter = await db
      .prepare("SELECT plate, anonymized_at FROM visitor_tickets WHERE id = ?")
      .get<{ plate: string; anonymized_at: string | null }>(oldTicketId);
    assert.equal(ticketAfter?.plate, `ANON-${oldTicketId}`);
    assert.ok(ticketAfter?.anonymized_at);

    const invoiceAfter = await db
      .prepare("SELECT folio, amount FROM invoices WHERE client_id = ?")
      .get<{ folio: number; amount: number }>(clientId);
    assert.equal(Number(invoiceAfter?.folio), 9001);
    assert.equal(Number(invoiceAfter?.amount), 50000);
  });

  // 5. Job de retencion: ticket reciente (5 dias) NO debe anonimizarse con ventana de 90 dias
  const retentionRes = await runPrivacyRetentionJob(90);
  assert.equal(retentionRes.ticketsAnonymized, 0);
  await runWithoutTenant(async () => {
    const recentAfter = await db
      .prepare("SELECT plate, anonymized_at FROM visitor_tickets WHERE id = ?")
      .get<{ plate: string; anonymized_at: string | null }>(recentTicketId);
    assert.equal(recentAfter?.plate, "RECI01");
    assert.equal(recentAfter?.anonymized_at, null);
  });
});

