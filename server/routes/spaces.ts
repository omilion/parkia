import type { Express } from "express";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { getBranchOrDefault } from "../branches";
import { db } from "../db";
import { optionalTextSchema, parseBody } from "../validation";

const createSpaceSchema = z.object({
  name: z.string().trim().min(1),
  type: z.literal("parking"),
  status: z.enum(["available", "occupied", "maintenance"]).default("available"),
  price: z.coerce.number().nonnegative(),
  location: optionalTextSchema,
  level: optionalTextSchema,
  width_m: z.coerce.number().nonnegative().optional().nullable(),
  length_m: z.coerce.number().nonnegative().optional().nullable(),
  height_m: z.coerce.number().nonnegative().optional().nullable(),
  features: optionalTextSchema,
  notes: optionalTextSchema,
  branch_id: z.coerce.number().int().positive().optional(),
});

const updateSpaceSchema = createSpaceSchema.omit({ status: true }).partial().extend({
  reason: z.string().trim().min(3).max(500),
});

const updateSpaceStatusSchema = z.object({
  status: z.enum(["available", "occupied", "maintenance"]),
  notes: optionalTextSchema,
});

const forceReleaseSpaceSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const spacesQuerySchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
});

function recordSpaceHistory(req: any, input: { spaceId: string | number, previousStatus?: string | null, status: string, reason?: string | null, source: string }) {
  const user = getCurrentUser(req);
  db.prepare(`
    INSERT INTO space_status_history (space_id, staff_id, previous_status, status, reason, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.spaceId, user?.id || null, input.previousStatus || null, input.status, input.reason || null, input.source);
}

function isLimitedOperationalRole(role?: string | null) {
  return role === "guard" || role === "cashier";
}

function assignedClientForRole(row: any, role?: string | null) {
  if (!row.client_id) return null;
  if (isLimitedOperationalRole(role)) {
    return {
      id: row.client_id,
      name: row.client_name,
    };
  }
  return {
    id: row.client_id,
    name: row.client_name,
    rut: row.client_rut,
    financial_status: row.financial_status,
  };
}

export function registerSpacesRoutes(app: Express) {
  app.get("/api/spaces/available", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const query = spacesQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    const params: Array<string | number> = [];
    let where = "WHERE s.status = 'available'";
    if (query.data.branch_id) {
      where += " AND s.branch_id = ?";
      params.push(query.data.branch_id);
    }

    const spaces = db.prepare(`
      SELECT s.*, b.name as branch_name, b.code as branch_code
      FROM spaces s
      LEFT JOIN branches b ON b.id = s.branch_id
      ${where}
      ORDER BY b.name ASC, s.name ASC
    `).all(...params);
    res.json(spaces);
  });

  app.get("/api/spaces", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const query = spacesQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    const currentUser = getCurrentUser(req);
    const params: Array<string | number> = [];
    let where = "";
    if (query.data.branch_id) {
      where = "WHERE s.branch_id = ?";
      params.push(query.data.branch_id);
    }

    const spaces = db.prepare(`
      SELECT s.*, 
      b.name as branch_name, b.code as branch_code,
      cl.id as client_id, cl.name as client_name, cl.rut as client_rut, cl.financial_status,
      (SELECT access_type FROM access_logs WHERE space_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_access_type,
      (SELECT timestamp FROM access_logs WHERE space_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_access_time,
      (SELECT plate FROM access_logs WHERE space_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_access_plate
      FROM spaces s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN contracts c ON s.id = c.space_id AND c.status = 'active'
      LEFT JOIN clients cl ON c.client_id = cl.id
      ${where}
      ORDER BY b.name ASC, s.name ASC
    `).all(...params) as any[];

    const formattedSpaces = spaces.map(s => {
      const { client_rut, financial_status, ...safeSpace } = s;
      return {
        ...safeSpace,
        ...(isLimitedOperationalRole(currentUser?.role) ? {} : { client_rut, financial_status }),
        assigned_client: assignedClientForRole(s, currentUser?.role),
        is_present: s.last_access_type === 'entry',
        entry_time: s.last_access_type === 'entry' ? s.last_access_time : null,
        current_plate: s.last_access_type === 'entry' ? s.last_access_plate : null
      };
    });

    res.json(formattedSpaces);
  });

  app.get("/api/spaces/:id/detail", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const currentUser = getCurrentUser(req);
    const space = db.prepare(`
      SELECT s.*,
             b.name as branch_name,
             b.code as branch_code,
             cl.id as client_id,
             cl.name as client_name,
             cl.rut as client_rut,
             cl.financial_status
      FROM spaces s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN contracts c ON s.id = c.space_id AND c.status = 'active'
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE s.id = ?
    `).get(req.params.id) as any | undefined;
    if (!space) return res.status(404).json({ error: "Espacio no encontrado" });

    const access = db.prepare(`
      SELECT a.*, c.name as client_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
      FROM access_logs a
      LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN visitor_passes v ON v.id = a.visitor_id
      WHERE a.space_id = ?
      ORDER BY a.timestamp DESC
      LIMIT 30
    `).all(req.params.id);

    const history = db.prepare(`
      SELECT h.*, s.name as staff_name, s.email as staff_email
      FROM space_status_history h
      LEFT JOIN staff s ON s.id = h.staff_id
      WHERE h.space_id = ?
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 30
    `).all(req.params.id);

    const { client_rut, financial_status, ...safeSpace } = space;

    res.json({
      space: {
        ...safeSpace,
        ...(isLimitedOperationalRole(currentUser?.role) ? {} : { client_rut, financial_status }),
        assigned_client: assignedClientForRole(space, currentUser?.role),
      },
      access,
      history,
    });
  });

  app.post("/api/spaces", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(createSpaceSchema, req.body, res);
    if (!body) return;

    const { name, type, status, price, location, level, width_m, length_m, height_m, features, notes } = body;
    try {
      const branchId = getBranchOrDefault(body.branch_id || null);
      const result = db.prepare(`
        INSERT INTO spaces (name, type, status, price, location, level, width_m, length_m, height_m, features, notes, branch_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(name, type, status, price, location, level, width_m || null, length_m || null, height_m || null, features, notes, branchId);
      recordSpaceHistory(req, { spaceId: result.lastInsertRowid, status, reason: "Creacion de espacio", source: "created" });
      recordAuditEvent(req, {
        action: "space.created",
        entityType: "space",
        entityId: result.lastInsertRowid,
        metadata: { name, type, status, price, branch_id: branchId },
      });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/spaces/:id", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(updateSpaceSchema, req.body, res);
    if (!body) return;

    const current = db.prepare("SELECT * FROM spaces WHERE id = ?").get(req.params.id) as any | undefined;
    if (!current) return res.status(404).json({ error: "Espacio no encontrado" });

    if (Object.prototype.hasOwnProperty.call(body, "branch_id")) {
      try {
        getBranchOrDefault(body.branch_id || null);
      } catch (e: any) {
        return res.status(400).json({ error: e.message || "Sucursal invalida" });
      }
    }

    const fields = ["name", "type", "price", "location", "level", "width_m", "length_m", "height_m", "features", "notes", "branch_id"]
      .filter(field => Object.prototype.hasOwnProperty.call(body, field));
    if (fields.length === 0) return res.status(400).json({ error: "No hay campos validos para actualizar" });

    try {
      const sets = fields.map(field => `${field} = ?`).join(", ");
      const values = fields.map(field => (body as any)[field] ?? null);
      db.prepare(`UPDATE spaces SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, req.params.id);
      recordSpaceHistory(req, {
        spaceId: req.params.id,
        previousStatus: current.status,
        status: current.status,
        reason: body.reason,
        source: "profile_update",
      });
      recordAuditEvent(req, {
        action: "space.updated",
        entityType: "space",
        entityId: req.params.id,
        metadata: { fields, reason: body.reason },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar el espacio" });
    }
  });

  app.patch("/api/spaces/:id/status", requireAnyRole(["admin", "guard"]), (req, res) => {
    const body = parseBody(updateSpaceStatusSchema, req.body, res);
    if (!body) return;

    const { status, notes } = body;
    const current = db.prepare("SELECT status FROM spaces WHERE id = ?").get(req.params.id) as { status: string } | undefined;
    const result = db.prepare("UPDATE spaces SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").run(status, notes, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "Espacio no encontrado" });
    recordSpaceHistory(req, { spaceId: req.params.id, previousStatus: current?.status, status, reason: notes, source: "status_update" });

    recordAuditEvent(req, {
      action: "space.status_updated",
      entityType: "space",
      entityId: req.params.id,
      metadata: { status, reason: notes || null },
    });
    res.json({ success: true });
  });

  app.post("/api/spaces/:id/force-release", requireAnyRole(["admin", "guard"]), (req, res) => {
    const body = parseBody(forceReleaseSpaceSchema, req.body, res);
    if (!body) return;

    const spaceId = req.params.id;
    try {
      const transaction = db.transaction(() => {
        const current = db.prepare("SELECT status FROM spaces WHERE id = ?").get(spaceId) as { status: string } | undefined;
        const spaceUpdate = db.prepare("UPDATE spaces SET status = 'available', updated_at = datetime('now') WHERE id = ?").run(spaceId);
        if (spaceUpdate.changes === 0) throw new Error("Espacio no encontrado");
        recordSpaceHistory(req, { spaceId, previousStatus: current?.status, status: "available", reason: body.reason, source: "force_release" });

        const lastEntry = db.prepare("SELECT * FROM access_logs WHERE space_id = ? ORDER BY timestamp DESC LIMIT 1").get(spaceId) as any;

        if (lastEntry && lastEntry.access_type === 'entry') {
          const user = getCurrentUser(req);
          const releaseLog = db.prepare(`
            INSERT INTO access_logs (client_id, visitor_id, space_id, access_type, status, method, reason, plate) 
            VALUES (?, ?, ?, 'exit', 'authorized', 'manual', 'Liberación manual forzada', ?)
          `).run(lastEntry.client_id || null, lastEntry.visitor_id || null, spaceId, lastEntry.plate || 'FORZADA');
          db.prepare("UPDATE access_logs SET reason = ?, authorized_by = ? WHERE id = ?").run(body.reason, user?.name || null, releaseLog.lastInsertRowid);

          if (lastEntry.visitor_id) {
            db.prepare("UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ?").run(lastEntry.visitor_id);
          }
        }
      });
      transaction();
      recordAuditEvent(req, {
        action: "space.force_released",
        entityType: "space",
        entityId: spaceId,
        metadata: { reason: body.reason },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/spaces/:id/open-barrier", requireAnyRole(["admin", "guard"]), (req, res) => {
    const space = db.prepare("SELECT * FROM spaces WHERE id = ?").get(req.params.id) as any;
    if (!space) return res.status(404).json({ error: "Espacio no encontrado" });

    const contract = db.prepare("SELECT client_id FROM contracts WHERE space_id = ? AND status = 'active'").get(req.params.id) as any;

    if (contract) {
      db.prepare("INSERT INTO access_logs (client_id, space_id, access_type) VALUES (?, ?, ?)").run(contract.client_id, req.params.id, 'entry');
    }

    recordAuditEvent(req, {
      action: "space.manual_access_registered",
      entityType: "space",
      entityId: req.params.id,
      metadata: { client_id: contract?.client_id || null, device_action: "manual_protocol_no_remote_actuator" },
    });
    res.json({
      success: true,
      manual_only: true,
      message: `Apertura manual registrada para ${space.name}. Accione el acceso fisico segun protocolo operativo.`,
    });
  });
}
