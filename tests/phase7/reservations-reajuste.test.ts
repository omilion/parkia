import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let runWithTenant: typeof import("../../server/db/engine/context").runWithTenant;
let runJobNow: typeof import("../../server/platform/jobs").runJobNow;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ runWithTenant } = await import("../../server/db/engine/context"));
  ({ runJobNow } = await import("../../server/platform/jobs"));
});

after(async () => {
  await harness.close();
});

test("7.4 Reservas (anti-superposicion, check-in, cancelacion) y reajuste automatico por IPC/UF", async () => {
  const adminCookie = await harness.loginAs("admin@parkia.local", "admin123");

  const ctxRes = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(ctxRes.status, 200);
  const { tenant } = (await ctxRes.json()) as { tenant: { id: number } };

  const seeded = await runWithTenant(tenant.id, async () => {
    const branchRow = await db
      .prepare("SELECT id FROM branches WHERE tenant_id = ? ORDER BY id ASC LIMIT 1")
      .get<{ id: number }>(tenant.id);
    const branchId = branchRow?.id ?? null;

    const spaceInsert = await db
      .prepare(
        `INSERT INTO spaces (tenant_id, branch_id, name, type, price, status)
         VALUES (?, ?, 'RES-01', 'parking', 50000, 'available')`,
      )
      .run(tenant.id, branchId);
    const spaceId = Number(spaceInsert.lastInsertRowid);

    const clientInsert = await db
      .prepare(
        `INSERT INTO clients (tenant_id, name, email, status)
         VALUES (?, 'Cliente Reajuste', 'reajuste@empresa.cl', 'active')`,
      )
      .run(tenant.id);
    const clientId = Number(clientInsert.lastInsertRowid);

    const ipcContractInsert = await db
      .prepare(
        `INSERT INTO contracts
           (tenant_id, branch_id, client_id, start_date, monthly_fee, billing_day, status, adjustment_index)
         VALUES (?, ?, ?, '2026-10-01', 100000, 5, 'active', 'ipc')`,
      )
      .run(tenant.id, branchId, clientId);

    const ufContractInsert = await db
      .prepare(
        `INSERT INTO contracts
           (tenant_id, branch_id, client_id, start_date, monthly_fee, billing_day, status, adjustment_index, base_uf_value)
         VALUES (?, ?, ?, '2026-10-01', 100000, 5, 'active', 'uf', 38000)`,
      )
      .run(tenant.id, branchId, clientId);

    return {
      branchId,
      spaceId,
      ipcContractId: Number(ipcContractInsert.lastInsertRowid),
      ufContractId: Number(ufContractInsert.lastInsertRowid),
    };
  });

  // 1. Crear reserva
  const res1 = await fetch(`${harness.baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      space_id: seeded.spaceId,
      plate: "RSV100",
      visitor_name: "Visita 1",
      starts_at: "2026-11-20T10:00:00Z",
      ends_at: "2026-11-20T14:00:00Z",
    }),
  });
  assert.equal(res1.status, 201);
  const { reservation: created1 } = (await res1.json()) as {
    reservation: { id: number; qr_token: string; status: string };
  };
  assert.ok(created1.qr_token.startsWith("RES-"));
  assert.equal(created1.status, "confirmed");

  // 2. Superposicion en el mismo espacio -> 409
  const overlapRes = await fetch(`${harness.baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      space_id: seeded.spaceId,
      plate: "RSV200",
      starts_at: "2026-11-20T12:00:00Z",
      ends_at: "2026-11-20T16:00:00Z",
    }),
  });
  assert.equal(overlapRes.status, 409);

  // 3. Check-in de reserva 1
  const checkinRes = await fetch(`${harness.baseUrl}/api/reservations/${created1.id}/check-in`, {
    method: "POST",
    headers: { cookie: adminCookie },
  });
  assert.equal(checkinRes.status, 200);
  const { reservation: checkedIn } = (await checkinRes.json()) as { reservation: { status: string } };
  assert.equal(checkedIn.status, "checked_in");

  // 4. Segunda reserva en otro horario + cancelacion
  const res2 = await fetch(`${harness.baseUrl}/api/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      space_id: seeded.spaceId,
      plate: "RSV300",
      starts_at: "2026-11-21T10:00:00Z",
      ends_at: "2026-11-21T12:00:00Z",
    }),
  });
  assert.equal(res2.status, 201);
  const { reservation: created2 } = (await res2.json()) as { reservation: { id: number } };

  const cancelRes = await fetch(`${harness.baseUrl}/api/reservations/${created2.id}/cancel`, {
    method: "POST",
    headers: { cookie: adminCookie },
  });
  assert.equal(cancelRes.status, 200);
  const { reservation: cancelled } = (await cancelRes.json()) as { reservation: { status: string } };
  assert.equal(cancelled.status, "cancelled");

  // 5. Registrar IPC del mes actual y ejecutar job contracts.reajuste
  const currentPeriod = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
  const ipcRes = await fetch(`${harness.baseUrl}/api/contracts/reajuste/ipc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ period: currentPeriod, variation_pct: 1.5, source: "ine" }),
  });
  assert.equal(ipcRes.status, 201);

  const jobRun1 = (await runJobNow("contracts.reajuste")) as { adjusted?: number };
  assert.ok((jobRun1.adjusted ?? 0) >= 1);

  const updatedIpcContract = await runWithTenant(tenant.id, async () =>
    db
      .prepare("SELECT monthly_fee FROM contracts WHERE tenant_id = ? AND id = ?")
      .get<{ monthly_fee: number }>(tenant.id, seeded.ipcContractId),
  );
  assert.equal(updatedIpcContract?.monthly_fee, 101500);

  // Idempotencia en segunda ejecucion del job para el mismo periodo
  const jobRun2 = (await runJobNow("contracts.reajuste")) as { adjusted?: number };
  assert.equal(jobRun2.adjusted, 0);

  // 6. Reajuste por UF explicito
  const ufReajusteRes = await fetch(`${harness.baseUrl}/api/contracts/${seeded.ufContractId}/reajuste`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ index_type: "uf", period_key: "2026-11-UF", uf_value_clp: 39900 }),
  });
  assert.equal(ufReajusteRes.status, 201);
  const ufJson = (await ufReajusteRes.json()) as { ok: boolean; adjustment: { new_fee: number } };
  assert.equal(ufJson.ok, true);
  assert.equal(ufJson.adjustment.new_fee, 105000);

  // Repeticion del mismo periodo UF -> 409
  const ufDupRes = await fetch(`${harness.baseUrl}/api/contracts/${seeded.ufContractId}/reajuste`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ index_type: "uf", period_key: "2026-11-UF", uf_value_clp: 39900 }),
  });
  assert.equal(ufDupRes.status, 409);
});

