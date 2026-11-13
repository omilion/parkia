import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let admin = "";
let entryCam = "";
let exitCam = "";

const createDevice = async (body: Record<string, unknown>) => {
  const res = await fetch(`${harness.baseUrl}/api/devices`, { method: "POST", headers: { "Content-Type": "application/json", cookie: admin }, body: JSON.stringify(body) });
  assert.equal(res.status, 201);
  return (await res.json()) as { id: number; api_key: string };
};
const plateEvent = async (key: string, plate: string) => {
  const res = await fetch(`${harness.baseUrl}/api/device/v1/events`, { method: "POST", headers: { "Content-Type": "application/json", "x-device-key": key }, body: JSON.stringify({ plate }) });
  assert.equal(res.status, 201);
  return (await res.json()) as { decision: string; reason: string; queued_command_id: number | null; ticket_id?: number | null };
};
const addTicket = async (plate: string, status: string) => {
  const space = await db.prepare("INSERT INTO spaces (name, type, status, price, tenant_id) VALUES (?, 'parking', 'occupied', 1000, 1)").run(`LPR-${plate}`);
  await db.prepare("INSERT INTO visitor_tickets (plate, space_id, status, entry_time, tenant_id) VALUES (?, ?, ?, datetime('now', '-40 minutes'), 1)").run(plate, space.lastInsertRowid, status);
};
const accessLogs = async (plate: string) => await db.prepare("SELECT status, reason FROM access_logs WHERE plate = ?").all(plate) as Array<{ status: string; reason: string }>;

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  admin = await harness.loginAs("admin@parkia.local", "admin123");
  await createDevice({ name: "Barrera salida", type: "barrier", direction: "exit", vendor: "generic" });
  entryCam = (await createDevice({ name: "Camara entrada", type: "lpr", direction: "entry", vendor: "hikvision" })).api_key;
  exitCam = (await createDevice({ name: "Camara salida", type: "lpr", direction: "exit", vendor: "hikvision" })).api_key;
});
after(async () => { await harness.close(); });

test("camara de salida: solo un ticket PAGADO abre la barrera", async () => {
  await addTicket("PAGADO1", "paid");
  const result = await plateEvent(exitCam, "PAGADO1");
  assert.deepEqual([result.decision, result.reason], ["allow", "ticket_pagado"]);
  assert.ok(result.queued_command_id, "se encolo la orden de abrir");
  assert.deepEqual((await accessLogs("PAGADO1")).map(row => row.status), ["authorized"]);
});

test("camara de salida: un ticket pendiente de pago NO abre la barrera", async () => {
  await addTicket("DEBE001", "active");
  const result = await plateEvent(exitCam, "DEBE001");
  assert.deepEqual([result.decision, result.reason, result.queued_command_id], ["deny", "ticket_pendiente_de_pago", null]);
  assert.deepEqual((await accessLogs("DEBE001")).map(row => row.status), ["denied"]);
});

test("camara de salida: un ticket YA CERRADO (el auto ya salio) no autoriza otra salida", async () => {
  await addTicket("CERRADO1", "completed");
  const result = await plateEvent(exitCam, "CERRADO1");
  assert.deepEqual([result.decision, result.reason, result.queued_command_id], ["deny", "ticket_ya_cerrado", null]);
  assert.deepEqual((await accessLogs("CERRADO1")).map(row => row.status), ["denied"]);
});

test("camara de salida: una placa sin ticket no abre nada", async () => {
  const result = await plateEvent(exitCam, "NADIE001");
  assert.equal(result.decision, "logged");
  assert.equal(result.queued_command_id, null);
});

test("un evento sin decision no se anota como acceso autorizado", async () => {
  await plateEvent(entryCam, "VISITA01"); // camara de entrada, sin abonado ni ticket
  await plateEvent(exitCam, "FANTASMA");
  assert.deepEqual(await accessLogs("VISITA01"), []);
  assert.deepEqual(await accessLogs("FANTASMA"), []);
  const events = await db.prepare("SELECT COUNT(*) AS n FROM device_events WHERE plate IN ('VISITA01', 'FANTASMA')").get() as { n: number | string };
  assert.equal(Number(events.n), 2, "pero el evento si queda registrado");
});

test("un abonado con contrato activo entra y se abre la barrera", async () => {
  const client = await db.prepare("INSERT INTO clients (tenant_id, name, rut, type, status) VALUES (1, 'Abonado LPR2', '15.111.222-3', 'natural', 'active')").run();
  await db.prepare("INSERT INTO vehicles (tenant_id, client_id, plate, status) VALUES (1, ?, 'ABON001', 'active')").run(client.lastInsertRowid);
  const branch = await db.prepare("SELECT id FROM branches WHERE tenant_id = 1 ORDER BY id LIMIT 1").get() as { id: number };
  await db.prepare("INSERT INTO contracts (tenant_id, branch_id, client_id, start_date, monthly_fee, billing_day, status) VALUES (1, ?, ?, '2026-01-01', 50000, 5, 'active')").run(branch.id, client.lastInsertRowid);
  const result = await plateEvent(entryCam, "ABON001");
  assert.deepEqual([result.decision, result.reason], ["allow", "abonado_activo"]);
});

test("sin clave de dispositivo o con una clave falsa no se acepta nada", async () => {
  const noKey = await fetch(`${harness.baseUrl}/api/device/v1/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plate: "XX0000" }) });
  assert.equal(noKey.status, 401);
  const fake = await fetch(`${harness.baseUrl}/api/device/v1/events`, { method: "POST", headers: { "Content-Type": "application/json", "x-device-key": "pk_dev_falsa" }, body: JSON.stringify({ plate: "XX0000" }) });
  assert.equal(fake.status, 401);
});
