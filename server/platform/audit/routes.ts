import type { Express } from "express";
import { getTenantIdFromRequest } from "../../tenant";
import {
  exportAuditEventsCsv,
  getAuditEventsSummary,
  listAuditEvents,
} from "./service";

export function registerAuditRoutes(app: Express) {
  app.get("/api/audit-events", async (req, res) => {
    const result = await listAuditEvents(req.query, await getTenantIdFromRequest(req));
    if (result.ok === false) return res.status(400).json({ error: result.error });
    res.json(result.events);
  });

  app.get("/api/audit-events/summary", async (req, res) => {
    const result = await getAuditEventsSummary(req.query, await getTenantIdFromRequest(req));
    if (result.ok === false) return res.status(400).json({ error: result.error });
    res.json(result.summary);
  });

  app.get("/api/audit-events/export.csv", async (req, res) => {
    const result = await exportAuditEventsCsv(req.query as Record<string, unknown>, await getTenantIdFromRequest(req));
    if (result.ok === false) return res.status(400).json({ error: result.error });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"auditoria.csv\"");
    res.send(result.csv);
  });
}
