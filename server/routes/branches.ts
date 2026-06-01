import type { Express } from "express";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { requireAnyRole } from "../auth/sessions";
import { db } from "../db";
import { optionalTextSchema, parseBody } from "../validation";

const branchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(30).transform(value => value.toUpperCase()),
  address: optionalTextSchema,
  commune: optionalTextSchema,
  city: optionalTextSchema,
  phone: optionalTextSchema,
  status: z.enum(["active", "inactive"]).default("active"),
});

const updateBranchSchema = branchSchema.partial().extend({
  reason: z.string().trim().min(3).max(500),
});

function getBranch(id: string | number) {
  return db.prepare("SELECT * FROM branches WHERE id = ?").get(id) as any | undefined;
}

export function registerBranchesRoutes(app: Express) {
  app.use("/api/branches", requireAnyRole(["admin", "finance", "guard", "cashier"]));

  app.get("/api/branches", (_req, res) => {
    const branches = db.prepare(`
      SELECT b.*,
             (SELECT COUNT(*) FROM spaces s WHERE s.branch_id = b.id) as spaces_count,
             (SELECT COUNT(*) FROM visitor_tickets vt WHERE vt.branch_id = b.id AND vt.status != 'completed') as active_tickets_count
      FROM branches b
      ORDER BY b.status ASC, b.name ASC
    `).all().map((branch: any) => ({
      ...branch,
      spaces_count: Number(branch.spaces_count || 0),
      active_tickets_count: Number(branch.active_tickets_count || 0),
    }));
    res.json(branches);
  });

  app.post("/api/branches", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(branchSchema, req.body, res);
    if (!body) return;

    try {
      const result = db.prepare(`
        INSERT INTO branches (name, code, address, commune, city, phone, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(body.name, body.code, body.address, body.commune, body.city, body.phone, body.status);

      recordAuditEvent(req, {
        action: "branch.created",
        entityType: "branch",
        entityId: result.lastInsertRowid,
        metadata: body,
      });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo crear la sucursal" });
    }
  });

  app.patch("/api/branches/:id", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(updateBranchSchema, req.body, res);
    if (!body) return;

    const current = getBranch(req.params.id);
    if (!current) return res.status(404).json({ error: "Sucursal no encontrada" });

    const fields = ["name", "code", "address", "commune", "city", "phone", "status"]
      .filter(field => Object.prototype.hasOwnProperty.call(body, field));
    if (fields.length === 0) return res.status(400).json({ error: "No hay campos validos para actualizar" });

    try {
      const sets = fields.map(field => `${field} = ?`).join(", ");
      const values = fields.map(field => (body as any)[field] ?? null);
      db.prepare(`UPDATE branches SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...values, req.params.id);

      recordAuditEvent(req, {
        action: "branch.updated",
        entityType: "branch",
        entityId: req.params.id,
        metadata: {
          fields,
          reason: body.reason,
          previous: current,
        },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar la sucursal" });
    }
  });
}
