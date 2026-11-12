import type { Express, Request, Response } from "express";
import { z } from "zod";
import { cafUploadSchema, certificateUploadSchema, certificationEnvironmentSchema, certificationSetSchema, dteSettingsSchema, goLiveSchema } from "../../../shared/schemas/dte";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { recordAuditEvent } from "../../audit";
import { getTenantIdFromRequest } from "../../tenant";
import { parseBody } from "../../validation";
import { dteService } from "./instance";
import { renderDocumentHtml } from "./print";
import { CafError } from "./providers/sii/caf";
import { CertificateError } from "./providers/sii/cert";
import { SiiError } from "./providers/sii/errors";
import { DteServiceError } from "./service";

/**
 * API del modulo de facturacion electronica.
 * La empresa siempre sale de la sesion; ningun parametro permite leer datos de otra.
 * Ninguna respuesta incluye el certificado, su clave ni el contenido de un CAF.
 */

function fail(res: Response, error: unknown) {
  if (error instanceof DteServiceError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof CertificateError) return res.status(400).json({ error: error.message, code: error.code });
  if (error instanceof CafError) return res.status(400).json({ error: error.message, code: "CAF_INVALID" });
  if (error instanceof SiiError) return res.status(502).json({ error: error.message, code: error.code });
  const message = error instanceof Error ? error.message : "Error inesperado";
  return res.status(500).json({ error: message });
}

const documentsQuerySchema = z.object({
  status: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const printQuerySchema = z.object({ format: z.enum(["thermal", "letter"]).default("thermal") });

export function registerDteRoutes(app: Express) {
  const admin = requireAnyRole(["admin"]);
  const reader = requireAnyRole(["admin", "finance"]);
  const printer = requireAnyRole(["admin", "finance", "cashier", "guard"]);
  const staffId = async (req: Request) => (await getCurrentUser(req))?.id ?? null;

  app.get("/api/dte/onboarding", admin, async (req, res) => {
    try {
      res.json(await dteService.getOnboarding(await getTenantIdFromRequest(req)));
    } catch (error) { fail(res, error); }
  });

  app.put("/api/dte/settings", admin, async (req, res) => {
    const body = parseBody(dteSettingsSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      await dteService.saveSettings(tenantId, body, await staffId(req));
      await recordAuditEvent(req, { action: "dte.settings_saved", entityType: "dte_settings", entityId: tenantId, metadata: { rut_emisor: body.rut_emisor } });
      res.json(await dteService.getOnboarding(tenantId));
    } catch (error) { fail(res, error); }
  });

  app.put("/api/dte/certification-environment", admin, async (req, res) => {
    const body = parseBody(certificationEnvironmentSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      await dteService.saveCertificationEnvironment(tenantId, body);
      res.json(await dteService.getOnboarding(tenantId));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/certificate", admin, async (req, res) => {
    const body = parseBody(certificateUploadSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await dteService.uploadCertificate(tenantId, body, await staffId(req));
      await recordAuditEvent(req, { action: "dte.certificate_uploaded", entityType: "dte_certificate", entityId: tenantId, metadata: { subject: result.certificate?.subjectName, validTo: result.certificate?.validTo } });
      res.json({ ...result, onboarding: await dteService.getOnboarding(tenantId) });
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/dte/certificate", admin, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      await dteService.removeCertificate(tenantId, await staffId(req));
      await recordAuditEvent(req, { action: "dte.certificate_removed", entityType: "dte_certificate", entityId: tenantId });
      res.json(await dteService.getOnboarding(tenantId));
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/caf", admin, async (req, res) => {
    const body = parseBody(cafUploadSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const caf = await dteService.uploadCaf(tenantId, body, await staffId(req));
      await recordAuditEvent(req, { action: "dte.caf_uploaded", entityType: "dte_caf", entityId: tenantId, metadata: caf });
      res.json({ caf, onboarding: await dteService.getOnboarding(tenantId) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/test-connection", admin, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await dteService.testConnection(tenantId);
      await recordAuditEvent(req, { action: "dte.connection_tested", entityType: "dte_settings", entityId: tenantId, metadata: { ok: result.ok } });
      res.json({ ...result, onboarding: await dteService.getOnboarding(tenantId) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/certification-set", admin, async (req, res) => {
    const body = parseBody(certificationSetSchema, req.body ?? {}, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const documents = await dteService.generateCertificationSet(tenantId, body.cases, await staffId(req));
      await recordAuditEvent(req, { action: "dte.certification_set_generated", entityType: "dte_settings", entityId: tenantId, metadata: { documents: documents.length } });
      const sent = await dteService.sendPending({ tenantId });
      res.json({ generated: documents.length, sent, onboarding: await dteService.getOnboarding(tenantId) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/send-now", admin, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const sent = await dteService.sendPending({ tenantId });
      const polled = await dteService.pollStatuses({ tenantId });
      res.json({ sent, polled, onboarding: await dteService.getOnboarding(tenantId) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/dte/go-live", admin, async (req, res) => {
    const body = parseBody(goLiveSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      await dteService.goLive(tenantId, body, await staffId(req));
      await recordAuditEvent(req, { action: "dte.went_live", entityType: "dte_settings", entityId: tenantId, metadata: { resolucion: body.resolucion_numero, fecha: body.resolucion_fecha } });
      res.json(await dteService.getOnboarding(tenantId));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/dte/documents", reader, async (req, res) => {
    const query = documentsQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros invalidos" });
    try {
      res.json(await dteService.listDocuments(await getTenantIdFromRequest(req), query.data));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/dte/documents/:id", reader, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const id = Number(req.params.id);
      const document = Number.isInteger(id) ? await dteService.getDocument(tenantId, id) : undefined;
      if (!document) return res.status(404).json({ error: "Documento no encontrado" });
      const { dte_xml: _xml, ted_xml: _ted, ...safe } = document;
      res.json({ document: safe, events: await dteService.documentEvents(tenantId, id) });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/dte/documents/:id/print", printer, async (req, res) => {
    const query = printQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Formato invalido" });
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const id = Number(req.params.id);
      const document = Number.isInteger(id) ? await dteService.getDocument(tenantId, id) : undefined;
      if (!document) return res.status(404).json({ error: "Documento no encontrado" });
      res.type("html").send(renderDocumentHtml({ settings: await dteService.getSettings(tenantId), document, format: query.data.format }));
    } catch (error) { fail(res, error); }
  });

  app.get("/api/dte/documents/:id/xml", admin, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const id = Number(req.params.id);
      const document = Number.isInteger(id) ? await dteService.getDocument(tenantId, id) : undefined;
      if (!document?.dte_xml) return res.status(404).json({ error: "Documento no encontrado" });
      res.setHeader("Content-Disposition", `attachment; filename="DTE-${document.dte_type}-${document.folio}.xml"`);
      res.type("application/xml").send(document.dte_xml);
    } catch (error) { fail(res, error); }
  });
}
