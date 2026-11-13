import { randomBytes } from "node:crypto";
import { db } from "../../db";
import { ratePlanIdForNewTicket } from "./rate-plans";

export function normalizePlate(plate: string) {
  return plate.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
}

export async function queryActiveVisitorTickets(tenantId: number, branchId?: number) {
  const params: Array<string | number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND vt.branch_id = ?";
    params.push(branchId);
  }

  return await db.prepare(`
    SELECT vt.*, s.name as space_name, b.name as branch_name, b.code as branch_code
    FROM visitor_tickets vt
    LEFT JOIN spaces s ON s.id = vt.space_id
    LEFT JOIN branches b ON b.id = vt.branch_id
    WHERE vt.status != 'completed'
      AND vt.tenant_id = ?
      ${branchFilter}
    ORDER BY vt.entry_time DESC
  `).all(...params);
}

export async function queryVisitorPayments(
  query: {
    plate?: string;
    date?: string;
    method: "cash" | "transfer" | "card" | "automatic" | "other" | "all";
    branch_id?: number;
  },
  tenantId: number,
) {
  let where = "WHERE vt.paid_at IS NOT NULL AND vt.tenant_id = ?";
  const params: Array<string | number> = [tenantId];
  if (query.plate) {
    where += " AND REPLACE(REPLACE(UPPER(vt.plate), '-', ''), ' ', '') LIKE ?";
    params.push(`%${normalizePlate(query.plate)}%`);
  }
  if (query.date) {
    where += " AND date(vt.paid_at) = ?";
    params.push(query.date);
  }
  if (query.method !== "all") {
    where += " AND vt.payment_method = ?";
    params.push(query.method);
  }
  if (query.branch_id) {
    where += " AND vt.branch_id = ?";
    params.push(query.branch_id);
  }

  return await db.prepare(`
    SELECT vt.id as ticket_id,
           printf('VT-%06d-%06d', vt.id, COALESCE(vt.quote_id, 0)) as receipt_number,
           vt.plate,
           vt.entry_time,
           vt.paid_at,
           vt.amount,
           vt.payment_method,
           vt.status,
           vt.cash_session_id,
           vt.branch_id,
           b.name as branch_name,
           vt.payment_override_reason,
           s.name as space_name,
           staff.name as cashier_name,
           q.duration_mins,
           q.grace_period_mins,
           q.billable_mins,
           q.rate_per_minute,
           q.total as quoted_total,
           q.billing_mode
    FROM visitor_tickets vt
    LEFT JOIN spaces s ON s.id = vt.space_id
    LEFT JOIN branches b ON b.id = vt.branch_id
    LEFT JOIN staff ON staff.id = vt.paid_by_staff_id
    LEFT JOIN visitor_ticket_quotes q ON q.id = vt.quote_id
    ${where}
    ORDER BY vt.paid_at DESC, vt.id DESC
    LIMIT 100
  `).all(...params) as Record<string, any>[];
}

export async function findSpaceNameById(spaceId: number | string | null | undefined): Promise<string | null> {
  if (!spaceId) return null;
  const row = await db.prepare("SELECT name FROM spaces WHERE id = ?").get(spaceId) as { name: string } | undefined;
  return row?.name || null;
}

export async function findVisitorTicketPaidAtById(ticketId: number | string): Promise<string | null> {
  const row = await db.prepare("SELECT paid_at FROM visitor_tickets WHERE id = ?").get(ticketId) as
    | { paid_at: string | null }
    | undefined;
  return row?.paid_at || null;
}

export async function findActiveTicketByNormalizedPlate(normalizedPlate: string, tenantId: number) {
  return await db.prepare(`
    SELECT vt.*, s.name as space_name
    FROM visitor_tickets vt
    LEFT JOIN spaces s ON s.id = vt.space_id
    WHERE vt.status != 'completed'
      AND REPLACE(REPLACE(UPPER(vt.plate), '-', ''), ' ', '') = ?
      AND vt.tenant_id = ?
    ORDER BY vt.entry_time DESC, vt.id DESC
    LIMIT 1
  `).get(normalizedPlate, tenantId) as Record<string, any> | undefined;
}

export async function findParkingSpaceForNewTicket(params: {
  tenantId: number;
  branchId: number;
  spaceId?: number | null;
}) {
  return params.spaceId
    ? (await db
        .prepare("SELECT id, name, status, branch_id FROM spaces WHERE id = ? AND type = 'parking' AND tenant_id = ?")
        .get(params.spaceId, params.tenantId) as Record<string, any> | undefined)
    : (await db
        .prepare(
          "SELECT id, name, status, branch_id FROM spaces WHERE type = 'parking' AND status = 'available' AND branch_id = ? AND tenant_id = ? ORDER BY id ASC LIMIT 1",
        )
        .get(params.branchId, params.tenantId) as Record<string, any> | undefined);
}

/** Token del QR de pago de un ticket: todo ticket nuevo lo lleva desde que se imprime. */
export const newTicketPublicToken = () => `t_${randomBytes(18).toString("base64url")}`;

export async function insertManualVisitorTicketAndOccupySpace(params: {
  plate: string;
  /** null: el auto ya esta dentro pero no hay plaza asignada (p. ej. entrada registrada sin conexion). */
  spaceId: number | null;
  spaceName: string | null;
  ticketBranchId: number;
  staffId: number | null;
  staffName: string | null;
  tenantId: number;
  vehicleType?: string;
  /** Hora de entrada (UTC, "YYYY-MM-DD HH:MM:SS") cuando el ticket se creo sin conexion; por omision, ahora. */
  entryTime?: string;
  /** Token del QR de pago, generado en el dispositivo para que el ticket impreso sin red ya lo lleve. */
  publicToken?: string;
}) {
  if (params.spaceId) await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ? AND tenant_id = ?").run(params.spaceId, params.tenantId);
  const vehicleType = params.vehicleType || "car";
  // El ticket guarda la version de la tarifa con que entra: un cambio de precios no lo afecta.
  const ratePlanId = await ratePlanIdForNewTicket(params.tenantId, params.ticketBranchId, vehicleType);
  const publicToken = params.publicToken ?? newTicketPublicToken();
  const ticket = await db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, branch_id, created_by_staff_id, entry_method, tenant_id, vehicle_type, rate_plan_id, entry_time, public_token)
    VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
  `).run(params.plate, params.spaceId, params.ticketBranchId, params.staffId, params.tenantId, vehicleType, ratePlanId, params.entryTime ?? null, publicToken);
  await db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate, tenant_id)
    VALUES (?, ?, ?, 'entry', 'authorized', 'manual', 'Ticket creado en caja', ?, ?, ?)
  `).run(
    ticket.lastInsertRowid,
    params.spaceId,
    params.ticketBranchId,
    params.staffName,
    params.plate,
    params.tenantId,
  );
  return {
    ticketId: Number(ticket.lastInsertRowid),
    spaceId: params.spaceId == null ? null : Number(params.spaceId),
    spaceName: params.spaceName == null ? null : String(params.spaceName),
    branch_id: params.ticketBranchId,
    plate: params.plate,
    vehicle_type: vehicleType,
    /** Token del QR de pago que se imprime en el ticket de entrada. */
    public_token: publicToken,
  };
}

export async function findVisitorTicketById(ticketId: string | number, tenantId: number) {
  return await db
    .prepare("SELECT * FROM visitor_tickets WHERE id = ? AND tenant_id = ?")
    .get(ticketId, tenantId) as Record<string, any> | undefined;
}

export async function markVisitorTicketPaidAndQuoteUsed(params: {
  ticketId: string | number;
  tenantId: number;
  method: string;
  amount: number;
  quoteId: number;
  requiredAmount: number;
  staffId: number | null;
  cashSessionId: number;
  overrideReason: string | null;
  /** Hora del cobro (UTC) cuando se registro sin conexion; por omision, ahora. */
  paidAt?: string;
}): Promise<void> {
  await db.prepare(`
    UPDATE visitor_tickets
    SET status = 'paid',
        payment_method = ?,
        amount = ?,
        paid_at = COALESCE(?, datetime('now')),
        quote_id = ?,
        quoted_amount = ?,
        paid_by_staff_id = ?,
        cash_session_id = ?,
        payment_override_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    params.method,
    params.amount,
    params.paidAt ?? null,
    params.quoteId,
    params.requiredAmount,
    params.staffId,
    params.cashSessionId,
    params.overrideReason,
    params.ticketId,
    params.tenantId,
  );

  await db.prepare("UPDATE visitor_ticket_quotes SET status = 'used' WHERE id = ? AND tenant_id = ?").run(
    params.quoteId,
    params.tenantId,
  );
}

export async function completeVisitorTicketAndReleaseSpaceInTx(params: {
  ticket: Record<string, any>;
  staffId: number | null;
  tenantId: number;
  /** Hora de salida (UTC) cuando se registro sin conexion; por omision, ahora. */
  exitTime?: string;
}): Promise<void> {
  const tx = db.transaction(async () => {
    await db.prepare(`
      UPDATE visitor_tickets
      SET status = 'completed',
          exit_time = COALESCE(exit_time, ?, datetime('now')),
          completed_by_staff_id = ?
      WHERE id = ? AND tenant_id = ?
    `).run(params.exitTime ?? null, params.staffId, params.ticket.id, params.tenantId);

    if (params.ticket.space_id) {
      await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND type = 'parking' AND tenant_id = ?").run(
        params.ticket.space_id,
        params.tenantId,
      );
    }

    await db.prepare(`
      INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, plate, tenant_id)
      VALUES (?, ?, ?, 'exit', 'authorized', 'manual', 'Salida de visita finalizada manualmente', ?, ?)
    `).run(
      params.ticket.id,
      params.ticket.space_id || null,
      params.ticket.branch_id || null,
      params.ticket.plate || null,
      params.tenantId,
    );
  });
  await tx();
}

export async function queryVisitorPassesForTenant(tenantId: number) {
  return await db.prepare(`
    SELECT v.*, s.name as space_name 
    FROM visitor_passes v
    LEFT JOIN spaces s ON v.associated_space_id = s.id
    WHERE v.tenant_id = ?
    ORDER BY created_at DESC
  `).all(tenantId);
}

export async function findSpaceBranchIdById(spaceId: number, tenantId: number): Promise<number | null> {
  const row = await db
    .prepare("SELECT branch_id FROM spaces WHERE id = ? AND tenant_id = ?")
    .get(spaceId, tenantId) as { branch_id: number | null } | undefined;
  return row?.branch_id || null;
}

export async function insertVisitorPassRow(params: {
  name: string;
  rut: string;
  type: "provider" | "family" | "maintenance" | "other";
  reason: string | null;
  plate: string | null;
  phone: string | null;
  company: string | null;
  authorizedBy: string;
  associatedSpaceId: number | null;
  branchId: number;
  validFrom: string;
  validTo: string;
  qrToken: string;
  tenantId: number;
}): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO visitor_passes (name, rut, type, reason, plate, phone, company, authorized_by, associated_space_id, branch_id, valid_from, valid_to, qr_token, tenant_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.name,
    params.rut,
    params.type,
    params.reason,
    params.plate,
    params.phone,
    params.company,
    params.authorizedBy,
    params.associatedSpaceId,
    params.branchId,
    params.validFrom,
    params.validTo,
    params.qrToken,
    params.tenantId,
  );
  return Number(result.lastInsertRowid);
}

export async function findVisitorPassById(passId: string | number, tenantId: number) {
  return await db
    .prepare("SELECT * FROM visitor_passes WHERE id = ? AND tenant_id = ?")
    .get(passId, tenantId) as Record<string, any> | undefined;
}

export async function getCurrentSqliteDateTimeString(): Promise<string> {
  const now = await db.prepare("SELECT datetime('now') as value").get() as { value: string };
  return now.value;
}

export async function markVisitorPassExpiredById(passId: number): Promise<void> {
  await db.prepare("UPDATE visitor_passes SET status = 'expired' WHERE id = ?").run(passId);
}

export async function findActiveTicketByExactPlate(plate: string, tenantId: number) {
  return await db.prepare(`
    SELECT *
    FROM visitor_tickets
    WHERE status != 'completed'
      AND plate = ?
      AND tenant_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(plate, tenantId) as Record<string, any> | undefined;
}

export async function completeVisitorPassExitInDb(params: {
  pass: Record<string, any>;
  ticket: Record<string, any> | undefined;
  plate: string;
  tenantId: number;
}) {
  await db.prepare("UPDATE visitor_passes SET status = 'completed' WHERE id = ? AND tenant_id = ?").run(
    params.pass.id,
    params.tenantId,
  );
  if (params.ticket) {
    await db.prepare(
      "UPDATE visitor_tickets SET status = 'completed', exit_time = COALESCE(exit_time, datetime('now')) WHERE id = ? AND tenant_id = ?",
    ).run(params.ticket.id, params.tenantId);
    if (params.ticket.space_id) {
      await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND type = 'parking' AND tenant_id = ?").run(
        params.ticket.space_id,
        params.tenantId,
      );
    }
  }
  await db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate, tenant_id)
    VALUES (?, ?, ?, 'exit', 'authorized', 'qr', 'Salida con pase QR', ?, ?, ?)
  `).run(
    params.ticket?.id || null,
    params.ticket?.space_id || params.pass.associated_space_id || null,
    params.ticket?.branch_id || params.pass.branch_id || null,
    params.pass.authorized_by || null,
    params.plate,
    params.tenantId,
  );

  return {
    action: "exit" as const,
    ticketId: params.ticket?.id || null,
    spaceId: params.ticket?.space_id || null,
  };
}

export async function findSpaceByIdAndTenant(spaceId: number, tenantId: number) {
  return await db
    .prepare("SELECT id, type, status, branch_id FROM spaces WHERE id = ? AND tenant_id = ?")
    .get(spaceId, tenantId) as Record<string, any> | undefined;
}

export async function findFirstAvailableParkingSpaceInBranch(branchId: number, tenantId: number) {
  return await db
    .prepare(
      "SELECT id, type, branch_id FROM spaces WHERE type = 'parking' AND status = 'available' AND branch_id = ? AND tenant_id = ? LIMIT 1",
    )
    .get(branchId, tenantId) as Record<string, any> | undefined;
}

export async function occupySpaceByIdAndTenant(spaceId: number, tenantId: number): Promise<void> {
  await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ? AND tenant_id = ?").run(spaceId, tenantId);
}

export async function insertQrVisitorTicketRow(params: {
  plate: string;
  spaceId: number | null;
  branchId: number;
  tenantId: number;
}): Promise<number> {
  const ratePlanId = await ratePlanIdForNewTicket(params.tenantId, params.branchId, "car");
  const result = await db
    .prepare("INSERT INTO visitor_tickets (plate, space_id, branch_id, entry_method, tenant_id, rate_plan_id) VALUES (?, ?, ?, 'qr', ?, ?)")
    .run(params.plate, params.spaceId, params.branchId, params.tenantId, ratePlanId);
  return Number(result.lastInsertRowid);
}

export async function recordVisitorPassEntryInDb(params: {
  passId: number;
  ticketId: number | null;
  spaceId: number | null;
  branchId: number;
  authorizedBy: string | null;
  plate: string;
  tenantId: number;
}): Promise<void> {
  await db.prepare("UPDATE visitor_passes SET status = 'inside' WHERE id = ? AND tenant_id = ?").run(
    params.passId,
    params.tenantId,
  );
  await db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate, tenant_id)
    VALUES (?, ?, ?, 'entry', 'authorized', 'qr', 'Ingreso con pase QR', ?, ?, ?)
  `).run(
    params.ticketId,
    params.spaceId,
    params.branchId,
    params.authorizedBy,
    params.plate,
    params.tenantId,
  );
}

