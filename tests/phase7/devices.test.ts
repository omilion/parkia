import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let runWithoutTenant: typeof import("../../server/db/engine/context").runWithoutTenant;
let setBarrierRelayAdapter: typeof import("../../server/modules/phase7/devices").setBarrierRelayAdapter;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ runWithoutTenant } = await import("../../server/db/engine/context"));
  ({ setBarrierRelayAdapter } = await import("../../server/modules/phase7/devices"));
});

after(async () => {
  await harness.close();
});

test("7.1 API de dispositivos: clave por dispositivo, adaptador LPR Hikvision/Dahua, polling de barrera y rele Shelly", async () => {
  const adminCookie = await harness.loginAs("admin@parkia.local", "admin123");

  // Rechaza evento sin clave de dispositivo
  const unauthRes = await fetch(`${harness.baseUrl}/api/device/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plate: "ABCD12" }),
  });
  assert.equal(unauthRes.status, 401);

  // Registrar camara LPR Hikvision y barrera Shelly
  const lprRes = await fetch(`${harness.baseUrl}/api/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      name: "LPR Entrada Principal",
      type: "lpr",
      direction: "entry",
      vendor: "hikvision",
    }),
  });
  assert.equal(lprRes.status, 201);
  const lprDevice = (await lprRes.json()) as { id: number; api_key: string };
  assert.ok(lprDevice.api_key.startsWith("pk_dev_"));

  const barrierRes = await fetch(`${harness.baseUrl}/api/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      name: "Barrera Entrada Principal",
      type: "barrier",
      direction: "entry",
      vendor: "shelly",
      endpoint_url: "http://192.168.1.99/relay/0",
    }),
  });
  assert.equal(barrierRes.status, 201);
  const barrierDevice = (await barrierRes.json()) as { id: number; api_key: string };

  // Crear abonado activo con vehiculo ABCD12 en tenant 1
  await runWithoutTenant(async () => {
    const clientRes = await db
      .prepare(
        `INSERT INTO clients (tenant_id, name, rut, type, status)
         VALUES (1, 'Abonado LPR', '14.555.666-K', 'natural', 'active')`,
      )
      .run();
    const clientId = Number(clientRes.lastInsertRowid);
    const space = await db.prepare("SELECT id FROM spaces WHERE tenant_id = 1 LIMIT 1").get<{ id: number }>();
    await db
      .prepare("INSERT INTO vehicles (tenant_id, client_id, plate, status) VALUES (1, ?, 'ABCD12', 'active')")
      .run(clientId);
    await db
      .prepare(
        `INSERT INTO contracts (tenant_id, client_id, space_id, monthly_fee, start_date, status)
         VALUES (1, ?, ?, 50000, '2026-11-01', 'active')`,
      )
      .run(clientId, space!.id);
  });

  // Evento LPR formato Hikvision (sin sesion humana, solo X-Device-Key)
  const eventRes = await fetch(`${harness.baseUrl}/api/device/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Key": lprDevice.api_key,
    },
    body: JSON.stringify({
      ANPR: { licensePlate: "ABCD-12" },
    }),
  });
  assert.equal(eventRes.status, 201);
  const eventJson = (await eventRes.json()) as {
    plate: string;
    decision: string;
    reason: string;
    queued_command_id: number | null;
  };
  assert.equal(eventJson.plate, "ABCD12");
  assert.equal(eventJson.decision, "allow");
  assert.equal(eventJson.reason, "abonado_activo");
  assert.ok(eventJson.queued_command_id);

  // Barrera hace poll y recibe comando open_barrier, luego hace ack
  const pollRes = await fetch(`${harness.baseUrl}/api/device/v1/commands/poll`, {
    headers: { Authorization: `Bearer ${barrierDevice.api_key}` },
  });
  assert.equal(pollRes.status, 200);
  const pollJson = (await pollRes.json()) as { commands: Array<{ id: number; command: string }> };
  assert.equal(pollJson.commands.length, 1);
  assert.equal(pollJson.commands[0]?.command, "open_barrier");

  const ackRes = await fetch(
    `${harness.baseUrl}/api/device/v1/commands/${pollJson.commands[0]!.id}/ack`,
    {
      method: "POST",
      headers: { "X-Device-Key": barrierDevice.api_key },
    },
  );
  assert.equal(ackRes.status, 200);

  // Comando manual desde panel admin dispara adaptador de rele Shelly
  let relayTriggered = false;
  setBarrierRelayAdapter({
    async trigger(dev, cmd) {
      if (dev.id === barrierDevice.id && cmd === "open_barrier") {
        relayTriggered = true;
      }
      return { ok: true, detail: "mock_shelly_ok" };
    },
  });
  const manualRes = await fetch(`${harness.baseUrl}/api/devices/${barrierDevice.id}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ command: "open_barrier" }),
  });
  assert.equal(manualRes.status, 201);
  assert.equal(relayTriggered, true);
});

