import type { Request } from "express";
import { dteService } from "../dte/instance";
import { recordAuditEvent } from "../../audit";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { db } from "../../db";
import { assertPlanLimit, getTenantIdFromRequest } from "../../tenant";
import {
  ensureOpenCashSession,
  normalizePaymentMethod,
  recordVisitorCashMovement,
} from "../cash/service";
import {
  calculateVisitorTicketQuote,
  createVisitorTicketQuote,
  getUsableVisitorQuote,
} from "./pricing";
import {
  completeVisitorPassExitInDb,
  completeVisitorTicketAndReleaseSpaceInTx,
  findActiveTicketByExactPlate,
  findActiveTicketByNormalizedPlate,
  findFirstAvailableParkingSpaceInBranch,
  findParkingSpaceForNewTicket,
  findSpaceBranchIdById,
  findSpaceByIdAndTenant,
  findSpaceNameById,
  findVisitorPassById,
  findVisitorTicketById,
  findVisitorTicketPaidAtById,
  getCurrentSqliteDateTimeString,
  insertManualVisitorTicketAndOccupySpace,
  insertQrVisitorTicketRow,
  insertVisitorPassRow,
  markVisitorPassExpiredById,
  markVisitorTicketPaidAndQuoteUsed,
  normalizePlate,
  occupySpaceByIdAndTenant,
  queryActiveVisitorTickets,
  queryVisitorPassesForTenant,
  queryVisitorPayments,
  recordVisitorPassEntryInDb,
} from "./repo";

function normalizeVisitorDateTime(value: string, boundary: "start" | "end") {
  if (value.includes("T")) return `${value.replace("T", " ")}:00`;
  return `${value} ${boundary === "start" ? "00:00:00" : "23:59:59"}`;
}

function visitorTicketPlate(pass: Record<string, any>) {
  return pass.plate || `PASS-${pass.id}`;
}

function buildVisitorReceipt(input: {
  ticket: Record<string, any>;
  quote: Record<string, any>;
  method: string;
  amount: number;
  cashierName?: string | null;
  cashSessionId?: number | null;
}) {
  const spaceName = findSpaceNameById(input.ticket.space_id);
  const paidAt = findVisitorTicketPaidAtById(input.ticket.id);

  return {
    receipt_number: `VT-${String(input.ticket.id).padStart(6, "0")}-${String(input.quote.id).padStart(6, "0")}`,
    ticket_id: Number(input.ticket.id),
    plate: input.ticket.plate,
    space_id: input.ticket.space_id || null,
    space_name: spaceName,
    entry_time: input.quote.entry_time,
    paid_at: paidAt,
    duration_mins: Number(input.quote.duration_mins || 0),
    grace_period_mins: Number(input.quote.grace_period_mins || 0),
    billable_mins: Number(input.quote.billable_mins || 0),
    rate_per_minute: Number(input.quote.rate_per_minute || 0),
    billing_mode: input.quote.billing_mode || "per_minute",
    subtotal: Number(input.quote.subtotal || 0),
    discount_amount: Number(input.quote.discount_amount || 0),
    total: Number(input.quote.total || 0),
    amount_paid: Number(input.amount || 0),
    payment_method: input.method,
    cashier_name: input.cashierName || null,
    cash_session_id: input.cashSessionId || null,
    legal_note: "Cobro por minuto efectivo, descontando minutos de gracia y sin redondeo al alza.",
  };
}

function assertPassIsUsable(pass: Record<string, any>) {
  const nowValue = getCurrentSqliteDateTimeString();
  if (pass.status === "completed") throw new Error("El pase ya fue completado");
  if (pass.status === "expired") throw new Error("El pase esta expirado");
  if (String(pass.valid_from) > nowValue) throw new Error("El pase aun no esta vigente");
  if (String(pass.valid_to) < nowValue) {
    markVisitorPassExpiredById(Number(pass.id));
    throw new Error("El pase esta expirado");
  }
}

export function listActiveVisitorsForRequest(req: Request, branchId?: number) {
  return queryActiveVisitorTickets(getTenantIdFromRequest(req), branchId);
}

export function listVisitorPaymentsForRequest(
  req: Request,
  query: {
    plate?: string;
    date?: string;
    method: "cash" | "transfer" | "card" | "automatic" | "other" | "all";
    branch_id?: number;
  },
) {
  return queryVisitorPayments(query, getTenantIdFromRequest(req));
}

export function createManualVisitorTicketForRequest(
  req: Request,
  body: { plate: string; space_id?: number | null; branch_id?: number },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const plate = body.plate.replace(/\s+/g, "").toUpperCase();

  const result = db.transaction(() => {
    const active = findActiveTicketByNormalizedPlate(normalizePlate(plate), tenantId);
    if (active) throw new Error(`La patente ya tiene un ticket activo (#${active.id})`);
    assertPlanLimit(req, "tickets");

    const branchId = getBranchOrDefault(body.branch_id || null, tenantId);
    const space = findParkingSpaceForNewTicket({
      tenantId,
      branchId,
      spaceId: body.space_id || null,
    });
    if (!space) throw new Error("No hay estacionamiento disponible para crear el ticket");
    if (space.status !== "available") throw new Error("El estacionamiento seleccionado no está disponible");

    const ticketBranchId = Number(space.branch_id || branchId);
    return insertManualVisitorTicketAndOccupySpace({
      plate,
      spaceId: Number(space.id),
      spaceName: String(space.name),
      ticketBranchId,
      staffId: currentUser?.id || null,
      staffName: currentUser?.name || null,
      tenantId,
    });
  })();

  recordAuditEvent(req, {
    action: "visitor_ticket.created",
    entityType: "visitor_ticket",
    entityId: result.ticketId,
    metadata: result,
  });

  return { success: true as const, ticket: result };
}

export function lookupVisitorTicketForRequest(
  req: Request,
  query: { plate: string; lost_ticket: boolean },
) {
  const plate = normalizePlate(query.plate);
  const tenantId = getTenantIdFromRequest(req);
  const ticket = findActiveTicketByNormalizedPlate(plate, tenantId);
  if (!ticket) return null;

  let quote: Record<string, any> | null = null;
  if (ticket.status === "active") {
    const calculated = calculateVisitorTicketQuote(ticket.id, { tenantId }).quote;
    quote = {
      ...calculated,
      visitor_id: calculated.ticket_id,
      duration_minutes: calculated.duration_mins,
      amount: calculated.total,
    };
  }

  if (query.lost_ticket) {
    recordAuditEvent(req, {
      action: "visitor_ticket.lost_ticket_lookup",
      entityType: "visitor_ticket",
      entityId: ticket.id,
      metadata: { plate: query.plate, normalized_plate: plate, status: ticket.status },
    });
  }

  return { ticket, quote };
}

export function quoteVisitorTicketForRequest(req: Request, ticketId: string) {
  const tenantId = getTenantIdFromRequest(req);
  const quote = createVisitorTicketQuote(ticketId, { tenantId });
  recordAuditEvent(req, {
    action: "visitor_ticket.quoted",
    entityType: "visitor_ticket",
    entityId: ticketId,
    metadata: quote,
  });
  return {
    ...quote,
    visitor_id: quote.ticket_id,
    duration_minutes: quote.duration_mins,
    amount: quote.total,
  };
}

export function payVisitorTicketForRequest(
  req: Request,
  ticketId: string,
  body: {
    method: string;
    amount: number;
    quote_id?: number;
    override_reason?: string | null;
  },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const method = normalizePaymentMethod(body.method);
  const amount = Number(body.amount || 0);

  const result = db.transaction(() => {
    const ticket = findVisitorTicketById(ticketId, tenantId);
    if (!ticket) throw new Error("Ticket de visita no encontrado");
    if (ticket.status === "completed") throw new Error("El ticket ya fue completado");
    if (ticket.status === "paid") throw new Error("El ticket ya fue pagado");

    const quote = getUsableVisitorQuote(ticketId, body.quote_id || null, { tenantId });
    const requiredAmount = Number(quote.total || 0);
    const isOverride = amount < requiredAmount;
    if (isOverride) {
      if (currentUser?.role !== "admin") throw new Error("El monto no puede ser menor a la cotización vigente");
      if (!body.override_reason) throw new Error("El override de monto requiere motivo");
    }

    const cashSession = ensureOpenCashSession(currentUser, null, {
      tenantId,
      branchId: ticket.branch_id || null,
    });

    markVisitorTicketPaidAndQuoteUsed({
      ticketId,
      tenantId,
      method,
      amount,
      quoteId: Number(quote.id),
      requiredAmount,
      staffId: currentUser?.id || null,
      cashSessionId: Number(cashSession.id),
      overrideReason: isOverride ? body.override_reason || null : null,
    });

    recordVisitorCashMovement({
      cashSessionId: Number(cashSession.id),
      ticketId,
      method,
      amount,
      staffId: currentUser?.id || null,
      note: isOverride ? `Override: ${body.override_reason}` : null,
      tenantId,
    });

    const receipt = buildVisitorReceipt({
      ticket,
      quote,
      method,
      amount,
      cashierName: currentUser?.name || null,
      cashSessionId: Number(cashSession.id),
    });

    return { ticket, quote, cashSession, requiredAmount, isOverride, receipt };
  })();

  recordAuditEvent(req, {
    action: result.isOverride ? "visitor_ticket.payment_overridden" : "visitor_ticket.paid",
    entityType: "visitor_ticket",
    entityId: ticketId,
    metadata: {
      method,
      amount,
      quoted_amount: result.requiredAmount,
      quote_id: result.quote.id,
      cash_session_id: result.cashSession.id,
      plate: result.ticket.plate,
      space_id: result.ticket.space_id,
      override_reason: result.isOverride ? body.override_reason : null,
    },
  });

  // Boleta electronica del cobro. El cobro ya esta confirmado: si la boleta no se puede emitir
  // (empresa sin SII, sin folios), se registra y el trabajo de envio la reintenta; nunca falla el pago.
  try {
    dteService.issueBoletaForTicket(tenantId, {
      ticketId,
      plate: result.ticket.plate,
      amount,
      durationMins: Number(result.quote.duration_mins || 0),
      branchId: result.ticket.branch_id || null,
      staffId: currentUser?.id || null,
    });
  } catch {
    /* El detalle queda en dte_events; el pago no depende de la boleta. */
  }

  return {
    success: true as const,
    quote_id: result.quote.id,
    cash_session_id: result.cashSession.id,
    receipt: result.receipt,
  };
}

export function completeVisitorTicketForRequest(req: Request, ticketId: string) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const ticket = findVisitorTicketById(ticketId, tenantId);
  if (!ticket) return null;

  completeVisitorTicketAndReleaseSpaceInTx({
    ticket,
    staffId: currentUser?.id || null,
    tenantId,
  });

  recordAuditEvent(req, {
    action: "visitor_ticket.completed",
    entityType: "visitor_ticket",
    entityId: ticketId,
    metadata: { plate: ticket.plate, space_id: ticket.space_id, released_space: Boolean(ticket.space_id) },
  });

  return { success: true as const, released_space_id: ticket.space_id || null };
}

export function listVisitorPassesForRequest(req: Request) {
  return queryVisitorPassesForTenant(getTenantIdFromRequest(req));
}

export function createVisitorPassForRequest(
  req: Request,
  body: {
    name: string;
    rut: string;
    type: "provider" | "family" | "maintenance" | "other";
    reason?: string | null;
    plate?: string | null;
    phone?: string | null;
    company?: string | null;
    authorized_by: string;
    associated_space_id?: number | null;
    branch_id?: number;
    valid_from: string;
    valid_to: string;
  },
) {
  const validFrom = normalizeVisitorDateTime(body.valid_from, "start");
  const validTo = normalizeVisitorDateTime(body.valid_to, "end");
  if (validFrom > validTo) {
    return { status: 400 as const, body: { error: "La fecha de termino del pase debe ser posterior al inicio" } };
  }

  const tenantId = getTenantIdFromRequest(req);
  let branchId: number;
  try {
    branchId = body.associated_space_id
      ? Number(
          findSpaceBranchIdById(body.associated_space_id, tenantId) ||
            getBranchOrDefault(body.branch_id || null, tenantId),
        )
      : getBranchOrDefault(body.branch_id || null, tenantId);
  } catch (e: any) {
    return { status: 400 as const, body: { error: e.message || "Sucursal invalida" } };
  }

  const qrToken = Math.random().toString(36).substring(2, 15);
  const id = insertVisitorPassRow({
    name: body.name,
    rut: body.rut,
    type: body.type,
    reason: body.reason ?? null,
    plate: body.plate ?? null,
    phone: body.phone ?? null,
    company: body.company ?? null,
    authorizedBy: body.authorized_by,
    associatedSpaceId: body.associated_space_id ?? null,
    branchId,
    validFrom,
    validTo,
    qrToken,
    tenantId,
  });

  recordAuditEvent(req, {
    action: "visitor_pass.created",
    entityType: "visitor_pass",
    entityId: id,
    metadata: {
      name: body.name,
      rut: body.rut,
      type: body.type,
      plate: body.plate,
      associated_space_id: body.associated_space_id,
      branch_id: branchId,
      valid_from: validFrom,
      valid_to: validTo,
    },
  });

  return { status: 200 as const, body: { success: true as const, id, qr_token: qrToken } };
}

export function scanVisitorPassForRequest(req: Request, passId: string) {
  const tenantId = getTenantIdFromRequest(req);
  const pass = findVisitorPassById(passId, tenantId);
  if (!pass) return null;

  assertPassIsUsable(pass);
  const result = db.transaction(() => {
    const plate = visitorTicketPlate(pass);

    if (pass.status === "inside") {
      const ticket = findActiveTicketByExactPlate(plate, tenantId);
      return completeVisitorPassExitInDb({
        pass,
        ticket,
        plate,
        tenantId,
      });
    }

    let spaceId: number | null = pass.associated_space_id || null;
    let ticketId: number | null = null;
    let spaceType: string | null = null;

    if (spaceId) {
      const space = findSpaceByIdAndTenant(spaceId, tenantId);
      if (!space) throw new Error("El espacio asociado al pase no existe");
      spaceType = space.type;
      if (space.type === "parking") {
        if (space.status !== "available") throw new Error("El estacionamiento asociado no esta disponible");
        occupySpaceByIdAndTenant(Number(space.id), tenantId);
      }
    } else if (pass.plate) {
      const targetBranchId = Number(pass.branch_id || getBranchOrDefault(null, tenantId));
      const availableSpace = findFirstAvailableParkingSpaceInBranch(targetBranchId, tenantId);
      if (!availableSpace) throw new Error("Estacionamiento lleno. No hay cupos disponibles.");
      spaceId = Number(availableSpace.id);
      spaceType = String(availableSpace.type);
      occupySpaceByIdAndTenant(spaceId, tenantId);
    }

    const effectiveBranchId = Number(pass.branch_id || getBranchOrDefault(null, tenantId));
    if (spaceType === "parking") {
      assertPlanLimit(req, "tickets");
      ticketId = insertQrVisitorTicketRow({
        plate,
        spaceId,
        branchId: effectiveBranchId,
        tenantId,
      });
    }

    recordVisitorPassEntryInDb({
      passId: Number(pass.id),
      ticketId,
      spaceId,
      branchId: effectiveBranchId,
      authorizedBy: pass.authorized_by || null,
      plate,
      tenantId,
    });

    return { action: "entry" as const, ticketId, spaceId };
  })();

  recordAuditEvent(req, {
    action: result.action === "entry" ? "visitor_pass.entry_scanned" : "visitor_pass.exit_scanned",
    entityType: "visitor_pass",
    entityId: pass.id,
    metadata: result,
  });

  return {
    success: true as const,
    ...result,
    message:
      result.action === "entry" ? "Ingreso de visita registrado por QR" : "Salida de visita registrada por QR",
  };
}

