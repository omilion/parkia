import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startTestServer } from "../support/apiHarness";

const harness = await startTestServer();
const { db, call } = harness;
const { quoteForDevice, resolvePlanFromCatalog } = await import("../../shared/offline-pricing");
const { calculateVisitorTicketQuote } = await import("../../server/modules/tickets/pricing");
const { getDefaultBranchId } = await import("../../server/branches");

let admin = "";
let guard = "";
let finance = "";
let branchId = 0;

before(async () => {
  admin = await harness.login();
  guard = await harness.createStaffAndLogin(admin, "guard", "guard-sync@parkia.local", "61.111.111-1");
  finance = await harness.createStaffAndLogin(admin, "finance", "finance-sync@parkia.local", "61.222.222-2");
  branchId = await getDefaultBranchId(1);
});
after(async () => { await harness.close(); });

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const sync = async (cookie: string, operations: unknown[]) => {
  const res = await call(cookie, "/api/operator/sync", { method: "POST", body: { operations } });
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  return (await res.json()).results as Array<Record<string, any>>;
};
const entryOp = (plate: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({ client_uuid: randomUUID(), type: "entry", plate, vehicle_type: "car", branch_id: branchId, occurred_at: ago(minutesAgo), ...extra });
const ticketRow = async (id: number) => await db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(id) as Record<string, any>;
const newToken = () => `t_${randomUUID().replace(/-/g, "")}`;

test("la instantánea solo la piden el guardia, la caja y el administrador", async () => {
  assert.equal((await call(finance, `/api/operator/snapshot?branch_id=${branchId}`)).status, 403);
  assert.equal((await call(guard, "/api/operator/snapshot")).status, 400);
  assert.equal((await call(guard, "/api/operator/snapshot?branch_id=999999")).status, 404);
  const snapshot = await (await call(guard, `/api/operator/snapshot?branch_id=${branchId}`)).json();
  assert.equal(snapshot.branch.id, branchId);
  assert.ok(snapshot.branch.time_zone);
  assert.ok(Array.isArray(snapshot.spaces) && Array.isArray(snapshot.tickets));
  assert.ok(snapshot.plans.length >= 1);
  assert.ok(snapshot.plans[0].pricing.rules.length >= 1, "el catálogo trae las reglas para cotizar sin red");
  assert.ok(Math.abs(Date.parse(snapshot.server_time) - Date.now()) < 60_000);
  assert.equal((await call(guard, "/api/operator/sync", { method: "POST", body: { operations: [] } })).status, 400, "un lote vacío se rechaza");
  assert.equal((await call(finance, "/api/operator/sync", { method: "POST", body: { operations: [entryOp("FIN001", 1)] } })).status, 403);
});

test("el dispositivo cotiza igual que el servidor, con y sin convenios", async () => {
  const [entry] = await sync(guard, [entryOp("PAR001", 95)]);
  const ticketId = entry.ticket_id as number;
  const snapshot = await (await call(guard, `/api/operator/snapshot?branch_id=${branchId}`)).json();
  const ticket = snapshot.tickets.find((item: any) => item.id === ticketId);
  const plan = snapshot.plans.find((item: any) => item.id === ticket.rate_plan_id) ?? resolvePlanFromCatalog(snapshot.plans, { branchId, vehicleType: ticket.vehicle_type });
  assert.ok(plan, "el ticket abierto tiene su tarifa en el catálogo");

  const at = new Date();
  const entryAt = new Date(ticket.entry_time.replace(" ", "T") + "Z");
  const device = quoteForDevice(plan.pricing, entryAt, at, ticket.validations);
  const server = (await calculateVisitorTicketQuote(ticketId, { tenantId: 1, quoteAt: at })).quote;
  assert.equal(device.total, server.total);
  assert.equal(device.durationMins, server.duration_mins);
  assert.ok(device.total > 0, "95 minutos fuera de la gracia cuestan algo");

  // Con convenios (porcentaje con tope + minutos gratis) siguen coincidiendo.
  const agreement = await db.prepare("INSERT INTO agreements (tenant_id, name, code, kind, value, cap_amount) VALUES (1, 'Sync Pan', 'SYNC-PCT', 'percent', 50, 300)").run();
  const free = await db.prepare("INSERT INTO agreements (tenant_id, name, code, kind, value) VALUES (1, 'Sync Cafe', 'SYNC-FREE', 'free_minutes', 20)").run();
  await db.prepare("INSERT INTO ticket_validations (tenant_id, ticket_id, agreement_id, validated_by) VALUES (1, ?, ?, 'staff')").run(ticketId, agreement.lastInsertRowid);
  await db.prepare("INSERT INTO ticket_validations (tenant_id, ticket_id, agreement_id, validated_by) VALUES (1, ?, ?, 'staff')").run(ticketId, free.lastInsertRowid);
  const refreshed = (await (await call(guard, `/api/operator/snapshot?branch_id=${branchId}`)).json()).tickets.find((item: any) => item.id === ticketId);
  assert.equal(refreshed.validations.length, 2);
  const withDiscounts = quoteForDevice(plan.pricing, entryAt, at, refreshed.validations);
  const serverWithDiscounts = (await calculateVisitorTicketQuote(ticketId, { tenantId: 1, quoteAt: at })).quote;
  assert.equal(withDiscounts.total, serverWithDiscounts.total);
  assert.ok(withDiscounts.total < device.total);
});

test("entrada, cobro y salida hechos sin conexión se aplican con la hora del dispositivo y son idempotentes", async () => {
  const entry = entryOp("OFF001", 120, { public_token: newToken() });
  const payment = { client_uuid: randomUUID(), type: "payment", ticket: { entry_uuid: entry.client_uuid }, method: "cash", amount: 0, occurred_at: ago(30) };
  const exit = { client_uuid: randomUUID(), type: "exit", ticket: { entry_uuid: entry.client_uuid }, occurred_at: ago(25) };

  // El monto que el dispositivo cobró es el que el motor da para esa hora de pago.
  const snapshot = await (await call(guard, `/api/operator/snapshot?branch_id=${branchId}`)).json();
  const plan = resolvePlanFromCatalog(snapshot.plans, { branchId, vehicleType: "car" })!;
  const expected = quoteForDevice(plan.pricing, new Date(entry.occurred_at), new Date(payment.occurred_at)).total;
  assert.ok(expected > 0);
  payment.amount = expected;

  const results = await sync(guard, [entry, payment, exit]);
  assert.deepEqual(results.map(item => item.status), ["applied", "applied", "applied"], JSON.stringify(results));
  const ticketId = results[0].ticket_id as number;
  assert.deepEqual(results.map(item => item.ticket_id), [ticketId, ticketId, ticketId]);
  assert.equal(results[0].public_token, entry.public_token, "el QR impreso sin red sigue siendo el del ticket");

  const row = await ticketRow(ticketId);
  assert.equal(row.status, "completed");
  assert.equal(row.payment_method, "cash");
  assert.equal(Number(row.amount), expected);
  assert.ok(row.space_id, "se le asignó una plaza libre");
  assert.ok(row.cash_session_id, "el cobro entra a una caja");
  const stamp = (value: string) => Date.parse(String(value).replace(" ", "T") + "Z");
  assert.ok(Math.abs(stamp(row.entry_time) - Date.parse(entry.occurred_at)) < 1000, "la entrada conserva la hora del dispositivo");
  assert.ok(Math.abs(stamp(row.paid_at) - Date.parse(payment.occurred_at)) < 1000, "el pago conserva la hora del dispositivo");
  assert.ok(Math.abs(stamp(row.exit_time) - Date.parse(exit.occurred_at)) < 1000, "la salida conserva la hora del dispositivo");
  assert.equal(row.public_token, entry.public_token);

  // Reenviar el mismo lote (corte de red a medio camino) no duplica nada.
  const again = await sync(guard, [entry, payment, exit]);
  assert.deepEqual(again.map(item => item.status), ["duplicate", "duplicate", "duplicate"]);
  assert.deepEqual(again.map(item => item.original_status), ["applied", "applied", "applied"]);
  assert.equal(again[0].ticket_id, ticketId);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM visitor_tickets WHERE plate = 'OFF001'").get() as any).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM operator_ops WHERE ticket_id = ?").get(ticketId) as any).n, 3);
});

test("las operaciones que no se pueden aplicar se rechazan, se registran y no se reintentan solas", async () => {
  const [first] = await sync(guard, [entryOp("REJ001", 10)]);
  const ticketId = first.ticket_id as number;

  const dup = entryOp("rej-001", 5);
  const [plateActive] = await sync(guard, [dup]);
  assert.deepEqual([plateActive.status, plateActive.code, plateActive.ticket_id], ["rejected", "PLATE_ACTIVE", ticketId]);
  const [replay] = await sync(guard, [dup]);
  assert.deepEqual([replay.status, replay.original_status, replay.code], ["duplicate", "rejected", "PLATE_ACTIVE"], "un rechazo no se reevalúa");

  const exitUnpaid = { client_uuid: randomUUID(), type: "exit", ticket: { id: ticketId }, occurred_at: ago(1) };
  assert.equal((await sync(guard, [exitUnpaid]))[0].code, "NOT_PAID");
  assert.equal((await ticketRow(ticketId)).status, "active", "una salida sin pago no cierra el ticket");

  const ghost = { client_uuid: randomUUID(), type: "payment", ticket: { entry_uuid: randomUUID() }, method: "cash", amount: 1000, occurred_at: ago(1) };
  assert.equal((await sync(guard, [ghost]))[0].code, "ENTRY_UNKNOWN");
  const missing = { client_uuid: randomUUID(), type: "payment", ticket: { id: 987654 }, method: "cash", amount: 1000, occurred_at: ago(1) };
  assert.equal((await sync(guard, [missing]))[0].code, "TICKET_NOT_FOUND");

  // Pago ya registrado por otra persona: el cobro offline se rechaza y queda auditado para revisión.
  const first$ = { client_uuid: randomUUID(), type: "payment", ticket: { id: ticketId }, method: "cash", amount: 4000, occurred_at: ago(2) };
  assert.equal((await sync(guard, [first$]))[0].status, "applied");
  const second$ = { ...first$, client_uuid: randomUUID(), occurred_at: ago(1) };
  const [double] = await sync(guard, [second$]);
  assert.deepEqual([double.status, double.code], ["rejected", "ALREADY_PAID"]);
  const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'operator_op.rejected' AND entity_id = ?").get(String(ticketId)) as any;
  assert.ok(Number(audit.n) >= 1);

  // Una entrada rechazada arrastra a sus operaciones dependientes.
  const rejectedEntry = entryOp("REJ001", 3);
  await sync(guard, [rejectedEntry]);
  const dependent = { client_uuid: randomUUID(), type: "payment", ticket: { entry_uuid: rejectedEntry.client_uuid }, method: "cash", amount: 100, occurred_at: ago(1) };
  assert.equal((await sync(guard, [dependent]))[0].code, "ENTRY_REJECTED");
});

test("la hora del dispositivo se acota y las diferencias de monto quedan marcadas", async () => {
  // Reloj adelantado: se usa la hora del servidor.
  const future = entryOp("CLK001", 0, { occurred_at: new Date(Date.now() + 3 * 3_600_000).toISOString() });
  const [clamped] = await sync(guard, [future]);
  assert.equal(clamped.status, "applied");
  assert.ok(clamped.warnings.some((warning: string) => /adelantado/.test(warning)));
  assert.ok(Date.parse((await ticketRow(clamped.ticket_id)).entry_time.replace(" ", "T") + "Z") <= Date.now() + 1000);

  // Más de 14 días: se rechaza.
  assert.equal((await sync(guard, [entryOp("OLD001", 15 * 24 * 60)]))[0].code, "TOO_OLD");

  // Cobro por menos de lo calculado: se registra (el dinero ya cambió de manos) y queda marcado.
  const [entry] = await sync(guard, [entryOp("MIS001", 200)]);
  const paid = { client_uuid: randomUUID(), type: "payment", ticket: { id: entry.ticket_id }, method: "cash", amount: 100, occurred_at: ago(1) };
  const [result] = await sync(guard, [paid]);
  assert.equal(result.status, "applied");
  assert.ok(result.warnings.some((warning: string) => /Se cobró \$100/.test(warning)), result.warnings.join("|"));
  const row = await ticketRow(entry.ticket_id);
  assert.equal(Number(row.amount), 100);
  assert.match(row.payment_override_reason, /menor al calculado/);

  // Un QR repetido se reemplaza por uno nuevo.
  const token = newToken();
  const [a] = await sync(guard, [entryOp("TOK001", 5, { public_token: token })]);
  const [b] = await sync(guard, [entryOp("TOK002", 5, { public_token: token })]);
  assert.equal(a.public_token, token);
  assert.notEqual(b.public_token, token);
  assert.ok(b.warnings.some((warning: string) => /QR/.test(warning)));
});

test("sin plazas libres el auto igual se registra, sin plaza asignada", async () => {
  const occupied = await db.prepare("SELECT id FROM spaces WHERE type = 'parking' AND status = 'available'").all() as Array<{ id: number }>;
  for (const space of occupied) await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(space.id);
  try {
    const [result] = await sync(guard, [entryOp("FULL01", 3)]);
    assert.equal(result.status, "applied");
    assert.ok(result.warnings.some((warning: string) => /sin plaza/.test(warning)), result.warnings.join("|"));
    assert.equal((await ticketRow(result.ticket_id)).space_id, null);
  } finally {
    for (const space of occupied) await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ?").run(space.id);
  }
});

test("los esquemas rechazan operaciones mal formadas", async () => {
  const bad = async (operation: unknown) => (await call(guard, "/api/operator/sync", { method: "POST", body: { operations: [operation] } })).status;
  assert.equal(await bad({ ...entryOp("BAD001", 1), client_uuid: "no-es-uuid" }), 400);
  assert.equal(await bad({ ...entryOp("BAD002", 1), occurred_at: "ayer" }), 400);
  assert.equal(await bad({ ...entryOp("BAD003", 1), public_token: "script:alert(1)" }), 400);
  assert.equal(await bad({ client_uuid: randomUUID(), type: "payment", ticket: { id: 1 }, method: "card", amount: 100, occurred_at: ago(1) }), 400, "sin conexión solo se acepta efectivo");
  assert.equal(await bad({ client_uuid: randomUUID(), type: "payment", ticket: {}, method: "cash", amount: 100, occurred_at: ago(1) }), 400);
  assert.equal(await bad({ client_uuid: randomUUID(), type: "payment", ticket: { id: 1, entry_uuid: randomUUID() }, method: "cash", amount: 100, occurred_at: ago(1) }), 400);
  assert.equal(await bad({ client_uuid: randomUUID(), type: "payment", ticket: { id: 1 }, method: "cash", amount: -5, occurred_at: ago(1) }), 400);
});
