import type { Express } from "express";
import { allocateMovementSchema, markBankMovementPartialSchema, updateBankMovementSchema } from "../../../../shared/schemas/finance";
import { z } from "zod";
import { paginatedResponse, parsePagination, queryText } from "../../../pagination";
import { getTenantIdFromRequest } from "../../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../../validation";
import { parseBranchIdQuery } from "../shared";
import {
  allocateBankMovement,
  getBankMovementSuggestions,
  importBankMovements,
  listBankMovements,
  markBankMovementPartial,
  reconcileBankMovement,
  syncImportedBankMovements,
  updateBankMovement,
} from "./service";

const reconcileMovementSchema = z.object({
  payment_id: z.coerce.number().int().positive(),
  note: z.string().trim().min(3).max(500),
});


const importBankMovementsSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  dataBase64: z.string().trim().min(1),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
});


export function registerBankRoutes(app: Express) {
  app.get("/api/finance/bank-movements", async (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const month = queryText(req.query.month);
    const tenantId = await getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);

    const { movements, total } = await listBankMovements({
      tenantId,
      rawBranchId,
      status,
      month,
      search,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(movements, total, pagination) : movements);
  });

  app.get("/api/finance/bank-movements/:id/suggestions", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    const result = await getBankMovementSuggestions(req.params.id, tenantId);
    if (!result) return res.status(404).json({ error: "Movimiento bancario no encontrado" });
    res.json(result);
  });

  app.post("/api/finance/bank-movements/import", async (req, res) => {
    const body = parseBody(importBankMovementsSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      res.json(await importBankMovements(req, tenantId, body));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/finance/bank-movements/:id", async (req, res) => {
    const body = parseBody(updateBankMovementSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      await updateBankMovement(req, req.params.id, tenantId, body);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/mark-partial", async (req, res) => {
    const body = parseBody(markBankMovementPartialSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      await markBankMovementPartial(req, req.params.id, tenantId, body.note);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/allocate", async (req, res) => {
    const body = parseBody(allocateMovementSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await allocateBankMovement(req, req.params.id, tenantId, body);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/bank-movements/:id/reconcile", async (req, res) => {
    const body = parseBody(reconcileMovementSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const result = await reconcileBankMovement(req, req.params.id, tenantId, body);
      res.json({ success: true, folio: result.folio });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/finance/sync-bank", async (req, res) => {
    const tenantId = await getTenantIdFromRequest(req);
    res.json(await syncImportedBankMovements(req, tenantId));
  });
}

