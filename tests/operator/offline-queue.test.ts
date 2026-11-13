import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { operatorOperationSchema, TICKET_TOKEN_PATTERN, type OperationResult, type OperatorOperation } from "../../shared/schemas/operator";
import { resetOperatorDbForTesting } from "../../src/features/operator/offline/db";
import { findTicketByPlate, projectTickets } from "../../src/features/operator/offline/projection";
import {
  discardOperation, enqueueOperation, listOps, newClientUuid, newTicketToken, pendingOps, purgeReflectedOps,
} from "../../src/features/operator/offline/queue";
import { flushQueue } from "../../src/features/operator/offline/sync";
import type { LocalOp, SnapshotTicket } from "../../src/features/operator/offline/types";

beforeEach(async () => { await resetOperatorDbForTesting(); });

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const entry = (plate: string, extra: Partial<Extract<OperatorOperation, { type: "entry" }>> = {}): OperatorOperation =>
  ({ client_uuid: newClientUuid(), type: "entry", plate, vehicle_type: "car", branch_id: 1, occurred_at: at(60), public_token: newTicketToken(), ...extra });
const payment = (ref: { id?: number; entry_uuid?: string }, amount = 3000): OperatorOperation =>
  ({ client_uuid: newClientUuid(), type: "payment", ticket: ref, method: "cash", amount, occurred_at: at(5) });
const exit = (ref: { id?: number; entry_uuid?: string }): OperatorOperation => ({ client_uuid: newClientUuid(), type: "exit", ticket: ref, occurred_at: at(1) });

const serverTicket = (id: number, plate: string, extra: Partial<SnapshotTicket> = {}): SnapshotTicket => ({
  id, plate, status: "active", entry_time: "2026-11-13 10:00:00", vehicle_type: "car", rate_plan_id: 1, space_id: id, space_name: `P-${id}`,
  public_token: null, amount: 0, paid_at: null, exit_deadline: null, validations: [], ...extra,
});

const asLocal = (operation: OperatorOperation, seq: number, status: LocalOp["status"] = "pending", extra: Partial<LocalOp> = {}): LocalOp => ({
  seq, client_uuid: operation.client_uuid, branch_id: 1, operation, status, attempts: 0, created_at: new Date().toISOString(),
  last_error: null, code: null, warnings: [], server_ticket_id: null, applied_server_time: null, ...extra,
});

const okFetch = (handler: (operations: OperatorOperation[]) => OperationResult[], calls: OperatorOperation[][] = []) =>
  (async (_url: unknown, init: any) => {
    const operations = JSON.parse(init.body).operations as OperatorOperation[];
    calls.push(operations);
    return new Response(JSON.stringify({ server_time: new Date().toISOString(), results: handler(operations) }), { status: 200 });
  }) as typeof fetch;
const applied = (operations: OperatorOperation[], firstTicketId = 100): OperationResult[] =>
  operations.map((operation, index) => ({ client_uuid: operation.client_uuid, type: operation.type, status: "applied", ticket_id: firstTicketId, warnings: [], ...(index < 0 ? {} : {}) }));

// ------------------------------------------------------------------ proyección
test("proyección: una entrada sin conexión aparece, se paga y se cierra sin tocar la instantánea", () => {
  const snapshot = [serverTicket(1, "AAAA11")];
  const e = entry("bb-bb22");
  const base = projectTickets(snapshot, [asLocal(e, 1)]);
  assert.deepEqual(base.map(t => [t.plate, t.pending_sync, t.status]).sort(), [["AAAA11", false, "active"], ["BBBB22", true, "active"]]);
  const local = base.find(t => t.entry_uuid === e.client_uuid)!;
  assert.ok(local.id < 0, "un ticket que el servidor aún no conoce tiene id negativo");
  assert.equal(local.public_token, (e as any).public_token);

  const paid = projectTickets(snapshot, [asLocal(e, 1), asLocal(payment({ entry_uuid: e.client_uuid }, 2500), 2)]);
  const paidLocal = paid.find(t => t.entry_uuid === e.client_uuid)!;
  assert.deepEqual([paidLocal.status, paidLocal.amount], ["paid", 2500]);

  const gone = projectTickets(snapshot, [asLocal(e, 1), asLocal(payment({ entry_uuid: e.client_uuid }), 2), asLocal(exit({ entry_uuid: e.client_uuid }), 3)]);
  assert.deepEqual(gone.map(t => t.plate), ["AAAA11"]);
});

test("proyección: pagar y sacar un ticket que ya estaba en el servidor", () => {
  const snapshot = [serverTicket(1, "AAAA11"), serverTicket(2, "CCCC33")];
  const out = projectTickets(snapshot, [asLocal(payment({ id: 1 }, 1800), 1), asLocal(exit({ id: 2 }), 2)]);
  assert.deepEqual(out.map(t => [t.id, t.status, t.amount, t.pending_sync]), [[1, "paid", 1800, true]]);
});

test("proyección: una operación aplicada no se duplica cuando la instantánea nueva ya la trae", () => {
  const e = entry("DDDD44");
  const token = (e as any).public_token as string;
  const appliedEntry = asLocal(e, 1, "applied", { server_ticket_id: 7, applied_server_time: "2026-11-13T12:00:00.000Z" });
  // Instantánea desactualizada: el ticket sigue visible, ahora con su id real.
  const stale = projectTickets([], [appliedEntry]);
  assert.deepEqual(stale.map(t => [t.id, t.pending_sync]), [[7, false]]);
  // Instantánea nueva: el servidor ya lo trae (por su token) -> una sola fila.
  const refreshed = projectTickets([serverTicket(7, "DDDD44", { public_token: token })], [appliedEntry]);
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].id, 7);
  // Y también si lo reconoce solo por id.
  assert.equal(projectTickets([serverTicket(7, "DDDD44")], [appliedEntry]).length, 1);
});

test("proyección: las operaciones rechazadas no cambian lo que se ve", () => {
  const e = entry("EEEE55");
  const out = projectTickets([serverTicket(1, "AAAA11")], [asLocal(e, 1, "rejected"), asLocal(exit({ id: 1 }), 2, "rejected")]);
  assert.deepEqual(out.map(t => t.plate), ["AAAA11"]);
});

test("buscar por patente ignora espacios y guiones y prefiere la coincidencia exacta", () => {
  const tickets = projectTickets([serverTicket(1, "ABCD12"), serverTicket(2, "ABCD123")], []);
  assert.equal(findTicketByPlate(tickets, "ab-cd 12")?.id, 1);
  assert.equal(findTicketByPlate(tickets, "bcd12")?.id, 1);
  assert.equal(findTicketByPlate(tickets, "ZZZ"), undefined);
  assert.equal(findTicketByPlate(tickets, "  "), undefined);
});

// ------------------------------------------------------------------ cola y sincronización
test("las operaciones generadas por la app cumplen el esquema del servidor", () => {
  assert.match(newTicketToken(), TICKET_TOKEN_PATTERN);
  assert.notEqual(newTicketToken(), newTicketToken());
  for (const operation of [entry("ABCD12"), payment({ id: 5 }), payment({ entry_uuid: newClientUuid() }), exit({ id: 5 })]) {
    assert.ok(operatorOperationSchema.safeParse(operation).success, JSON.stringify(operation));
  }
});

test("flush: envía en orden, guarda los resultados y limpia lo que la instantánea ya refleja", async () => {
  const e = entry("FFFF66");
  const p = payment({ entry_uuid: e.client_uuid });
  await enqueueOperation(1, e);
  await enqueueOperation(1, p);
  const calls: OperatorOperation[][] = [];
  const outcome = await flushQueue(okFetch(ops => applied(ops, 55), calls));
  assert.deepEqual(calls.map(batch => batch.map(op => op.type)), [["entry", "payment"]], "un lote, en el orden en que se crearon");
  assert.equal(outcome.processed, 2);
  assert.equal((await pendingOps()).length, 0);
  const ops = await listOps(1);
  assert.deepEqual(ops.map(op => [op.status, op.server_ticket_id]), [["applied", 55], ["applied", 55]]);

  await purgeReflectedOps("2000-01-01T00:00:00.000Z");
  assert.equal((await listOps()).length, 2, "una instantánea anterior a la aplicación no limpia nada");
  await purgeReflectedOps(new Date(Date.now() + 60_000).toISOString());
  assert.equal((await listOps()).length, 0);
});

test("flush: una caída de red deja todo pendiente y el reintento no duplica", async () => {
  const e = entry("GGGG77");
  await enqueueOperation(1, e);
  const down = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
  const failed = await flushQueue(down);
  assert.equal(failed.networkError, true);
  const [pending] = await pendingOps();
  assert.deepEqual([pending.status, pending.attempts, pending.last_error], ["pending", 1, "Sin conexión con el servidor"]);

  const calls: OperatorOperation[][] = [];
  assert.equal((await flushQueue(okFetch(ops => applied(ops, 9), calls))).processed, 1);
  assert.equal(calls.length, 1);
  assert.equal((await pendingOps()).length, 0);

  // Reenviar lo mismo (el servidor respondió pero el dispositivo no lo supo): el servidor contesta duplicate.
  await resetOperatorDbForTesting();
  await enqueueOperation(1, e);
  const replay = okFetch(ops => ops.map(op => ({ client_uuid: op.client_uuid, type: op.type, status: "duplicate", original_status: "applied", ticket_id: 9, warnings: [] })));
  await flushQueue(replay);
  assert.equal((await listOps())[0].status, "applied");
});

test("flush: errores del servidor (5xx) y sesión vencida dejan las operaciones pendientes", async () => {
  await enqueueOperation(1, entry("HHHH88"));
  const server500 = (async () => new Response("boom", { status: 503 })) as typeof fetch;
  const failed = await flushQueue(server500);
  assert.equal(failed.networkError, true);
  assert.equal((await pendingOps()).length, 1);

  const expired = (async () => new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 })) as typeof fetch;
  const auth = await flushQueue(expired);
  assert.equal(auth.authError, true);
  assert.equal((await pendingOps()).length, 1, "la sesión vencida no pierde operaciones");
});

test("flush: un lote con formato inválido (400) se rechaza y no bloquea las siguientes", async () => {
  await enqueueOperation(1, entry("IIII99"));
  let call = 0;
  const fetchImpl = (async (_url: unknown, init: any) => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ error: "Datos inválidos" }), { status: 400 });
    const operations = JSON.parse(init.body).operations as OperatorOperation[];
    return new Response(JSON.stringify({ server_time: new Date().toISOString(), results: applied(operations) }), { status: 200 });
  }) as typeof fetch;
  await flushQueue(fetchImpl);
  const [rejected] = await listOps();
  assert.deepEqual([rejected.status, rejected.code], ["rejected", "INVALID"]);
  assert.equal(call, 1);

  await enqueueOperation(1, entry("JJJJ11"));
  await flushQueue(fetchImpl);
  assert.deepEqual((await listOps()).map(op => op.status), ["rejected", "applied"]);
});

test("flush: más de 50 operaciones viajan en lotes ordenados", async () => {
  const uuids: string[] = [];
  for (let i = 0; i < 120; i++) { const op = entry(`LOT${String(i).padStart(3, "0")}`); uuids.push(op.client_uuid); await enqueueOperation(1, op); }
  const calls: OperatorOperation[][] = [];
  await flushQueue(okFetch(ops => applied(ops), calls));
  assert.deepEqual(calls.map(batch => batch.length), [50, 50, 20]);
  assert.deepEqual(calls.flat().map(op => op.client_uuid), uuids, "el orden se conserva entre lotes");
});

test("flush: llamadas simultáneas comparten un solo envío", async () => {
  await enqueueOperation(1, entry("MMMM22"));
  const calls: OperatorOperation[][] = [];
  const slow = async (_u: unknown, init: any) => {
    const operations = JSON.parse(init.body).operations as OperatorOperation[];
    calls.push(operations);
    await new Promise(resolve => setTimeout(resolve, 30));
    return new Response(JSON.stringify({ server_time: new Date().toISOString(), results: applied(operations) }), { status: 200 });
  };
  const [a, b, c] = await Promise.all([flushQueue(slow as typeof fetch), flushQueue(slow as typeof fetch), flushQueue(slow as typeof fetch)]);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("flush: rechazos del servidor quedan visibles, y un token reemplazado se conserva", async () => {
  const e = entry("NNNN33");
  const rejectedEntry = entry("OOOO44");
  await enqueueOperation(1, e);
  await enqueueOperation(1, rejectedEntry);
  await flushQueue(okFetch(ops => [
    { client_uuid: ops[0].client_uuid, type: "entry", status: "applied", ticket_id: 31, public_token: "t_reemplazado_por_servidor_1234", warnings: ["QR repetido"] },
    { client_uuid: ops[1].client_uuid, type: "entry", status: "rejected", ticket_id: 12, code: "PLATE_ACTIVE", error: "La patente ya tiene un ticket activo (#12)", warnings: [] },
  ]));
  const [first, second] = await listOps();
  assert.equal((first.operation as any).public_token, "t_reemplazado_por_servidor_1234");
  assert.deepEqual(first.warnings, ["QR repetido"]);
  assert.deepEqual([second.status, second.code, second.last_error], ["rejected", "PLATE_ACTIVE", "La patente ya tiene un ticket activo (#12)"]);

  // Solo se pueden descartar las rechazadas.
  await discardOperation(first.client_uuid);
  await discardOperation(second.client_uuid);
  assert.deepEqual((await listOps()).map(op => op.client_uuid), [first.client_uuid]);
});
