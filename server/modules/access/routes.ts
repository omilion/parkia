import type { Express } from "express";
import { accessOverrideSchema, closeShiftLogSchema, totemScanSchema, createShiftLogEntrySchema, createShiftLogSchema, updateAccessRateSchema } from "../../../shared/schemas/access";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { sendPlanLimitError } from "../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../validation";
import {
  buildShiftFollowUpsCsvRowsForRequest,
  buildShiftLogExportCsvRowsForRequest,
  closeShiftLogForRequest,
  createAccessLogForRequest,
  createShiftLogEntryForRequest,
  getCurrentShiftLogForRequest,
  getShiftLogDetailForRequest,
  listAccessRatesForRequest,
  listAuditAccessLogsForRequest,
  listLiveAccessLogsForRequest,
  listShiftFollowUpsForRequest,
  listShiftLogsForRequest,
  openOrReuseShiftLogForRequest,
  performManualAccessOverrideForRequest,
  processTotemScanForRequest,
  resolveShiftLogEntryAttachmentDownload,
  resolveShiftLogEntryForRequest,
  updateAccessRateForRequest,
} from "./service";

const createAccessLogSchema = z.object({
  client_id: z.coerce.number().int().positive().nullable().optional(),
  visitor_id: z.coerce.number().int().positive().nullable().optional(),
  space_id: z.coerce.number().int().positive().nullable().optional(),
  access_type: z.enum(["entry", "exit"]),
  status: z.enum(["authorized", "denied"]).default("authorized"),
  method: z.enum(["fingerprint", "card", "qr", "manual"]).default("qr"),
  reason: optionalTextSchema,
  authorized_by: optionalTextSchema,
  branch_id: z.coerce.number().int().positive().optional().nullable(),
});


const shiftLogQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("open"),
  date: dateStringSchema.optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});

const shiftFollowUpQuerySchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
  branch_id: z.coerce.number().int().positive().optional(),
});

const resolveShiftLogEntrySchema = z.object({
  resolved: z.coerce.boolean().default(true),
});

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res: any, fileName: string, rows: unknown[][]) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(rows.map((row) => row.map(escapeCsv).join(",")).join("\n"));
}

export function registerAccessRoutes(app: Express) {
  app.use(["/api/access", "/api/totems/scan"], requireAnyRole(["admin", "guard"]));

  app.post("/api/access", (req, res) => {
    const body = parseBody(createAccessLogSchema, req.body, res);
    if (!body) return;

    const result = createAccessLogForRequest(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/totems/scan", (req, res) => {
    const body = parseBody(totemScanSchema, req.body, res);
    if (!body) return;

    try {
      const result = processTotemScanForRequest(req, body.plate);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/access/live", (req, res) => {
    res.json(listLiveAccessLogsForRequest(req));
  });

  app.get("/api/access/audit", (req, res) => {
    const result = listAuditAccessLogsForRequest(req);
    res.status(result.status).json(result.body);
  });

  app.get("/api/access/shift-logs", (req, res) => {
    const query = shiftLogQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de bitácora inválidos" });

    res.json(listShiftLogsForRequest(req, query.data));
  });

  app.get("/api/access/shift-logs/current", (req, res) => {
    res.json(getCurrentShiftLogForRequest(req));
  });

  app.get("/api/access/shift-log-follow-ups", (req, res) => {
    const query = shiftFollowUpQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de seguimientos inválidos" });

    res.json(listShiftFollowUpsForRequest(req, query.data));
  });

  app.get("/api/access/export/shift-log-follow-ups.csv", (req, res) => {
    const query = shiftFollowUpQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de seguimientos inválidos" });

    sendCsv(
      res,
      `seguimientos-bitacora-${query.data.status}.csv`,
      buildShiftFollowUpsCsvRowsForRequest(req, query.data),
    );
  });

  app.get("/api/access/shift-logs/:id", (req, res) => {
    const detail = getShiftLogDetailForRequest(req, req.params.id);
    if (!detail) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    res.json(detail);
  });

  app.get("/api/access/shift-logs/:id/export.csv", (req, res) => {
    const exported = buildShiftLogExportCsvRowsForRequest(req, req.params.id);
    if (!exported) return res.status(404).json({ error: "Bitácora de turno no encontrada" });
    sendCsv(res, `bitacora-turno-${exported.logId}.csv`, exported.rows);
  });

  app.post("/api/access/shift-logs", (req, res) => {
    const body = parseBody(createShiftLogSchema, req.body, res);
    if (!body) return;

    res.json(openOrReuseShiftLogForRequest(req, body));
  });

  app.post("/api/access/shift-logs/:id/entries", (req, res) => {
    const body = parseBody(createShiftLogEntrySchema, req.body, res);
    if (!body) return;

    const result = createShiftLogEntryForRequest(req, req.params.id, body);
    res.status(result.status).json(result.body);
  });

  app.get("/api/access/shift-log-entries/:entryId/attachments/:attachmentId/download", (req, res) => {
    const resolved = resolveShiftLogEntryAttachmentDownload(req, req.params.entryId, req.params.attachmentId);
    if (resolved.status !== 200) return res.status(resolved.status).json({ error: resolved.error });
    res.type(resolved.mimeType);
    res.download(resolved.absolutePath, resolved.fileName);
  });

  app.patch("/api/access/shift-log-entries/:id/resolve", (req, res) => {
    const body = parseBody(resolveShiftLogEntrySchema, req.body, res);
    if (!body) return;

    const result = resolveShiftLogEntryForRequest(req, req.params.id, body.resolved);
    res.status(result.status).json(result.body);
  });

  app.patch("/api/access/shift-logs/:id/close", (req, res) => {
    const body = parseBody(closeShiftLogSchema, req.body, res);
    if (!body) return;

    try {
      const result = closeShiftLogForRequest(req, req.params.id, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo cerrar el turno" });
    }
  });

  app.post("/api/access/override", (req, res) => {
    const body = parseBody(accessOverrideSchema, req.body, res);
    if (!body) return;

    try {
      res.json(performManualAccessOverrideForRequest(req, body));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo registrar la apertura manual" });
    }
  });

  app.get("/api/access/rates", (req, res) => {
    res.json(listAccessRatesForRequest(req));
  });

  app.patch("/api/access/rates/:id", (req, res) => {
    const body = parseBody(updateAccessRateSchema, req.body, res);
    if (!body) return;

    const result = updateAccessRateForRequest(req, req.params.id, body);
    res.status(result.status).json(result.body);
  });
}

