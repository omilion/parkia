import type { Express } from "express";
import { documentStatusSchema, documentTypeSchema, nullableDateSchema, uploadDocumentSchema } from "../../../shared/schemas/documents";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { parsePagination, queryText } from "../../pagination";
import { getTenantIdFromRequest } from "../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../validation";
import {
  getDocumentReview,
  listDocumentAssignees,
  listDocumentsForEntity,
  parseBranchIdQuery,
  resolveDocumentDownload,
  updateDocument,
  uploadEntityDocument,
} from "./service";

const entityTypeSchema = z.enum(["client", "contract", "payment"]);

const updateDocumentSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  document_type: documentTypeSchema.optional(),
  status: documentStatusSchema.optional(),
  expires_at: nullableDateSchema,
  notes: optionalTextSchema,
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  next_action_at: nullableDateSchema,
  rejection_reason: optionalTextSchema,
});

export function registerDocumentsRoutes(app: Express) {
  app.use("/api/documents", requireAnyRole(["admin", "finance"]));

  app.get("/api/documents/assignees", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    res.json(await listDocumentAssignees(tenantId));
  });

  app.get("/api/documents/review", async (req, res) => {
    const status = req.query.status ? documentStatusSchema.safeParse(req.query.status) : null;
    const documentType = req.query.type ? documentTypeSchema.safeParse(req.query.type) : null;
    if (status && !status.success) return res.status(400).json({ error: "Estado inválido" });
    if (documentType && !documentType.success) return res.status(400).json({ error: "Tipo inválido" });

    const scope = queryText(req.query.scope) === "all" ? "all" : "critical";
    const search = queryText(req.query.search);
    const tenantId = await getTenantIdFromRequest(req);
    const branchId = await parseBranchIdQuery(req.query.branch_id);
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);

    res.json(await getDocumentReview({
      tenantId,
      scope,
      status: status?.success ? status.data : null,
      documentType: documentType?.success ? documentType.data : null,
      search,
      branchId,
      pagination,
    }));
  });

  app.get("/api/documents/:id/download", async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Documento inválido" });

    const tenantId = await getTenantIdFromRequest(req);
    const result = await resolveDocumentDownload(id.data, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.type(result.mimeType);
    res.download(result.absolutePath, result.fileName);
  });

  app.get("/api/documents/:entityType/:entityId", async (req, res) => {
    const entityType = entityTypeSchema.safeParse(req.params.entityType);
    const entityId = z.coerce.number().int().positive().safeParse(req.params.entityId);
    if (!entityType.success || !entityId.success) return res.status(400).json({ error: "Entidad inválida" });

    const tenantId = await getTenantIdFromRequest(req);
    const documents = await listDocumentsForEntity(entityType.data, entityId.data, tenantId);
    if (!documents) return res.status(404).json({ error: "Entidad no encontrada" });

    res.json(documents);
  });

  app.post("/api/documents/:entityType/:entityId", async (req, res) => {
    const entityType = entityTypeSchema.safeParse(req.params.entityType);
    const entityId = z.coerce.number().int().positive().safeParse(req.params.entityId);
    if (!entityType.success || !entityId.success) return res.status(400).json({ error: "Entidad inválida" });

    const tenantId = await getTenantIdFromRequest(req);
    const listCheck = await listDocumentsForEntity(entityType.data, entityId.data, tenantId);
    if (!listCheck) return res.status(404).json({ error: "Entidad no encontrada" });

    const body = parseBody(uploadDocumentSchema, req.body, res);
    if (!body) return;

    try {
      const result = await uploadEntityDocument(req, entityType.data, entityId.data, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, id: result.id });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo guardar el documento" });
    }
  });

  app.patch("/api/documents/:id", async (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Documento inválido" });

    const tenantId = await getTenantIdFromRequest(req);
    const body = parseBody(updateDocumentSchema, req.body, res);
    if (!body) return;

    const result = await updateDocument(req, id.data, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.json({ success: true });
  });
}

