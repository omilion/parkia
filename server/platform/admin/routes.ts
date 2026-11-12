import { generalSettingsSchema, integrationSettingsSchema } from '../../../shared/schemas/settings';
import type { Express } from "express";
import { statSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../../audit";
import { requireAnyRole } from "../../auth/sessions";
import { registerStaffRoutes } from "../../modules/staff/routes";
import { getTenantIdFromRequest, requirePlatformAdmin } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import { registerAuditRoutes } from "../audit/routes";
import {
  createDatabaseBackupForPlatform,
  getBackupPath,
  getConfigForTenant,
  importEndpointsByTemplateId,
  importTemplates,
  listDatabaseBackups,
  listTotemsForTenant,
  patchConfigForTenant,
  patchTotemMaintenanceForTenant,
  restoreDatabaseBackupForPlatform,
  toCsv,
} from "./service";

const updateTotemSchema = z.object({
  maintenance_mode: z.coerce.boolean(),
});

const updateConfigSchema = z.object({
  grace_days: z.coerce.number().pipe(generalSettingsSchema.shape.grace_days).optional(),
  late_interest: z.coerce.number().pipe(generalSettingsSchema.shape.late_interest).optional(),
  overdue_recovery_rate: z.coerce.number().pipe(generalSettingsSchema.shape.overdue_recovery_rate).optional(),
  company_name: optionalTextSchema,
  company_rut: optionalTextSchema,
  company_address: optionalTextSchema,
}).extend(integrationSettingsSchema.shape).partial();

const restoreDatabaseBackupSchema = z.object({
  confirm: z.string().trim().min(1),
});

export function registerAdminRoutes(app: Express) {
  app.use("/api/import/templates", requireAnyRole(["admin", "finance"]));
  app.use(["/api/config", "/api/totems", "/api/audit-events", "/api/backups"], requireAnyRole(["admin"]));
  // Los respaldos contienen la base completa (todos los tenants): solo plataforma.
  app.use("/api/backups", requirePlatformAdmin);

  registerStaffRoutes(app);
  registerAuditRoutes(app);

  app.get("/api/config", (req, res) => {
    res.json(getConfigForTenant(getTenantIdFromRequest(req)));
  });

  app.patch("/api/config", (req, res) => {
    const body = parseBody(updateConfigSchema, req.body, res);
    if (!body) return;

    const result = patchConfigForTenant(req, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.get("/api/totems", (req, res) => {
    res.json(listTotemsForTenant(getTenantIdFromRequest(req)));
  });

  app.patch("/api/totems/:id", (req, res) => {
    const body = parseBody(updateTotemSchema, req.body, res);
    if (!body) return;

    const result = patchTotemMaintenanceForTenant(req, req.params.id, Boolean(body.maintenance_mode));
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.get("/api/import/templates", (_req, res) => {
    res.json({
      templates: importTemplates.map(({ id, label, description, columns }) => ({
        id,
        label,
        description,
        columns,
        importSupported: Boolean(importEndpointsByTemplateId[id]),
        importEndpoint: importEndpointsByTemplateId[id] || null,
      })),
    });
  });

  app.get("/api/import/templates/:id.csv", (req, res) => {
    const template = importTemplates.find((item) => item.id === req.params.id);
    if (!template) return res.status(404).json({ error: "Plantilla no encontrada" });

    const csv = toCsv([template.columns, ...template.rows]);
    recordAuditEvent(req, {
      action: "import_template.downloaded",
      entityType: "import_template",
      entityId: template.id,
      metadata: { label: template.label },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${template.id}.csv"`);
    res.send(csv);
  });

  app.get("/api/backups/database", (_req, res) => {
    res.json({ backups: listDatabaseBackups() });
  });

  app.get("/api/backups/database/:fileName", (req, res, next) => {
    try {
      const backupPath = getBackupPath(req.params.fileName);
      statSync(backupPath);
      res.download(backupPath, req.params.fileName);
    } catch (error) {
      if (error instanceof Error && error.message.includes("respaldo inv")) {
        return res.status(400).json({ error: error.message });
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return res.status(404).json({ error: "Respaldo no encontrado" });
      }
      next(error);
    }
  });

  app.post("/api/backups/database", async (req, res, next) => {
    try {
      const backup = await createDatabaseBackupForPlatform(req);
      res.json({
        success: true,
        backup,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/backups/database/:fileName/restore", async (req, res, next) => {
    const body = parseBody(restoreDatabaseBackupSchema, req.body, res);
    if (!body) return;

    try {
      const result = await restoreDatabaseBackupForPlatform(req, req.params.fileName, body.confirm!);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({
        success: true,
        restored: result.restored,
        safetyBackup: result.safetyBackup,
        restartRecommended: result.restartRecommended,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("respaldo inv")) {
        return res.status(400).json({ error: error.message });
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return res.status(404).json({ error: "Respaldo no encontrado" });
      }
      next(error);
    }
  });
}
