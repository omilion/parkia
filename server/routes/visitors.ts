import type { Express } from "express";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { getBranchOrDefault } from "../branches";
import { db } from "../db";
import {
  calculateVisitorTicketQuote,
  closeCashSession,
  createVisitorTicketQuote,
  ensureOpenCashSession,
  getCashSessionOperationalSummary,
  getOpenCashSessionForUser,
  getUsableVisitorQuote,
  normalizePaymentMethod,
  recordVisitorCashMovement,
} from "../parking";
import { optionalTextSchema, parseBody } from "../validation";
import { sendXlsxTable, type XlsxColumn } from "../xlsx";

const payVisitorSchema = z.object({
  method: z.enum(["cash", "transfer", "card", "automatic", "efectivo", "transferencia", "tarjeta"]),
  amount: z.coerce.number().nonnegative(),
  quote_id: z.coerce.number().int().positive().optional(),
  override_reason: optionalTextSchema,
});

const createVisitorTicketSchema = z.object({
  plate: z.string().trim().min(1).max(12),
  space_id: z.coerce.number().int().positive().nullable().optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});

const lookupVisitorTicketSchema = z.object({
  plate: z.string().trim().min(1),
  lost_ticket: z.coerce.boolean().default(false),
});

const visitorPaymentsQuerySchema = z.object({
  plate: z.string().trim().optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  method: z.enum(["cash", "transfer", "card", "automatic", "other", "all"]).default("all"),
  branch_id: z.coerce.number().int().positive().optional(),
});

const closeVisitorCashSessionSchema = z.object({
  counted_cash: z.coerce.number().nonnegative(),
  counted_transfer: z.coerce.number().nonnegative().default(0),
  counted_card: z.coerce.number().nonnegative().default(0),
  notes: optionalTextSchema,
  handover_notes: optionalTextSchema,
});

const visitorCashClosuresQuerySchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});

const createVisitorPassSchema = z.object({
  name: z.string().trim().min(1),
  rut: z.string().trim().min(1),
  type: z.enum(["provider", "family", "maintenance", "other"]),
  reason: optionalTextSchema,
  plate: optionalTextSchema,
  phone: optionalTextSchema,
  company: optionalTextSchema,
  authorized_by: z.string().trim().min(1).max(120),
  associated_space_id: z.coerce.number().int().positive().nullable().optional(),
  branch_id: z.coerce.number().int().positive().optional(),
  valid_from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Fecha de inicio invalida"),
  valid_to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Fecha de termino invalida"),
});

function normalizeVisitorDateTime(value: string, boundary: "start" | "end") {
  if (value.includes("T")) return `${value.replace("T", " ")}:00`;
  return `${value} ${boundary === "start" ? "00:00:00" : "23:59:59"}`;
}

function visitorTicketPlate(pass: any) {
  return pass.plate || `PASS-${pass.id}`;
}

function normalizePlate(plate: string) {
  return plate.replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
}

function buildVisitorReceipt(input: { ticket: any; quote: any; method: string; amount: number; cashierName?: string | null; cashSessionId?: number | null }) {
  const space = input.ticket.space_id
    ? db.prepare("SELECT name FROM spaces WHERE id = ?").get(input.ticket.space_id) as { name: string } | undefined
    : undefined;
  const paidAt = (db.prepare("SELECT paid_at FROM visitor_tickets WHERE id = ?").get(input.ticket.id) as { paid_at: string | null } | undefined)?.paid_at;

  return {
    receipt_number: `VT-${String(input.ticket.id).padStart(6, "0")}-${String(input.quote.id).padStart(6, "0")}`,
    ticket_id: Number(input.ticket.id),
    plate: input.ticket.plate,
    space_id: input.ticket.space_id || null,
    space_name: space?.name || null,
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

function assertPassIsUsable(pass: any) {
  const now = db.prepare("SELECT datetime('now') as value").get() as { value: string };
  if (pass.status === "completed") throw new Error("El pase ya fue completado");
  if (pass.status === "expired") throw new Error("El pase esta expirado");
  if (String(pass.valid_from) > now.value) throw new Error("El pase aun no esta vigente");
  if (String(pass.valid_to) < now.value) {
    db.prepare("UPDATE visitor_passes SET status = 'expired' WHERE id = ?").run(pass.id);
    throw new Error("El pase esta expirado");
  }
}

function toCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map(row => row.map(escape).join(",")).join("\n");
}

function getVisitorPayments(query: z.infer<typeof visitorPaymentsQuerySchema>) {
  let where = "WHERE vt.paid_at IS NOT NULL";
  const params: Array<string | number> = [];
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

  return db.prepare(`
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
  `).all(...params) as any[];
}

function getVisitorCashClosures(query: z.infer<typeof visitorCashClosuresQuerySchema>, currentUser: ReturnType<typeof getCurrentUser>) {
  const params: Array<string | number> = [];
  let where = "WHERE cs.status = 'closed'";
  if (currentUser?.role !== "admin") {
    where += " AND cs.staff_id = ?";
    params.push(currentUser?.id || 0);
  }
  if (query.date) {
    where += " AND date(cs.closed_at) = ?";
    params.push(query.date);
  }
  if (query.branch_id) {
    where += " AND cs.branch_id = ?";
    params.push(query.branch_id);
  }

  return db.prepare(`
    SELECT cs.id,
           cs.branch_id,
           b.name as branch_name,
           cs.staff_id,
           staff.name as staff_name,
           cs.shift_log_id,
           cs.opened_at,
           cs.closed_at,
           cs.opening_cash,
           cs.expected_cash,
           cs.counted_cash,
           cs.counted_transfer,
           cs.counted_card,
           cs.difference_cash,
           cs.notes,
           c.closed_by_staff_id,
           closer.name as closed_by_name,
           c.snapshot_json,
           c.created_at,
           (SELECT COUNT(*) FROM visitor_tickets vt WHERE vt.cash_session_id = cs.id) as tickets_count
    FROM cash_sessions cs
    LEFT JOIN branches b ON b.id = cs.branch_id
    LEFT JOIN staff ON staff.id = cs.staff_id
    LEFT JOIN cash_session_closures c ON c.cash_session_id = cs.id
    LEFT JOIN staff closer ON closer.id = c.closed_by_staff_id
    ${where}
    ORDER BY cs.closed_at DESC, cs.id DESC
    LIMIT 100
  `).all(...params).map((row: any) => ({
    ...row,
    tickets_count: Number(row.tickets_count || 0),
    opening_cash: Number(row.opening_cash || 0),
    expected_cash: Number(row.expected_cash || 0),
    counted_cash: Number(row.counted_cash || 0),
    counted_transfer: Number(row.counted_transfer || 0),
    counted_card: Number(row.counted_card || 0),
    difference_cash: Number(row.difference_cash || 0),
  })) as any[];
}

export function registerVisitorsRoutes(app: Express) {
  app.use("/api/visitors", requireAnyRole(["admin", "guard", "cashier"]));

  app.get("/api/visitors", (req, res) => {
    const visitors = db.prepare(`
      SELECT vt.*, s.name as space_name, b.name as branch_name, b.code as branch_code
      FROM visitor_tickets vt
      LEFT JOIN spaces s ON s.id = vt.space_id
      LEFT JOIN branches b ON b.id = vt.branch_id
      WHERE vt.status != 'completed'
      ORDER BY vt.entry_time DESC
    `).all();
    res.json(visitors);
  });

  app.get("/api/visitors/cash/current", (req, res) => {
    try {
      const currentUser = getCurrentUser(req);
      const cashSession = ensureOpenCashSession(currentUser);
      res.json(getCashSessionOperationalSummary(cashSession.id));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo obtener la caja actual" });
    }
  });

  app.get("/api/visitors/cash/closures", (req, res) => {
    const query = visitorCashClosuresQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });

    const closures = getVisitorCashClosures(query.data, getCurrentUser(req)).slice(0, 50);

    res.json(closures);
  });

  app.post("/api/visitors/cash/current/close", (req, res) => {
    const body = parseBody(closeVisitorCashSessionSchema, req.body, res);
    if (!body) return;

    const currentUser = getCurrentUser(req);
    const cashSession = getOpenCashSessionForUser(currentUser);
    if (!cashSession) return res.status(400).json({ error: "No hay caja abierta para cerrar" });

    try {
      const result = db.transaction(() => {
        const summary = getCashSessionOperationalSummary(cashSession.id);
        if (summary.blockers.paidTicketsAwaitingExit > 0) {
          throw new Error(`No se puede cerrar la caja: hay ${summary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) pendientes de salida.`);
        }

        const closure = closeCashSession({
          req,
          cashSessionId: Number(cashSession.id),
          countedCash: body.counted_cash,
          countedTransfer: body.counted_transfer,
          countedCard: body.counted_card,
          notes: body.notes || null,
          user: currentUser,
        });

        let shiftLogClosed = false;
        if (cashSession.shift_log_id) {
          const shiftLog = db.prepare("SELECT status FROM guard_shift_logs WHERE id = ?").get(cashSession.shift_log_id) as any | undefined;
          if (shiftLog?.status === "open") {
            db.prepare(`
              UPDATE guard_shift_logs
              SET status = 'closed',
                  handover_notes = ?,
                  cash_count_note = ?,
                  closed_at = datetime('now'),
                  updated_at = datetime('now')
              WHERE id = ?
            `).run(
              body.handover_notes || "Cierre operativo registrado desde visitas",
              body.notes || null,
              cashSession.shift_log_id,
            );
            shiftLogClosed = true;
          }
        }

        return {
          closure,
          summary,
          cash_session_id: Number(cashSession.id),
          shift_log_id: cashSession.shift_log_id || null,
          shift_log_closed: shiftLogClosed,
        };
      })();

      if (result.shift_log_closed) {
        recordAuditEvent(req, {
          action: "guard_shift_log.closed",
          entityType: "guard_shift_log",
          entityId: result.shift_log_id,
          metadata: {
            source: "visitor_cash_close",
            cash_session_id: result.cash_session_id,
            cash_closure: result.closure,
          },
        });
      }

      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo cerrar la caja" });
    }
  });

  app.get("/api/visitors/payments", (req, res) => {
    const query = visitorPaymentsQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cobros inválidos" });

    let where = "WHERE vt.paid_at IS NOT NULL";
    const params: Array<string | number> = [];
    if (query.data.plate) {
      where += " AND REPLACE(REPLACE(UPPER(vt.plate), '-', ''), ' ', '') LIKE ?";
      params.push(`%${normalizePlate(query.data.plate)}%`);
    }
    if (query.data.date) {
      where += " AND date(vt.paid_at) = ?";
      params.push(query.data.date);
    }
    if (query.data.method !== "all") {
      where += " AND vt.payment_method = ?";
      params.push(query.data.method);
    }
    if (query.data.branch_id) {
      where += " AND vt.branch_id = ?";
      params.push(query.data.branch_id);
    }

    const payments = db.prepare(`
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
    `).all(...params);

    res.json(payments);
  });

  app.get("/api/visitors/payments/export.csv", requireAnyRole(["admin"]), (req, res) => {
    const query = visitorPaymentsQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cobros invalidos" });

    const rows = getVisitorPayments(query.data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cobros-visitas.csv\"");
    res.send(toCsv([
      ["Comprobante", "Patente", "Cupo", "Pago", "Metodo", "Cajera", "Total", "Minutos cobrables", "Tarifa minuto", "Estado"],
      ...rows.map(row => [
        row.receipt_number,
        row.plate,
        row.space_name || "",
        row.paid_at,
        row.payment_method,
        row.cashier_name || "",
        row.amount,
        row.billable_mins || 0,
        row.rate_per_minute || 0,
        row.status,
      ]),
    ]));
  });

  app.get("/api/visitors/payments/export.xlsx", requireAnyRole(["admin"]), async (req, res, next) => {
    try {
      const query = visitorPaymentsQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Filtros de cobros invalidos" });
      const rows = getVisitorPayments(query.data);
      const columns: XlsxColumn<any>[] = [
        { header: "Comprobante", width: 22, value: row => row.receipt_number },
        { header: "Patente", width: 14, value: row => row.plate },
        { header: "Cupo", width: 18, value: row => row.space_name || "" },
        { header: "Pago", width: 20, value: row => row.paid_at },
        { header: "Metodo", width: 14, value: row => row.payment_method },
        { header: "Cajera", width: 22, value: row => row.cashier_name || "" },
        { header: "Total", width: 14, value: row => row.amount },
        { header: "Minutos cobrables", width: 18, value: row => row.billable_mins || 0 },
        { header: "Tarifa minuto", width: 16, value: row => row.rate_per_minute || 0 },
        { header: "Estado", width: 14, value: row => row.status },
      ];
      await sendXlsxTable(res, { filename: "cobros-visitas.xlsx", sheetName: "Cobros visitas", columns, rows });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/visitors/cash/closures/export.csv", requireAnyRole(["admin"]), (req, res) => {
    const query = visitorCashClosuresQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });

    const rows = getVisitorCashClosures(query.data, getCurrentUser(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cierres-caja-visitas.csv\"");
    res.send(toCsv([
      ["Caja", "Apertura", "Cierre", "Responsable", "Tickets", "Efectivo esperado", "Efectivo contado", "Tarjeta contada", "Transferencia contada", "Diferencia", "Notas"],
      ...rows.map(row => [
        row.id,
        row.opened_at,
        row.closed_at,
        row.staff_name || row.closed_by_name || "",
        row.tickets_count,
        row.expected_cash,
        row.counted_cash,
        row.counted_card,
        row.counted_transfer,
        row.difference_cash,
        row.notes || "",
      ]),
    ]));
  });

  app.get("/api/visitors/cash/closures/export.xlsx", requireAnyRole(["admin"]), async (req, res, next) => {
    try {
      const query = visitorCashClosuresQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });
      const rows = getVisitorCashClosures(query.data, getCurrentUser(req));
      const columns: XlsxColumn<any>[] = [
        { header: "Caja", width: 10, value: row => row.id },
        { header: "Apertura", width: 20, value: row => row.opened_at },
        { header: "Cierre", width: 20, value: row => row.closed_at },
        { header: "Responsable", width: 22, value: row => row.staff_name || row.closed_by_name || "" },
        { header: "Tickets", width: 10, value: row => row.tickets_count },
        { header: "Efectivo esperado", width: 18, value: row => row.expected_cash },
        { header: "Efectivo contado", width: 18, value: row => row.counted_cash },
        { header: "Tarjeta contada", width: 18, value: row => row.counted_card },
        { header: "Transferencia contada", width: 22, value: row => row.counted_transfer },
        { header: "Diferencia", width: 14, value: row => row.difference_cash },
        { header: "Notas", width: 28, value: row => row.notes || "" },
      ];
      await sendXlsxTable(res, { filename: "cierres-caja-visitas.xlsx", sheetName: "Cierres caja", columns, rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/visitors", (req, res) => {
    const body = parseBody(createVisitorTicketSchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);
    const plate = body.plate.replace(/\s+/g, "").toUpperCase();

    try {
      const result = db.transaction(() => {
        const active = db.prepare(`
          SELECT id
          FROM visitor_tickets
          WHERE status != 'completed'
            AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = ?
          ORDER BY id DESC
          LIMIT 1
        `).get(normalizePlate(plate)) as { id: number } | undefined;
        if (active) throw new Error(`La patente ya tiene un ticket activo (#${active.id})`);

        const branchId = getBranchOrDefault(body.branch_id || null);
        let space = body.space_id
          ? db.prepare("SELECT id, name, status, branch_id FROM spaces WHERE id = ? AND type = 'parking'").get(body.space_id) as any | undefined
          : db.prepare("SELECT id, name, status, branch_id FROM spaces WHERE type = 'parking' AND status = 'available' AND branch_id = ? ORDER BY id ASC LIMIT 1").get(branchId) as any | undefined;
        if (!space) throw new Error("No hay estacionamiento disponible para crear el ticket");
        if (space.status !== "available") throw new Error("El estacionamiento seleccionado no está disponible");

        const ticketBranchId = Number(space.branch_id || branchId);
        db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(space.id);
        const ticket = db.prepare(`
          INSERT INTO visitor_tickets (plate, space_id, branch_id, created_by_staff_id, entry_method)
          VALUES (?, ?, ?, ?, 'manual')
        `).run(plate, space.id, ticketBranchId, currentUser?.id || null);
        db.prepare(`
          INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate)
          VALUES (?, ?, ?, 'entry', 'authorized', 'manual', 'Ticket creado en caja', ?, ?)
        `).run(ticket.lastInsertRowid, space.id, ticketBranchId, currentUser?.name || null, plate);
        return { ticketId: Number(ticket.lastInsertRowid), spaceId: Number(space.id), spaceName: String(space.name), branch_id: ticketBranchId, plate };
      })();

      recordAuditEvent(req, {
        action: "visitor_ticket.created",
        entityType: "visitor_ticket",
        entityId: result.ticketId,
        metadata: result,
      });
      res.json({ success: true, ticket: result });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo crear el ticket de visita" });
    }
  });

  app.get("/api/visitors/lookup", (req, res) => {
    const query = lookupVisitorTicketSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Patente requerida" });

    const plate = normalizePlate(query.data.plate);
    const ticket = db.prepare(`
      SELECT vt.*, s.name as space_name
      FROM visitor_tickets vt
      LEFT JOIN spaces s ON s.id = vt.space_id
      WHERE vt.status != 'completed'
        AND REPLACE(REPLACE(UPPER(vt.plate), '-', ''), ' ', '') = ?
      ORDER BY vt.entry_time DESC, vt.id DESC
      LIMIT 1
    `).get(plate) as any | undefined;

    if (!ticket) return res.status(404).json({ error: "No se encontró ticket activo para esa patente" });

    let quote: any = null;
    if (ticket.status === "active") {
      const calculated = calculateVisitorTicketQuote(ticket.id).quote;
      quote = {
        ...calculated,
        visitor_id: calculated.ticket_id,
        duration_minutes: calculated.duration_mins,
        amount: calculated.total,
      };
    }

    if (query.data.lost_ticket) {
      recordAuditEvent(req, {
        action: "visitor_ticket.lost_ticket_lookup",
        entityType: "visitor_ticket",
        entityId: ticket.id,
        metadata: { plate: query.data.plate, normalized_plate: plate, status: ticket.status },
      });
    }

    res.json({ ticket, quote });
  });

  app.get("/api/visitors/:id/quote", (req, res) => {
    try {
      const quote = createVisitorTicketQuote(req.params.id);
      recordAuditEvent(req, {
        action: "visitor_ticket.quoted",
        entityType: "visitor_ticket",
        entityId: req.params.id,
        metadata: quote,
      });
      res.json({
        ...quote,
        visitor_id: quote.ticket_id,
        duration_minutes: quote.duration_mins,
        amount: quote.total,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo calcular el ticket" });
    }
  });

  app.post("/api/visitors/:id/pay", (req, res) => {
    const body = parseBody(payVisitorSchema, req.body, res);
    if (!body) return;

    const currentUser = getCurrentUser(req);
    const method = normalizePaymentMethod(body.method);
    const amount = Number(body.amount || 0);

    try {
      const result = db.transaction(() => {
        const ticket = db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(req.params.id) as any | undefined;
        if (!ticket) throw new Error("Ticket de visita no encontrado");
        if (ticket.status === "completed") throw new Error("El ticket ya fue completado");
        if (ticket.status === "paid") throw new Error("El ticket ya fue pagado");

        const quote = getUsableVisitorQuote(req.params.id, body.quote_id || null);
        const requiredAmount = Number(quote.total || 0);
        const isOverride = amount < requiredAmount;
        if (isOverride) {
          if (currentUser?.role !== "admin") throw new Error("El monto no puede ser menor a la cotización vigente");
          if (!body.override_reason) throw new Error("El override de monto requiere motivo");
        }

        const cashSession = ensureOpenCashSession(currentUser);
        db.prepare(`
          UPDATE visitor_tickets
          SET status = 'paid',
              payment_method = ?,
              amount = ?,
              paid_at = datetime('now'),
              quote_id = ?,
              quoted_amount = ?,
              paid_by_staff_id = ?,
              cash_session_id = ?,
              payment_override_reason = ?
          WHERE id = ?
        `).run(
          method,
          amount,
          quote.id,
          requiredAmount,
          currentUser?.id || null,
          cashSession.id,
          isOverride ? body.override_reason : null,
          req.params.id,
        );

        db.prepare("UPDATE visitor_ticket_quotes SET status = 'used' WHERE id = ?").run(quote.id);
        recordVisitorCashMovement({
          cashSessionId: Number(cashSession.id),
          ticketId: req.params.id,
          method,
          amount,
          staffId: currentUser?.id || null,
          note: isOverride ? `Override: ${body.override_reason}` : null,
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
        entityId: req.params.id,
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
      res.json({ success: true, quote_id: result.quote.id, cash_session_id: result.cashSession.id, receipt: result.receipt });
    } catch (e: any) {
      const status = String(e.message || "").includes("no encontrado") ? 404 : 400;
      res.status(status).json({ error: e.message || "No se pudo registrar pago de visita" });
    }
  });

  app.post("/api/visitors/:id/complete", (req, res) => {
    const currentUser = getCurrentUser(req);
    const ticket = db.prepare("SELECT * FROM visitor_tickets WHERE id = ?").get(req.params.id) as any | undefined;
    if (!ticket) return res.status(404).json({ error: "Ticket de visita no encontrado" });

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE visitor_tickets
        SET status = 'completed',
            exit_time = COALESCE(exit_time, datetime('now')),
            completed_by_staff_id = ?
        WHERE id = ?
      `).run(currentUser?.id || null, ticket.id);
      if (ticket.space_id) {
        db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND type = 'parking'").run(ticket.space_id);
      }
      db.prepare(`
        INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate)
        VALUES (?, ?, 'exit', 'authorized', 'manual', 'Salida de visita finalizada manualmente', ?)
      `).run(ticket.id, ticket.space_id || null, ticket.plate || null);
    });

    transaction();
    recordAuditEvent(req, {
      action: "visitor_ticket.completed",
      entityType: "visitor_ticket",
      entityId: req.params.id,
      metadata: { plate: ticket.plate, space_id: ticket.space_id, released_space: Boolean(ticket.space_id) },
    });
    res.json({ success: true, released_space_id: ticket.space_id || null });
  });

  app.get("/api/visitors/passes", (req, res) => {
    const passes = db.prepare(`
      SELECT v.*, s.name as space_name 
      FROM visitor_passes v
      LEFT JOIN spaces s ON v.associated_space_id = s.id
      ORDER BY created_at DESC
    `).all();
    res.json(passes);
  });

  app.post("/api/visitors/passes", (req, res) => {
    const body = parseBody(createVisitorPassSchema, req.body, res);
    if (!body) return;

    const { name, rut, type, reason, plate, phone, company, authorized_by, associated_space_id } = body;
    const valid_from = normalizeVisitorDateTime(body.valid_from, "start");
    const valid_to = normalizeVisitorDateTime(body.valid_to, "end");
    if (valid_from > valid_to) {
      return res.status(400).json({ error: "La fecha de termino del pase debe ser posterior al inicio" });
    }
    let branchId: number;
    try {
      branchId = associated_space_id
        ? Number((db.prepare("SELECT branch_id FROM spaces WHERE id = ?").get(associated_space_id) as { branch_id: number | null } | undefined)?.branch_id || getBranchOrDefault(body.branch_id || null))
        : getBranchOrDefault(body.branch_id || null);
    } catch (e: any) {
      return res.status(400).json({ error: e.message || "Sucursal invalida" });
    }
    const qr_token = Math.random().toString(36).substring(2, 15);
    const result = db.prepare(`
      INSERT INTO visitor_passes (name, rut, type, reason, plate, phone, company, authorized_by, associated_space_id, branch_id, valid_from, valid_to, qr_token) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, rut, type, reason, plate, phone, company, authorized_by, associated_space_id, branchId, valid_from, valid_to, qr_token);
    recordAuditEvent(req, {
      action: "visitor_pass.created",
      entityType: "visitor_pass",
      entityId: result.lastInsertRowid,
      metadata: { name, rut, type, plate, associated_space_id, branch_id: branchId, valid_from, valid_to },
    });
    res.json({ success: true, id: result.lastInsertRowid, qr_token });
  });

  app.post("/api/visitors/passes/:id/scan", (req, res) => {
    const pass = db.prepare("SELECT * FROM visitor_passes WHERE id = ?").get(req.params.id) as any | undefined;
    if (!pass) return res.status(404).json({ error: "Pase de visita no encontrado" });

    try {
      assertPassIsUsable(pass);
      const result = db.transaction(() => {
        const plate = visitorTicketPlate(pass);

        if (pass.status === "inside") {
          const ticket = db.prepare(`
            SELECT *
            FROM visitor_tickets
            WHERE status != 'completed'
              AND plate = ?
            ORDER BY id DESC
            LIMIT 1
          `).get(plate) as any | undefined;

          db.prepare("UPDATE visitor_passes SET status = 'completed' WHERE id = ?").run(pass.id);
          if (ticket) {
            db.prepare("UPDATE visitor_tickets SET status = 'completed', exit_time = COALESCE(exit_time, datetime('now')) WHERE id = ?").run(ticket.id);
            if (ticket.space_id) db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND type = 'parking'").run(ticket.space_id);
          }
          db.prepare(`
            INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate)
            VALUES (?, ?, ?, 'exit', 'authorized', 'qr', 'Salida con pase QR', ?, ?)
          `).run(ticket?.id || null, ticket?.space_id || pass.associated_space_id || null, ticket?.branch_id || pass.branch_id || null, pass.authorized_by || null, plate);

          return { action: "exit", ticketId: ticket?.id || null, spaceId: ticket?.space_id || null };
        }

        let spaceId = pass.associated_space_id || null;
        let ticketId: number | null = null;
        let spaceType: string | null = null;

        if (spaceId) {
          const space = db.prepare("SELECT id, type, status, branch_id FROM spaces WHERE id = ?").get(spaceId) as any | undefined;
          if (!space) throw new Error("El espacio asociado al pase no existe");
          spaceType = space.type;
          if (space.type === "parking") {
            if (space.status !== "available") throw new Error("El estacionamiento asociado no esta disponible");
            db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(space.id);
          }
        } else if (pass.plate) {
          const availableSpace = db.prepare("SELECT id, type, branch_id FROM spaces WHERE type = 'parking' AND status = 'available' AND branch_id = ? LIMIT 1").get(pass.branch_id || getBranchOrDefault()) as any | undefined;
          if (!availableSpace) throw new Error("Estacionamiento lleno. No hay cupos disponibles.");
          spaceId = availableSpace.id;
          spaceType = availableSpace.type;
          db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(spaceId);
        }

        if (spaceType === "parking") {
          const ticket = db.prepare("INSERT INTO visitor_tickets (plate, space_id, branch_id, entry_method) VALUES (?, ?, ?, 'qr')").run(plate, spaceId, pass.branch_id || getBranchOrDefault());
          ticketId = Number(ticket.lastInsertRowid);
        }

        db.prepare("UPDATE visitor_passes SET status = 'inside' WHERE id = ?").run(pass.id);
        db.prepare(`
          INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate)
          VALUES (?, ?, ?, 'entry', 'authorized', 'qr', 'Ingreso con pase QR', ?, ?)
        `).run(ticketId, spaceId, pass.branch_id || getBranchOrDefault(), pass.authorized_by || null, plate);

        return { action: "entry", ticketId, spaceId };
      })();

      recordAuditEvent(req, {
        action: result.action === "entry" ? "visitor_pass.entry_scanned" : "visitor_pass.exit_scanned",
        entityType: "visitor_pass",
        entityId: pass.id,
        metadata: result,
      });
      res.json({
        success: true,
        ...result,
        message: result.action === "entry" ? "Ingreso de visita registrado por QR" : "Salida de visita registrada por QR",
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo validar el pase QR" });
    }
  });
}
