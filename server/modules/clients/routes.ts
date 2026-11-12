import { createClientSchema, upsertVehicleSchema } from '../../../shared/schemas/clients';
import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { paginatedResponse, parsePagination, queryText } from "../../pagination";
import { getTenantIdFromRequest } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import {
  archiveClientVehicle,
  changeClientStatus,
  createClient,
  getClientDetail,
  importClientsFromCsv,
  listClients,
  updateClient,
  upsertClientVehicle,
} from "./service";



const updateClientSchema = createClientSchema.omit({ plate: true }).partial();

const updateClientStatusSchema = z.object({
  status: z.enum(["active", "archived"]),
  reason: z.string().trim().min(3).max(500),
});

const archiveVehicleSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const importClientsSchema = z.object({
  csvText: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export function registerClientsRoutes(app: Express) {
  app.use("/api/clients", requireAnyRole(["admin", "finance"]));

  app.get("/api/clients", (req, res) => {
    const requestedStatus = queryText(req.query.status);
    const includeArchived = req.query.includeArchived === "true" || requestedStatus === "archived";
    const requestedType = queryText(req.query.type);
    const search = queryText(req.query.search);
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const tenantId = getTenantIdFromRequest(req);

    const { clients, total } = listClients({
      tenantId,
      includeArchived,
      requestedStatus,
      requestedType,
      search,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(clients, total, pagination) : clients);
  });

  app.get("/api/clients/:id", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const detail = getClientDetail(req.params.id, tenantId);
    if (!detail) return res.status(404).json({ error: "Client not found" });
    res.json(detail);
  });

  app.post("/api/clients", (req, res) => {
    const body = parseBody(createClientSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const id = createClient(req, tenantId, body);
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/clients/:id", (req, res) => {
    const body = parseBody(updateClientSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const result = updateClient(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/clients/:id/status", (req, res) => {
    const body = parseBody(updateClientStatusSchema, req.body, res);
    if (!body) return;

    const tenantId = getTenantIdFromRequest(req);
    const result = changeClientStatus(req, req.params.id, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.post("/api/clients/:id/vehicles", (req, res) => {
    const body = parseBody(upsertVehicleSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const result = upsertClientVehicle(req, req.params.id, tenantId, body);
      if (result.ok === false) return res.status(result.status).json({ error: result.error });
      if (result.reactivated) {
        return res.json({ success: true, id: result.id, reactivated: true });
      }
      res.json({ success: true, id: result.id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/clients/:id/vehicles/:vehicleId", (req, res) => {
    const parsed = archiveVehicleSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "Motivo de baja invalido" });

    const tenantId = getTenantIdFromRequest(req);
    const result = archiveClientVehicle(req, req.params.id, req.params.vehicleId, tenantId, parsed.data.reason);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.post("/api/clients/import", (req, res) => {
    const body = parseBody(importClientsSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const result = importClientsFromCsv(req, tenantId, body);
      if (result.ok === false) return res.status(result.status).json(result.payload);
      res.json(result.payload);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo importar clientes" });
    }
  });
}

