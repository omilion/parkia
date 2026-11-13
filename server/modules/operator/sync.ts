import type { Request } from "express";
import { db } from "../../db";
import { recordAuditEvent } from "../../audit";
import { getBranchOrDefault } from "../../branches";
import { getCurrentUser } from "../../auth/sessions";
import { getTenantIdFromRequest } from "../../tenant";
import type { OperationResult, OperatorOperation } from "../../../shared/schemas/operator";
import { ensureOpenCashSession, recordVisitorCashMovement } from "../cash/service";
import { dteService } from "../dte/instance";
import { createVisitorTicketQuote } from "../tickets/pricing";
import {
  completeVisitorTicketAndReleaseSpaceInTx, findActiveTicketByNormalizedPlate, findParkingSpaceForNewTicket, findVisitorTicketById,
  insertManualVisitorTicketAndOccupySpace, markVisitorTicketPaidAndQuoteUsed, newTicketPublicToken, normalizePlate,
} from "../tickets/repo";

/**
 * Aplica en el servidor las operaciones que un dispositivo guardó sin conexión.
 *
 * - Idempotente: cada operación lleva un `client_uuid`; reenviarla devuelve el resultado original (`duplicate`).
 * - La hora la informa el dispositivo, pero el servidor la acota: nunca en el futuro y no más de 14 días atrás.
 * - El servidor recalcula el cobro con la hora real del dispositivo; si lo cobrado difiere, igual se registra
 *   (el dinero ya cambió de manos) y se deja una advertencia para revisión.
 * - Una operación rechazada también se registra: no se reintenta sola, requiere decisión de una persona.
 */

const MAX_AGE_MS = 14 * 86_400_000;
const CLOCK_TOLERANCE_MS = 5 * 60_000;

const sqlTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

class Rejection extends Error {
  constructor(readonly code: string, message: string, readonly ticketId: number | null = null) {
    super(message);
  }
}

type Context = { req: Request; tenantId: number; staffId: number | null; now: Date };
type Outcome = { ticketId: number; appliedAt: Date; warnings: string[]; publicToken?: string; afterCommit?: () => Promise<void> };

async function resolveTicketId(ctx: Context, ref: { id?: number; entry_uuid?: string }) {
  if (ref.id) return ref.id;
  const entry = await db.prepare("SELECT status, ticket_id FROM operator_ops WHERE tenant_id = ? AND client_uuid = ? AND type = 'entry'").get(ctx.tenantId, ref.entry_uuid) as { status: string; ticket_id: number | null } | undefined;
  if (!entry) throw new Rejection("ENTRY_UNKNOWN", "La entrada de este ticket no llegó al servidor");
  if (entry.status !== "applied" || !entry.ticket_id) throw new Rejection("ENTRY_REJECTED", "La entrada de este ticket fue rechazada");
  return entry.ticket_id;
}

function effectiveTime(ctx: Context, occurredAt: string, warnings: string[]) {
  const device = new Date(occurredAt);
  if (device.getTime() > ctx.now.getTime() + CLOCK_TOLERANCE_MS) {
    warnings.push("El reloj del dispositivo iba adelantado: se usó la hora del servidor");
    return ctx.now;
  }
  if (ctx.now.getTime() - device.getTime() > MAX_AGE_MS) throw new Rejection("TOO_OLD", "La operación tiene más de 14 días de antigüedad");
  return device.getTime() > ctx.now.getTime() ? ctx.now : device;
}

async function applyEntry(ctx: Context, op: Extract<OperatorOperation, { type: "entry" }>): Promise<Outcome> {
  const warnings: string[] = [];
  const appliedAt = effectiveTime(ctx, op.occurred_at, warnings);
  const plate = op.plate.replace(/\s+/g, "").toUpperCase();
  const active = await findActiveTicketByNormalizedPlate(normalizePlate(plate), ctx.tenantId);
  if (active) throw new Rejection("PLATE_ACTIVE", `La patente ya tiene un ticket activo (#${active.id})`, Number(active.id));

  let branchId: number;
  try {
    branchId = await getBranchOrDefault(op.branch_id, ctx.tenantId);
  } catch {
    throw new Rejection("BRANCH_INVALID", "La sucursal no existe o está inactiva");
  }
  // El auto ya está dentro: si no queda plaza libre igual se registra, sin plaza asignada.
  const space = await findParkingSpaceForNewTicket({ tenantId: ctx.tenantId, branchId, spaceId: null });
  if (!space) warnings.push("No había plazas libres: el ticket quedó sin plaza asignada");

  let token = op.public_token;
  if (token) {
    const taken = await db.prepare("SELECT id FROM visitor_tickets WHERE public_token = ?").get(token);
    if (taken) { token = undefined; warnings.push("El código QR impreso en el dispositivo ya existía: el ticket tiene uno nuevo"); }
  }
  token ??= newTicketPublicToken();

  const user = await getCurrentUser(ctx.req);
  const inserted = await insertManualVisitorTicketAndOccupySpace({
    plate, spaceId: space ? Number(space.id) : null, spaceName: space ? String(space.name) : null,
    ticketBranchId: Number(space?.branch_id || branchId), staffId: ctx.staffId, staffName: user?.name || null,
    tenantId: ctx.tenantId, vehicleType: op.vehicle_type, entryTime: sqlTime(appliedAt), publicToken: token,
  });
  return { ticketId: inserted.ticketId, appliedAt, warnings, publicToken: token };
}

async function applyPayment(ctx: Context, op: Extract<OperatorOperation, { type: "payment" }>): Promise<Outcome> {
  const warnings: string[] = [];
  const appliedAt = effectiveTime(ctx, op.occurred_at, warnings);
  const ticketId = await resolveTicketId(ctx, op.ticket);
  const ticket = await findVisitorTicketById(ticketId, ctx.tenantId);
  if (!ticket) throw new Rejection("TICKET_NOT_FOUND", `El ticket #${ticketId} no existe`);
  if (ticket.status === "paid" || ticket.status === "completed") {
    throw new Rejection("ALREADY_PAID", "El ticket ya estaba pagado en el servidor: revisa si se cobró dos veces", ticketId);
  }

  // Cotizacion con la hora real del dispositivo, no la de llegada al servidor.
  const quote = await createVisitorTicketQuote(ticketId, { tenantId: ctx.tenantId, quoteAt: appliedAt });
  const required = Number(quote.total);
  if (op.amount !== required) warnings.push(`Se cobró $${op.amount.toLocaleString("es-CL")} y el servidor calcula $${required.toLocaleString("es-CL")} para esa hora`);

  const user = await getCurrentUser(ctx.req);
  const cashSession = await ensureOpenCashSession(user, null, { tenantId: ctx.tenantId, branchId: ticket.branch_id || null });
  await markVisitorTicketPaidAndQuoteUsed({
    ticketId, tenantId: ctx.tenantId, method: "cash", amount: op.amount, quoteId: Number(quote.id), requiredAmount: required,
    staffId: ctx.staffId, cashSessionId: Number(cashSession.id), paidAt: sqlTime(appliedAt),
    // El dinero ya cambio de manos: lo cobrado se registra tal cual y la diferencia queda marcada para revision.
    overrideReason: op.amount < required ? "Cobro registrado sin conexión por un monto menor al calculado" : null,
  });
  await recordVisitorCashMovement({
    cashSessionId: Number(cashSession.id), ticketId, method: "cash", amount: op.amount, staffId: ctx.staffId,
    note: "Cobro registrado sin conexión", tenantId: ctx.tenantId,
  });

  return {
    ticketId, appliedAt, warnings,
    afterCommit: async () => {
      // La boleta nunca puede hacer fallar un cobro ya hecho: si no se emite, la conciliacion la reintenta.
      await dteService.issueBoletaForTicket(ctx.tenantId, {
        ticketId, plate: ticket.plate, amount: op.amount, durationMins: Number(quote.duration_mins || 0), branchId: ticket.branch_id || null, staffId: ctx.staffId,
      }).catch(() => undefined);
    },
  };
}

async function applyExit(ctx: Context, op: Extract<OperatorOperation, { type: "exit" }>): Promise<Outcome> {
  const warnings: string[] = [];
  const appliedAt = effectiveTime(ctx, op.occurred_at, warnings);
  const ticketId = await resolveTicketId(ctx, op.ticket);
  const ticket = await findVisitorTicketById(ticketId, ctx.tenantId);
  if (!ticket) throw new Rejection("TICKET_NOT_FOUND", `El ticket #${ticketId} no existe`);
  if (ticket.status === "completed") return { ticketId, appliedAt, warnings: [...warnings, "El ticket ya estaba cerrado en el servidor"] };
  if (ticket.status !== "paid") throw new Rejection("NOT_PAID", "La salida se registró sin un pago confirmado en el servidor", ticketId);
  await completeVisitorTicketAndReleaseSpaceInTx({ ticket, staffId: ctx.staffId, tenantId: ctx.tenantId, exitTime: sqlTime(appliedAt) });
  return { ticketId, appliedAt, warnings };
}

const auditActions = { entry: "visitor_ticket.created", payment: "visitor_ticket.paid", exit: "visitor_ticket.completed" } as const;

async function storedResult(row: Record<string, any>): Promise<OperationResult> {
  const [code, ...rest] = String(row.error || "").split(": ");
  const token = row.type === "entry" && row.ticket_id
    ? (await db.prepare("SELECT public_token FROM visitor_tickets WHERE id = ?").get(row.ticket_id) as { public_token: string | null } | undefined)?.public_token
    : null;
  return {
    client_uuid: row.client_uuid, type: row.type, status: "duplicate", original_status: row.status, ticket_id: row.ticket_id ?? null,
    ...(token ? { public_token: token } : {}),
    ...(row.error ? { code, error: rest.join(": ") } : {}),
    warnings: row.warnings_json ? JSON.parse(row.warnings_json) : [],
  };
}

/** Procesa una operacion. Nunca lanza por errores de negocio: los devuelve como `rejected`. */
export async function processOperation(ctx: Context, op: OperatorOperation): Promise<OperationResult> {
  const previous = await db.prepare("SELECT * FROM operator_ops WHERE tenant_id = ? AND client_uuid = ?").get(ctx.tenantId, op.client_uuid) as Record<string, any> | undefined;
  if (previous) return await storedResult(previous);

  let outcome: Outcome | null = null;
  let rejection: Rejection | null = null;
  try {
    outcome = await db.transaction(async () => {
      const applied = op.type === "entry" ? await applyEntry(ctx, op) : op.type === "payment" ? await applyPayment(ctx, op) : await applyExit(ctx, op);
      await db.prepare(`
        INSERT INTO operator_ops (tenant_id, client_uuid, type, status, ticket_id, staff_id, device_time, applied_time, warnings_json)
        VALUES (?, ?, ?, 'applied', ?, ?, ?, ?, ?)
      `).run(ctx.tenantId, op.client_uuid, op.type, applied.ticketId, ctx.staffId, op.occurred_at, applied.appliedAt.toISOString(), applied.warnings.length ? JSON.stringify(applied.warnings) : null);
      return applied;
    })();
  } catch (error) {
    if (!(error instanceof Rejection)) throw error;
    rejection = error;
    await db.prepare(`
      INSERT INTO operator_ops (tenant_id, client_uuid, type, status, ticket_id, staff_id, device_time, error)
      VALUES (?, ?, ?, 'rejected', ?, ?, ?, ?)
    `).run(ctx.tenantId, op.client_uuid, op.type, error.ticketId, ctx.staffId, op.occurred_at, `${error.code}: ${error.message}`);
  }

  if (rejection) {
    await recordAuditEvent(ctx.req, { action: "operator_op.rejected", entityType: "visitor_ticket", entityId: rejection.ticketId ?? 0, metadata: { type: op.type, client_uuid: op.client_uuid, code: rejection.code, message: rejection.message } });
    return { client_uuid: op.client_uuid, type: op.type, status: "rejected", ticket_id: rejection.ticketId, code: rejection.code, error: rejection.message, warnings: [] };
  }

  const applied = outcome!;
  await recordAuditEvent(ctx.req, {
    action: auditActions[op.type], entityType: "visitor_ticket", entityId: applied.ticketId,
    metadata: { offline: true, client_uuid: op.client_uuid, device_time: op.occurred_at, applied_time: applied.appliedAt.toISOString(), warnings: applied.warnings, ...(op.type === "payment" ? { amount: op.amount } : {}) },
  });
  if (applied.afterCommit) await applied.afterCommit();
  return {
    client_uuid: op.client_uuid, type: op.type, status: "applied", ticket_id: applied.ticketId,
    ...(applied.publicToken ? { public_token: applied.publicToken } : {}), warnings: applied.warnings,
  };
}

export async function processOperations(req: Request, operations: OperatorOperation[]) {
  const user = await getCurrentUser(req);
  const ctx: Context = { req, tenantId: await getTenantIdFromRequest(req), staffId: user?.id ?? null, now: new Date() };
  const results: OperationResult[] = [];
  // En orden: un pago puede depender de la entrada que viaja en el mismo lote.
  for (const operation of operations) results.push(await processOperation(ctx, operation));
  return results;
}
