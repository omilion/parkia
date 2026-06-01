import type { Express } from "express";
import { existsSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { db } from "../db";
import { paginatedResponse, parsePagination } from "../pagination";
import { calculateVisitorTicketQuote, closeCashSession, ensureOpenCashSession, getCashSessionOperationalSummary } from "../parking";
import { resolveStoredFile, storeDocumentFile } from "../storage";
import { dateStringSchema, optionalTextSchema, parseBody } from "../validation";

const updateAccessRateSchema = z.object({
  rate_per_minute: z.coerce.number().nonnegative(),
  grace_period_mins: z.coerce.number().int().min(0),
});

const createAccessLogSchema = z.object({
  client_id: z.coerce.number().int().positive().nullable().optional(),
  visitor_id: z.coerce.number().int().positive().nullable().optional(),
  space_id: z.coerce.number().int().positive().nullable().optional(),
  access_type: z.enum(["entry", "exit"]),
  status: z.enum(["authorized", "denied"]).default("authorized"),
  method: z.enum(["fingerprint", "card", "qr", "manual"]).default("qr"),
  reason: optionalTextSchema,
  authorized_by: optionalTextSchema,
});

const optionalPositiveIntSchema = z.preprocess(
  value => value === "" || value === null || value === undefined ? null : value,
  z.coerce.number().int().positive().nullable().optional()
);

const accessOverrideSchema = z.object({
  space_id: z.coerce.number().int().positive(),
  client_id: z.coerce.number().int().positive().nullable().optional(),
  denied_access_log_id: optionalPositiveIntSchema,
  access_type: z.enum(["entry", "exit"]).optional(),
  reason: optionalTextSchema,
  authorized_by: optionalTextSchema,
});

const totemScanSchema = z.object({
  totem_id: z.coerce.number().int().positive().optional(),
  plate: z.string().trim().min(1),
});

const shiftLogQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  date: dateStringSchema.optional(),
});

const shiftFollowUpQuerySchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});

const createShiftLogSchema = z.object({
  shift_date: dateStringSchema.optional(),
  shift_name: z.enum(["morning", "afternoon", "night", "custom"]).default("custom"),
  opening_notes: optionalTextSchema,
});

const createShiftLogEntrySchema = z.object({
  category: z.enum(["access", "visitor", "incident", "maintenance", "payment", "handover", "other"]),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  title: z.string().trim().min(3),
  detail: optionalTextSchema,
  related_space_id: optionalPositiveIntSchema,
  related_access_log_id: optionalPositiveIntSchema,
  follow_up_required: z.coerce.boolean().default(false),
  attachment: z.object({
    label: optionalTextSchema,
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    dataBase64: z.string().trim().min(1),
  }).optional(),
});

const closeShiftLogSchema = z.object({
  handover_notes: z.string().trim().min(3),
  cash_count_note: optionalTextSchema,
  counted_cash: z.coerce.number().nonnegative().optional(),
  counted_transfer: z.coerce.number().nonnegative().optional(),
  counted_card: z.coerce.number().nonnegative().optional(),
  handover_items: z.array(z.object({
    title: z.string().trim().min(3),
    detail: optionalTextSchema,
    category: z.enum(["access", "visitor", "incident", "maintenance", "payment", "handover", "other"]).default("handover"),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    related_space_id: optionalPositiveIntSchema,
    related_access_log_id: optionalPositiveIntSchema,
  })).max(10).default([]),
});

const resolveShiftLogEntrySchema = z.object({
  resolved: z.coerce.boolean().default(true),
});

function normalizeShiftLog(row: any) {
  return {
    ...row,
    entries_count: Number(row.entries_count || 0),
    pending_follow_ups: Number(row.pending_follow_ups || 0),
  };
}

function normalizeShiftEntry(row: any) {
  return {
    ...row,
    follow_up_required: Boolean(row.follow_up_required),
    attachment_count: Number(row.attachment_count || 0),
  };
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res: any, fileName: string, rows: unknown[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(rows.map(row => row.map(escapeCsv).join(",")).join("\n"));
}

const shiftNameLabels: Record<string, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
  night: "Noche",
  custom: "Personalizado",
};

const shiftStatusLabels: Record<string, string> = {
  open: "Abierta",
  closed: "Cerrada",
};

const shiftEntryCategoryLabels: Record<string, string> = {
  access: "Acceso",
  visitor: "Visita",
  incident: "Incidente",
  maintenance: "Mantención",
  payment: "Pago",
  handover: "Traspaso",
  other: "Otro",
};

const shiftPriorityLabels: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

const taskStatusLabels: Record<string, string> = {
  open: "Abierta",
  in_progress: "En curso",
  done: "Cerrada",
  cancelled: "Anulada",
};

function labelFrom(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key;
}

function mapShiftEntryToTaskCategory(category: z.infer<typeof createShiftLogEntrySchema>["category"]) {
  if (category === "maintenance") return "maintenance";
  if (category === "payment") return "finance";
  if (["access", "visitor", "incident"].includes(category)) return "access";
  return "general";
}

function getDefaultAssigneeForShiftTask(category: string, currentUserId: number | null | undefined) {
  if (category === "finance") {
    const financeStaff = db.prepare(`
      SELECT id
      FROM staff
      WHERE role = 'finance'
        AND status = 'active'
      ORDER BY id ASC
      LIMIT 1
    `).get() as { id: number } | undefined;
    return financeStaff?.id || null;
  }

  if (category === "access" || category === "maintenance") return currentUserId || null;

  const adminStaff = db.prepare(`
    SELECT id
    FROM staff
    WHERE role = 'admin'
      AND status = 'active'
    ORDER BY id ASC
    LIMIT 1
  `).get() as { id: number } | undefined;
  return adminStaff?.id || currentUserId || null;
}

function createShiftFollowUpTask(args: {
  entryId: number;
  title: string;
  detail: string | null | undefined;
  category: z.infer<typeof createShiftLogEntrySchema>["category"];
  priority: z.infer<typeof createShiftLogEntrySchema>["priority"];
  relatedSpaceId?: number | null;
  relatedAccessLogId?: number | null;
  shiftLog: any;
  currentUserId: number | null | undefined;
}) {
  const taskCategory = mapShiftEntryToTaskCategory(args.category);
  const assigneeId = getDefaultAssigneeForShiftTask(taskCategory, args.currentUserId || null);
  const taskDescription = [
    args.detail || "Seguimiento registrado desde bitácora de turno.",
    "",
    `Turno: ${args.shiftLog.shift_date} ${args.shiftLog.shift_name}`,
    `Bitácora: #${args.shiftLog.id}`,
    args.category === "payment" ? "Origen operacional: Guardia reportó un pendiente de pago. Finanzas debe gestionar esta tarea con el resumen disponible; Admin/Guardia pueden ampliar evidencia de la bitácora si hace falta." : null,
    args.relatedSpaceId ? `Espacio relacionado: #${args.relatedSpaceId}` : null,
    args.relatedAccessLogId ? `Acceso relacionado: #${args.relatedAccessLogId}` : null,
  ].filter(Boolean).join("\n");
  const taskResult = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, source_type, source_id, due_date, created_by_staff_id
    )
    VALUES (?, ?, ?, ?, ?, 'guard_shift_log', ?, ?, ?)
  `).run(
    `Seguimiento guardia: ${args.title}`,
    taskDescription,
    taskCategory,
    args.priority,
    assigneeId,
    String(args.entryId),
    args.shiftLog.shift_date,
    args.currentUserId || null
  );
  db.prepare("UPDATE guard_shift_log_entries SET task_id = ? WHERE id = ?").run(taskResult.lastInsertRowid, args.entryId);
  return Number(taskResult.lastInsertRowid);
}

function getShiftLog(id: string | number) {
  return db.prepare(`
    SELECT l.*,
           s.name as staff_name,
           s.email as staff_email,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id) as entries_count,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
    FROM guard_shift_logs l
    JOIN staff s ON s.id = l.staff_id
    WHERE l.id = ?
  `).get(id) as any | undefined;
}

export function registerAccessRoutes(app: Express) {
  app.use(["/api/access", "/api/totems/scan"], requireAnyRole(["admin", "guard"]));

  app.post("/api/access", (req, res) => {
    const body = parseBody(createAccessLogSchema, req.body, res);
    if (!body) return;

    const { client_id, visitor_id, space_id, access_type, status, method, reason, authorized_by } = body;
    const result = db.prepare(`
      INSERT INTO access_logs (client_id, visitor_id, space_id, access_type, status, method, reason, authorized_by) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(client_id, visitor_id, space_id, access_type, status, method, reason, authorized_by);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.post("/api/totems/scan", (req, res) => {
    const body = parseBody(totemScanSchema, req.body, res);
    if (!body) return;

    const { plate } = body;

    const normalizedPlate = plate.replace(/-/g, '').toUpperCase();

    // 1. Check if the plate belongs to a client
    const vehicle = db.prepare(`
      SELECT v.*, c.name as client_name 
      FROM vehicles v 
      JOIN clients c ON v.client_id = c.id 
      WHERE REPLACE(plate, '-', '') = ?
        AND COALESCE(v.status, 'active') = 'active'
    `).get(normalizedPlate) as any;

    // 2. Determine if it's an Entry or Exit based on last access
    const lastAccess = db.prepare(`
      SELECT access_type, space_id, visitor_id FROM access_logs 
      WHERE REPLACE(plate, '-', '') = ? 
      ORDER BY timestamp DESC LIMIT 1
    `).get(normalizedPlate) as { access_type: string, space_id: number, visitor_id: number } | undefined;

    const isExit = lastAccess && lastAccess.access_type === 'entry';

    if (isExit) {
      if (vehicle) {
        // Exit client
        db.prepare(`
          INSERT INTO access_logs (client_id, space_id, access_type, status, method, reason, plate) 
          VALUES (?, ?, 'exit', 'authorized', 'qr', 'Salida de cliente', ?)
        `).run(vehicle.client_id, lastAccess.space_id, plate);
        return res.json({ success: true, type: 'client', message: `Hasta luego ${vehicle.client_name}` });
      } else {
        // Exit visitor
        const dbTransaction = db.transaction(() => {
          const ticket = db.prepare("SELECT status, entry_time FROM visitor_tickets WHERE id = ?").get(lastAccess.visitor_id) as { status: string, entry_time: string } | undefined;

          if (ticket && ticket.status !== 'paid') {
            const quote = calculateVisitorTicketQuote(lastAccess.visitor_id).quote;
            if (Number(quote.total || 0) > 0) {
              throw new Error(`Debe pagar su ticket. Tiempo transcurrido: ${quote.duration_mins} min (Gracia: ${quote.grace_period_mins} min, cobrables: ${quote.billable_mins} min).`);
            }
          }

          db.prepare("UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ?").run(lastAccess.visitor_id);
          db.prepare("UPDATE spaces SET status = 'available' WHERE id = ?").run(lastAccess.space_id);
          db.prepare(`
            INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate) 
            VALUES (?, ?, 'exit', 'authorized', 'qr', 'Salida Visita', ?)
          `).run(lastAccess.visitor_id, lastAccess.space_id, plate);
        });

        try {
          dbTransaction();
          return res.json({ success: true, type: 'visitor', message: `Visita finalizada. Hasta luego.` });
        } catch (e: any) {
          if (String(e.message || "").startsWith("Debe pagar su ticket")) {
            db.prepare(`
              INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate)
              VALUES (?, ?, 'exit', 'denied', 'qr', 'Ticket pendiente de pago', ?)
            `).run(lastAccess.visitor_id, lastAccess.space_id, plate);
          }
          return res.status(400).json({ error: e.message });
        }
      }
    }

    if (vehicle) {
      // Find the space associated with this client's contract
      const contract = db.prepare("SELECT space_id FROM contracts WHERE client_id = ? AND status = 'active'").get(vehicle.client_id) as { space_id: number };

      const spaceId = contract ? contract.space_id : null;

      // Log access ENTRY
      db.prepare(`
        INSERT INTO access_logs (client_id, space_id, access_type, status, method, reason, plate) 
        VALUES (?, ?, 'entry', 'authorized', 'qr', 'Lectura de patente', ?)
      `).run(vehicle.client_id, spaceId, plate);

      return res.json({ success: true, type: 'client', message: `Bienvenido ${vehicle.client_name}` });
    }

    // 3. If it's a new visitor entry, find an available parking space ENTRY
    const dbTransaction = db.transaction(() => {
      // Find available parking space
      const availableSpace = db.prepare("SELECT id FROM spaces WHERE type = 'parking' AND status = 'available' LIMIT 1").get() as { id: number };

      if (!availableSpace) {
        throw new Error("Estacionamiento lleno. No hay cupos disponibles.");
      }

      // Mark space as occupied
      db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(availableSpace.id);

      // Create visitor ticket
      const ticket = db.prepare("INSERT INTO visitor_tickets (plate, space_id, entry_method) VALUES (?, ?, 'totem')").run(plate, availableSpace.id);

      // Log access ENTRY
      db.prepare(`
        INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate) 
        VALUES (?, ?, 'entry', 'authorized', 'qr', 'Visita Temporal', ?)
      `).run(ticket.lastInsertRowid, availableSpace.id, plate);

      return ticket.lastInsertRowid;
    });

    try {
      dbTransaction();
      return res.json({ success: true, type: 'visitor', message: `Ticket de visita generado. Adelante.` });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/access/live", (req, res) => {
    const logs = db.prepare(`
      SELECT a.*, c.name as client_name, s.name as space_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
      FROM access_logs a
      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN spaces s ON a.space_id = s.id
      LEFT JOIN visitor_passes v ON a.visitor_id = v.id
      ORDER BY timestamp DESC LIMIT 20
    `).all();
    res.json(logs);
  });

  app.get("/api/access/audit", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser?.role !== "admin") {
      return res.status(403).json({ error: "Solo administracion puede consultar auditoria historica de accesos" });
    }

    const { start, end, type, user } = req.query;
    let query = `
      SELECT a.*, c.name as client_name, s.name as space_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
      FROM access_logs a

      LEFT JOIN clients c ON a.client_id = c.id
      LEFT JOIN spaces s ON a.space_id = s.id
      LEFT JOIN visitor_passes v ON a.visitor_id = v.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (start) {
      query += " AND timestamp >= ?";
      params.push(start);
    }
    if (end) {
      query += " AND timestamp <= ?";
      params.push(end);
    }
    if (type) {
      query += " AND a.status = ?";
      params.push(type);
    }
    if (user) {
      query += " AND (c.name LIKE ? OR v.name LIKE ? OR c.rut LIKE ? OR v.rut LIKE ? OR a.plate LIKE ?)";
      const p = `%${user}%`;
      params.push(p, p, p, p, p);
    }

    const total = Number((db.prepare(`SELECT COUNT(*) as count FROM (${query}) audit_rows`).get(...params) as { count: number }).count || 0);
    query += " ORDER BY timestamp DESC";
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const listParams = [...params];
    if (pagination.requested) {
      query += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const logs = db.prepare(query).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(logs, total, pagination) : logs);
  });

  app.get("/api/access/shift-logs", (req, res) => {
    const query = shiftLogQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de bitácora inválidos" });

    let where = "WHERE 1=1";
    const params: Array<string | number> = [];
    if (query.data.status !== "all") {
      where += " AND l.status = ?";
      params.push(query.data.status);
    }
    if (query.data.date) {
      where += " AND l.shift_date = ?";
      params.push(query.data.date);
    }

    const logs = db.prepare(`
      SELECT l.*,
             s.name as staff_name,
             s.email as staff_email,
             (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id) as entries_count,
             (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
      FROM guard_shift_logs l
      JOIN staff s ON s.id = l.staff_id
      ${where}
      ORDER BY l.opened_at DESC
      LIMIT 50
    `).all(...params).map(normalizeShiftLog);

    res.json(logs);
  });

  app.get("/api/access/shift-logs/current", (req, res) => {
    const currentUser = getCurrentUser(req);
    const log = db.prepare(`
      SELECT l.*,
             s.name as staff_name,
             s.email as staff_email,
             (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id) as entries_count,
             (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
      FROM guard_shift_logs l
      JOIN staff s ON s.id = l.staff_id
      WHERE l.staff_id = ? AND l.status = 'open'
      ORDER BY l.opened_at DESC
      LIMIT 1
    `).get(currentUser?.id || 0) as any | undefined;

    res.json({ shiftLog: log ? normalizeShiftLog(log) : null });
  });

  app.get("/api/access/shift-log-follow-ups", (req, res) => {
    const query = shiftFollowUpQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de seguimientos inválidos" });

    let where = "WHERE e.follow_up_required = 1";
    if (query.data.status === "open") {
      where += " AND e.resolved_at IS NULL";
    } else if (query.data.status === "resolved") {
      where += " AND e.resolved_at IS NOT NULL";
    }

    const entries = db.prepare(`
      SELECT e.*,
             author.name as staff_name,
             sp.name as related_space_name,
             t.status as task_status,
             t.title as task_title,
             (SELECT COUNT(*) FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id) as attachment_count,
             (SELECT id FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id ORDER BY a.id DESC LIMIT 1) as attachment_id,
             (SELECT file_name FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id ORDER BY a.id DESC LIMIT 1) as attachment_file_name,
             l.shift_date,
             l.shift_name,
             l.status as shift_status,
             owner.name as shift_staff_name
      FROM guard_shift_log_entries e
      JOIN guard_shift_logs l ON l.id = e.shift_log_id
      JOIN staff author ON author.id = e.staff_id
      JOIN staff owner ON owner.id = l.staff_id
      LEFT JOIN spaces sp ON sp.id = e.related_space_id
      LEFT JOIN operational_tasks t ON t.id = e.task_id
      ${where}
      ORDER BY
        CASE e.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        e.created_at DESC
      LIMIT 100
    `).all().map(normalizeShiftEntry);

    res.json(entries);
  });

  app.get("/api/access/export/shift-log-follow-ups.csv", (req, res) => {
    const query = shiftFollowUpQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de seguimientos inválidos" });

    let where = "WHERE e.follow_up_required = 1";
    if (query.data.status === "open") {
      where += " AND e.resolved_at IS NULL";
    } else if (query.data.status === "resolved") {
      where += " AND e.resolved_at IS NOT NULL";
    }

    const rows = db.prepare(`
      SELECT e.id,
             l.id as shift_log_id,
             l.shift_date,
             l.shift_name,
             l.status as shift_status,
             e.category,
             e.priority,
             e.title,
             e.detail,
             e.created_at,
             e.resolved_at,
             e.task_id,
             t.status as task_status,
             sp.name as related_space_name,
             author.name as staff_name,
             owner.name as shift_staff_name
      FROM guard_shift_log_entries e
      JOIN guard_shift_logs l ON l.id = e.shift_log_id
      JOIN staff author ON author.id = e.staff_id
      JOIN staff owner ON owner.id = l.staff_id
      LEFT JOIN spaces sp ON sp.id = e.related_space_id
      LEFT JOIN operational_tasks t ON t.id = e.task_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT 500
    `).all() as any[];

    const columns = [
      ["ID", "id"],
      ["Bitácora", "shift_log_id"],
      ["Fecha turno", "shift_date"],
      ["Turno", "shift_name"],
      ["Estado turno", "shift_status"],
      ["Categoría", "category"],
      ["Prioridad", "priority"],
      ["Título", "title"],
      ["Detalle", "detail"],
      ["Creado el", "created_at"],
      ["Resuelto el", "resolved_at"],
      ["Tarea", "task_id"],
      ["Estado tarea", "task_status"],
      ["Espacio relacionado", "related_space_name"],
      ["Registrado por", "staff_name"],
      ["Responsable turno", "shift_staff_name"],
    ] as const;
    sendCsv(res, `seguimientos-bitacora-${query.data.status}.csv`, [
      columns.map(([label]) => label),
      ...rows.map(row => columns.map(([, key]) => {
        if (key === "shift_name") return labelFrom(shiftNameLabels, row[key]);
        if (key === "shift_status") return labelFrom(shiftStatusLabels, row[key]);
        if (key === "category") return labelFrom(shiftEntryCategoryLabels, row[key]);
        if (key === "priority") return labelFrom(shiftPriorityLabels, row[key]);
        if (key === "task_status") return labelFrom(taskStatusLabels, row[key]);
        return row[key];
      })),
    ]);
  });

  app.get("/api/access/shift-logs/:id", (req, res) => {
    let log = getShiftLog(req.params.id);
    if (!log) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    if (log.status === "open" && !log.cash_session_id) {
      const cashSession = ensureOpenCashSession(getCurrentUser(req), Number(log.id));
      db.prepare("UPDATE guard_shift_logs SET cash_session_id = ?, updated_at = datetime('now') WHERE id = ?").run(cashSession.id, log.id);
      log = getShiftLog(req.params.id);
      if (!log) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    }

    const entries = db.prepare(`
      SELECT e.*,
             s.name as staff_name,
             sp.name as related_space_name,
             t.status as task_status,
             t.title as task_title,
             (SELECT COUNT(*) FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id) as attachment_count,
             (SELECT id FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id ORDER BY a.id DESC LIMIT 1) as attachment_id,
             (SELECT file_name FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id ORDER BY a.id DESC LIMIT 1) as attachment_file_name
      FROM guard_shift_log_entries e
      JOIN staff s ON s.id = e.staff_id
      LEFT JOIN spaces sp ON sp.id = e.related_space_id
      LEFT JOIN operational_tasks t ON t.id = e.task_id
      WHERE e.shift_log_id = ?
      ORDER BY e.created_at DESC
    `).all(req.params.id).map(normalizeShiftEntry);

    const cash = log.cash_session_id ? getCashSessionOperationalSummary(log.cash_session_id) : null;

    res.json({ shiftLog: normalizeShiftLog(log), entries, cash });
  });

  app.get("/api/access/shift-logs/:id/export.csv", (req, res) => {
    const log = getShiftLog(req.params.id);
    if (!log) return res.status(404).json({ error: "Bitácora de turno no encontrada" });

    const entries = db.prepare(`
      SELECT e.id,
             e.category,
             e.priority,
             e.title,
             e.detail,
             e.follow_up_required,
             e.resolved_at,
             e.created_at,
             e.task_id,
             t.status as task_status,
             sp.name as related_space_name,
             s.name as staff_name
      FROM guard_shift_log_entries e
      JOIN staff s ON s.id = e.staff_id
      LEFT JOIN spaces sp ON sp.id = e.related_space_id
      LEFT JOIN operational_tasks t ON t.id = e.task_id
      WHERE e.shift_log_id = ?
      ORDER BY e.created_at ASC
    `).all(req.params.id) as any[];

    const rows = [
      ["Sección", "Campo", "Valor"],
      ["Turno", "ID", log.id],
      ["Turno", "Fecha", log.shift_date],
      ["Turno", "Nombre", labelFrom(shiftNameLabels, log.shift_name)],
      ["Turno", "Estado", labelFrom(shiftStatusLabels, log.status)],
      ["Turno", "Responsable", log.staff_name],
      ["Turno", "Abierto el", log.opened_at],
      ["Turno", "Cerrado el", log.closed_at || ""],
      ["Turno", "Notas de apertura", log.opening_notes || ""],
      ["Turno", "Notas de traspaso", log.handover_notes || ""],
      ["Turno", "Nota de caja", log.cash_count_note || ""],
      [],
      ["ID novedad", "Categoría", "Prioridad", "Título", "Detalle", "Requiere seguimiento", "Resuelto el", "Creado el", "Tarea", "Estado tarea", "Espacio", "Registrado por"],
      ...entries.map(entry => [
        entry.id,
        labelFrom(shiftEntryCategoryLabels, entry.category),
        labelFrom(shiftPriorityLabels, entry.priority),
        entry.title,
        entry.detail || "",
        entry.follow_up_required ? "Sí" : "No",
        entry.resolved_at || "",
        entry.created_at,
        entry.task_id || "",
        labelFrom(taskStatusLabels, entry.task_status),
        entry.related_space_name || "",
        entry.staff_name || "",
      ]),
    ];

    sendCsv(res, `bitacora-turno-${log.id}.csv`, rows);
  });

  app.post("/api/access/shift-logs", (req, res) => {
    const body = parseBody(createShiftLogSchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);

    const existing = db.prepare(`
      SELECT id FROM guard_shift_logs
      WHERE staff_id = ? AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(currentUser?.id || 0) as { id: number } | undefined;
    if (existing) {
      let shiftLog = getShiftLog(existing.id);
      if (shiftLog && !shiftLog.cash_session_id) {
        const cashSession = ensureOpenCashSession(currentUser, Number(existing.id));
        db.prepare("UPDATE guard_shift_logs SET cash_session_id = ?, updated_at = datetime('now') WHERE id = ?").run(cashSession.id, existing.id);
        shiftLog = getShiftLog(existing.id);
      }
      return res.json({ success: true, existing: true, shiftLog: normalizeShiftLog(shiftLog) });
    }

    const shiftDate = body.shift_date || new Date().toISOString().slice(0, 10);
    const result = db.prepare(`
      INSERT INTO guard_shift_logs (staff_id, shift_date, shift_name, opening_notes)
      VALUES (?, ?, ?, ?)
    `).run(currentUser?.id || null, shiftDate, body.shift_name, body.opening_notes);
    const cashSession = ensureOpenCashSession(currentUser, Number(result.lastInsertRowid));
    db.prepare("UPDATE cash_sessions SET shift_log_id = COALESCE(shift_log_id, ?) WHERE id = ?").run(result.lastInsertRowid, cashSession.id);
    db.prepare("UPDATE guard_shift_logs SET cash_session_id = ? WHERE id = ?").run(cashSession.id, result.lastInsertRowid);

    recordAuditEvent(req, {
      action: "guard_shift_log.opened",
      entityType: "guard_shift_log",
      entityId: result.lastInsertRowid,
      metadata: { shift_date: shiftDate, shift_name: body.shift_name, cash_session_id: cashSession.id },
    });

    res.json({ success: true, existing: false, shiftLog: normalizeShiftLog(getShiftLog(result.lastInsertRowid)) });
  });

  app.post("/api/access/shift-logs/:id/entries", (req, res) => {
    const body = parseBody(createShiftLogEntrySchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);
    const shiftLog = getShiftLog(req.params.id);
    if (!shiftLog) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    if (shiftLog.status !== "open") return res.status(400).json({ error: "No se pueden agregar novedades a un turno cerrado" });

    const createEntry = db.transaction(() => {
      const entryResult = db.prepare(`
        INSERT INTO guard_shift_log_entries (
          shift_log_id, staff_id, category, priority, title, detail,
          related_space_id, related_access_log_id, follow_up_required
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.params.id,
        currentUser?.id || null,
        body.category,
        body.priority,
        body.title,
        body.detail,
        body.related_space_id,
        body.related_access_log_id,
        body.follow_up_required ? 1 : 0
      );

      if (body.attachment) {
        const stored = storeDocumentFile({
          fileName: body.attachment.fileName,
          mimeType: body.attachment.mimeType,
          dataBase64: body.attachment.dataBase64,
          folder: "shift-log-evidence",
        });
        db.prepare(`
          INSERT INTO shift_log_entry_attachments (
            shift_log_entry_id, staff_id, label, file_path, file_name, mime_type, size_bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          entryResult.lastInsertRowid,
          currentUser?.id || null,
          body.attachment.label || null,
          stored.filePath,
          stored.fileName,
          stored.mimeType,
          stored.sizeBytes,
        );
      }

      let taskId: number | null = null;
      if (body.follow_up_required) {
        taskId = createShiftFollowUpTask({
          entryId: Number(entryResult.lastInsertRowid),
          title: body.title,
          detail: body.detail,
          category: body.category,
          priority: body.priority,
          relatedSpaceId: body.related_space_id,
          relatedAccessLogId: body.related_access_log_id,
          shiftLog,
          currentUserId: currentUser?.id || null,
        });
      }

      db.prepare("UPDATE guard_shift_logs SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
      return { entryId: Number(entryResult.lastInsertRowid), taskId, attachment: Boolean(body.attachment) };
    });

    const result = createEntry();

    recordAuditEvent(req, {
      action: "guard_shift_log.entry_created",
      entityType: "guard_shift_log_entry",
      entityId: result.entryId,
      metadata: { shift_log_id: Number(req.params.id), category: body.category, priority: body.priority, follow_up_required: body.follow_up_required, attachment: result.attachment },
    });
    if (result.taskId) {
      recordAuditEvent(req, {
        action: "operational_task.created",
        entityType: "operational_task",
        entityId: result.taskId,
        metadata: { source_type: "guard_shift_log", source_id: String(result.entryId), title: body.title },
      });
    }

    res.json({ success: true, id: result.entryId, task_id: result.taskId });
  });

  app.get("/api/access/shift-log-entries/:entryId/attachments/:attachmentId/download", (req, res) => {
    const attachment = db.prepare(`
      SELECT file_path, file_name, mime_type
      FROM shift_log_entry_attachments
      WHERE id = ? AND shift_log_entry_id = ?
    `).get(req.params.attachmentId, req.params.entryId) as { file_path: string, file_name: string, mime_type: string } | undefined;
    if (!attachment) return res.status(404).json({ error: "Evidencia no encontrada" });

    try {
      const absolutePath = resolveStoredFile(attachment.file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Archivo no encontrado" });
      res.type(attachment.mime_type);
      res.download(absolutePath, attachment.file_name);
    } catch {
      res.status(400).json({ error: "Ruta de evidencia invalida" });
    }
  });

  app.patch("/api/access/shift-log-entries/:id/resolve", (req, res) => {
    const body = parseBody(resolveShiftLogEntrySchema, req.body, res);
    if (!body) return;

    const entry = db.prepare("SELECT * FROM guard_shift_log_entries WHERE id = ?").get(req.params.id) as any | undefined;
    if (!entry) return res.status(404).json({ error: "Novedad de turno no encontrada" });
    const currentUser = getCurrentUser(req);

    if (entry.task_id && currentUser?.role === "guard") {
      const linkedTask = db.prepare("SELECT category, status FROM operational_tasks WHERE id = ?").get(entry.task_id) as { category: string, status: string } | undefined;
      if (linkedTask?.category === "finance" && linkedTask.status !== "done") {
        return res.status(403).json({ error: "Los pendientes financieros deben cerrarse desde Finanzas o Administracion" });
      }
    }

    db.prepare(`
      UPDATE guard_shift_log_entries
      SET resolved_at = ?
      WHERE id = ?
    `).run(body.resolved ? new Date().toISOString().replace("T", " ").slice(0, 19) : null, req.params.id);
    if (entry.task_id) {
      if (body.resolved) {
        db.prepare(`
          UPDATE operational_tasks
          SET status = 'done',
              completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
              completed_note = COALESCE(completed_note, 'Resuelto desde bitácora de turno'),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status != 'cancelled'
        `).run(entry.task_id);
      } else {
        db.prepare(`
          UPDATE operational_tasks
          SET status = 'open',
              completed_at = NULL,
              completed_note = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND status = 'done'
        `).run(entry.task_id);
      }
    }
    db.prepare("UPDATE guard_shift_logs SET updated_at = datetime('now') WHERE id = ?").run(entry.shift_log_id);

    recordAuditEvent(req, {
      action: body.resolved ? "guard_shift_log.entry_resolved" : "guard_shift_log.entry_reopened",
      entityType: "guard_shift_log_entry",
      entityId: req.params.id,
      metadata: { shift_log_id: entry.shift_log_id },
    });
    if (entry.task_id) {
      recordAuditEvent(req, {
        action: body.resolved ? "operational_task.completed" : "operational_task.updated",
        entityType: "operational_task",
        entityId: entry.task_id,
        metadata: body.resolved
          ? { note: "Resuelto desde bitácora de turno", source_type: "guard_shift_log", source_id: String(entry.id) }
          : { status: "open", source_type: "guard_shift_log", source_id: String(entry.id) },
      });
    }

    res.json({ success: true });
  });

  app.patch("/api/access/shift-logs/:id/close", (req, res) => {
    const body = parseBody(closeShiftLogSchema, req.body, res);
    if (!body) return;

    const shiftLog = getShiftLog(req.params.id);
    if (!shiftLog) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    if (shiftLog.status === "closed") return res.status(400).json({ error: "El turno ya está cerrado" });

    const currentUser = getCurrentUser(req);
    const closeShift = db.transaction(() => {
      let cashClosure: any = null;
      if (shiftLog.cash_session_id) {
        const cashSummary = getCashSessionOperationalSummary(shiftLog.cash_session_id);
        if (cashSummary.blockers.paidTicketsAwaitingExit > 0) {
          throw new Error(`No se puede cerrar el turno: hay ${cashSummary.blockers.paidTicketsAwaitingExit} ticket(s) pagado(s) pendientes de salida.`);
        }
        if (cashSummary.session.status === "open") {
          cashClosure = closeCashSession({
            req,
            cashSessionId: Number(shiftLog.cash_session_id),
            countedCash: body.counted_cash ?? Number(cashSummary.expectedCash || 0),
            countedTransfer: body.counted_transfer || 0,
            countedCard: body.counted_card || 0,
            notes: body.cash_count_note || null,
            user: currentUser,
          });
        }
      }

      db.prepare(`
        UPDATE guard_shift_logs
        SET status = 'closed',
            handover_notes = ?,
            cash_count_note = ?,
            closed_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(body.handover_notes, body.cash_count_note, req.params.id);

      const handoverItems = body.handover_items.map(item => {
        const entryResult = db.prepare(`
          INSERT INTO guard_shift_log_entries (
            shift_log_id, staff_id, category, priority, title, detail,
            related_space_id, related_access_log_id, follow_up_required
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          req.params.id,
          currentUser?.id || null,
          item.category,
          item.priority,
          item.title,
          item.detail,
          item.related_space_id,
          item.related_access_log_id,
        );
        const entryId = Number(entryResult.lastInsertRowid);
        const taskId = createShiftFollowUpTask({
          entryId,
          title: item.title,
          detail: item.detail || "Pendiente estructurado traspasado al siguiente turno.",
          category: item.category,
          priority: item.priority,
          relatedSpaceId: item.related_space_id,
          relatedAccessLogId: item.related_access_log_id,
          shiftLog,
          currentUserId: currentUser?.id || null,
        });
        return { entryId, taskId, title: item.title, category: item.category, priority: item.priority };
      });
      return { handoverItems, cashClosure };
    });

    let createdHandoverItems: ReturnType<typeof closeShift>;
    try {
      createdHandoverItems = closeShift();
    } catch (e: any) {
      return res.status(400).json({ error: e.message || "No se pudo cerrar el turno" });
    }

    recordAuditEvent(req, {
      action: "guard_shift_log.closed",
      entityType: "guard_shift_log",
      entityId: req.params.id,
      metadata: {
        pending_follow_ups: shiftLog.pending_follow_ups + createdHandoverItems.handoverItems.length,
        handover_items: createdHandoverItems.handoverItems.length,
        cash_session_id: shiftLog.cash_session_id || null,
        cash_closure: createdHandoverItems.cashClosure,
      },
    });
    for (const item of createdHandoverItems.handoverItems) {
      recordAuditEvent(req, {
        action: "guard_shift_log.handover_item_created",
        entityType: "guard_shift_log_entry",
        entityId: item.entryId,
        metadata: { shift_log_id: Number(req.params.id), task_id: item.taskId, title: item.title, category: item.category, priority: item.priority },
      });
      recordAuditEvent(req, {
        action: "operational_task.created",
        entityType: "operational_task",
        entityId: item.taskId,
        metadata: { source_type: "guard_shift_log", source_id: String(item.entryId), title: item.title },
      });
    }

    res.json({ success: true, shiftLog: normalizeShiftLog(getShiftLog(req.params.id)) });
  });

  app.post("/api/access/override", (req, res) => {
    const body = parseBody(accessOverrideSchema, req.body, res);
    if (!body) return;

    const currentUser = getCurrentUser(req);
    const { space_id, client_id, denied_access_log_id, access_type, reason, authorized_by } = body;
    const authorizedBy = currentUser?.name || authorized_by || "Usuario autenticado";
    const transaction = db.transaction(() => {
      const deniedLog = denied_access_log_id ? db.prepare(`
        SELECT *
        FROM access_logs
        WHERE id = ? AND status = 'denied'
      `).get(denied_access_log_id) as any | undefined : null;
      if (denied_access_log_id && !deniedLog) throw new Error("Acceso denegado no encontrado o ya no corresponde");
      if (deniedLog?.resolved_by_access_log_id) throw new Error("El acceso denegado ya fue resuelto");

      const resolvedAccessType = deniedLog?.access_type || access_type || "entry";
      const resolvedSpaceId = deniedLog?.space_id || space_id;
      const resolvedVisitorId = deniedLog?.visitor_id || null;
      const resolvedClientId = client_id || deniedLog?.client_id || null;

      const result = db.prepare(`
        INSERT INTO access_logs (client_id, visitor_id, space_id, access_type, status, method, reason, authorized_by, plate)
        VALUES (?, ?, ?, ?, 'authorized', 'manual', ?, ?, ?)
      `).run(
        resolvedClientId,
        resolvedVisitorId,
        resolvedSpaceId,
        resolvedAccessType,
        reason,
        authorizedBy,
        deniedLog?.plate || null,
      );

      if (resolvedAccessType === "exit" && resolvedVisitorId) {
        db.prepare("UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ?").run(resolvedVisitorId);
        db.prepare("UPDATE spaces SET status = 'available' WHERE id = ?").run(resolvedSpaceId);
      }

      if (resolvedAccessType === "entry" && resolvedVisitorId) {
        db.prepare("UPDATE visitor_tickets SET status = 'active' WHERE id = ?").run(resolvedVisitorId);
        db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(resolvedSpaceId);
      }

      if (deniedLog) {
        db.prepare(`
          UPDATE access_logs
          SET resolved_by_access_log_id = ?,
              resolved_at = datetime('now'),
              resolution_note = ?
          WHERE id = ?
        `).run(result.lastInsertRowid, reason, deniedLog.id);
      }

      return { id: Number(result.lastInsertRowid), deniedLogId: deniedLog?.id || null, accessType: resolvedAccessType, visitorId: resolvedVisitorId, spaceId: resolvedSpaceId };
    });

    try {
      const result = transaction();
      recordAuditEvent(req, {
        action: result.deniedLogId ? "access.denied_resolved_by_override" : "access.manual_override",
        entityType: "access_log",
        entityId: result.id,
        metadata: {
          denied_access_log_id: result.deniedLogId,
          space_id: result.spaceId,
          access_type: result.accessType,
          visitor_id: result.visitorId,
          reason: reason || null,
          device_action: "manual_protocol_no_remote_actuator",
        },
      });
      res.json({
        success: true,
        id: result.id,
        denied_access_log_id: result.deniedLogId,
        access_type: result.accessType,
        manual_only: true,
        message: "Autorizacion manual registrada. Accione el acceso fisico segun protocolo operativo.",
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo registrar la apertura manual" });
    }
  });

  app.get("/api/access/rates", (req, res) => {
    const rates = db.prepare("SELECT * FROM access_rates").all();
    res.json(rates);
  });

  app.patch("/api/access/rates/:id", (req, res) => {
    const currentUser = getCurrentUser(req);
    if (currentUser?.role !== "admin") {
      return res.status(403).json({ error: "Solo administración puede modificar tarifas de acceso" });
    }

    const body = parseBody(updateAccessRateSchema, req.body, res);
    if (!body) return;

    const { rate_per_minute, grace_period_mins } = body;
    const previous = db.prepare("SELECT * FROM access_rates WHERE id = ?").get(req.params.id) as any | undefined;
    if (!previous) return res.status(404).json({ error: "Tarifa no encontrada" });
    db.prepare(`
      UPDATE access_rates
      SET rate_per_minute = ?,
          rate_per_hour = ?,
          grace_period_mins = ?,
          billing_mode = 'per_minute'
      WHERE id = ?
    `).run(rate_per_minute, rate_per_minute * 60, grace_period_mins, req.params.id);
    recordAuditEvent(req, {
      action: "access_rate.updated",
      entityType: "access_rate",
      entityId: req.params.id,
      metadata: { previous, next: { billing_mode: "per_minute", rate_per_minute, rate_per_hour: rate_per_minute * 60, grace_period_mins } },
    });
    res.json({ success: true });
  });
}

