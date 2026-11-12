import type { Express } from "express";
import { requireAnyRole } from "../../auth/sessions";
import { buildTenantContextPayload, exportTenantDataForRequest } from "./service";

export function registerTenantRoutes(app: Express) {
  app.get("/api/tenant/context", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const payload = await buildTenantContextPayload(req);
    if (!payload) return res.status(404).json({ error: "Tenant no configurado para el usuario actual" });
    res.json(payload);
  });

  app.get("/api/tenant/export", requireAnyRole(["admin"]), async (req, res) => {
    const exported = await exportTenantDataForRequest(req);
    if (!exported) return res.status(404).json({ error: "Tenant no configurado para el usuario actual" });

    if (req.query.format === "zip") {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="parkia-tenant-${exported.tenant.id}-export.zip"`,
      );
      return res.send(exported.zipBuffer);
    }

    res.json({
      tenant: exported.tenant,
      generated_at: exported.generated_at,
      counts: exported.counts,
      files: exported.files,
      zip_base64: exported.zipBuffer.toString("base64"),
    });
  });
}
