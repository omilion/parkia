import { contractTermsSchema, updateContractSchema } from '../../../shared/schemas/contracts';
import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { paginatedResponse, parsePagination, queryText } from "../../pagination";
import { getTenantIdFromRequest } from "../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../validation";
import {
  buildContractPdfDownload,
  createContract,
  generateAndStoreContractPdf,
  getContractDetail,
  listContracts,
  parseBranchIdQuery,
  reactivateContract,
  renewContract,
  renderPrintableContractHtml,
  suspendContract,
  terminateContract,
  updateContract,
} from "./service";

const renewContractSchema = z.object({
  new_end_date: dateStringSchema,
});

const contractStatusActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  effective_date: dateStringSchema.optional(),
});

const createContractSchema = z.object({
  client_id: z.coerce.number().pipe(contractTermsSchema.shape.client_id),
  space_id: z.coerce.number().pipe(contractTermsSchema.shape.space_id),
  start_date: dateStringSchema,
  end_date: optionalTextSchema,
  monthly_fee: z.coerce.number().pipe(contractTermsSchema.shape.monthly_fee),
  billing_day: z.coerce.number().int().min(1).max(31).default(5),
  deposit_amount: z.coerce.number().min(0).default(0),
  billing_document_type: z.enum(["boleta", "factura_exenta", "factura_afecta"]).default("boleta"),
  notes: optionalTextSchema,
});

export function registerContractsRoutes(app: Express) {
  app.use("/api/contracts", requireAnyRole(["admin", "finance"]));

  app.post("/api/contracts/:id/renew", async (req, res) => {
    const body = parseBody(renewContractSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await renewContract(req, req.params.id, tenantId, body.new_end_date);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, receivables: result.receivables });
  });

  app.post("/api/contracts/:id/suspend", async (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await suspendContract(req, req.params.id, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.post("/api/contracts/:id/reactivate", async (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await reactivateContract(req, req.params.id, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.post("/api/contracts/:id/terminate", async (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await terminateContract(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, receivables: result.receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo terminar el contrato" });
    }
  });

  app.get("/api/contracts", async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const expiring = req.query.expiring === "true";
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);

    const { contracts, total } = await listContracts({
      tenantId,
      rawBranchId,
      status,
      expiring,
      search,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(contracts, total, pagination) : contracts);
  });

  app.get("/api/contracts/:id/detail", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const detail = await getContractDetail(req.params.id, tenantId);
    if (!detail) return res.status(404).json({ error: "Contrato no encontrado" });
    res.json(detail);
  });

  app.patch("/api/contracts/:id", async (req, res) => {
    const body = parseBody(updateContractSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await updateContract(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true, changes: result.changes, receivables: result.receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar el contrato" });
    }
  });

  app.get("/api/contracts/:id/print", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const html = await renderPrintableContractHtml(req, req.params.id, tenantId);
    if (!html) return res.status(404).json({ error: "Contrato no encontrado" });
    res.type("html").send(html);
  });

  app.get("/api/contracts/:id/pdf", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const download = await buildContractPdfDownload(req, req.params.id, tenantId);
    if (!download) return res.status(404).json({ error: "Contrato no encontrado" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${download.fileName}"`);
    res.send(download.buffer);
  });

  app.post("/api/contracts/:id/generate-pdf", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    try {
      const id = await generateAndStoreContractPdf(req, req.params.id, tenantId);
      if (id === null) return res.status(404).json({ error: "Contrato no encontrado" });
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo generar el PDF" });
    }
  });

  app.post("/api/contracts", async (req, res) => {
    const body = parseBody(createContractSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await createContract(req, tenantId, body);
      res.json({ success: true, id: result.id, receivables: result.receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}

