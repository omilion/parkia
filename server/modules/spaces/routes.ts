import type { Express } from "express";
import { createSpaceSchema, updateSpaceSchema } from "../../../shared/schemas/spaces";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { sendPlanLimitError } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import {
  createSpaceForRequest,
  forceReleaseSpaceForRequest,
  getSpaceDetailForRequest,
  listAvailableSpacesForRequest,
  listSpacesForRequest,
  openSpaceBarrierManuallyForRequest,
  updateSpaceForRequest,
  updateSpaceStatusForRequest,
} from "./service";

const updateSpaceStatusSchema = z.object({
  status: z.enum(["available", "occupied", "maintenance"]),
  notes: optionalTextSchema,
});

const forceReleaseSpaceSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const spacesQuerySchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
});

export function registerSpacesRoutes(app: Express) {
  app.get("/api/spaces/available", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const query = spacesQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    res.json(listAvailableSpacesForRequest(req, query.data.branch_id));
  });

  app.get("/api/spaces", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const query = spacesQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    res.json(listSpacesForRequest(req, query.data.branch_id));
  });

  app.get("/api/spaces/:id/detail", requireAnyRole(["admin", "finance", "guard", "cashier"]), (req, res) => {
    const detail = getSpaceDetailForRequest(req, req.params.id);
    if (!detail) return res.status(404).json({ error: "Espacio no encontrado" });
    res.json(detail);
  });

  app.post("/api/spaces", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(createSpaceSchema, req.body, res);
    if (!body) return;

    try {
      res.json(createSpaceForRequest(req, body));
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/spaces/:id", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(updateSpaceSchema, req.body, res);
    if (!body) return;

    try {
      const result = updateSpaceForRequest(req, req.params.id, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar el espacio" });
    }
  });

  app.patch("/api/spaces/:id/status", requireAnyRole(["admin", "guard"]), (req, res) => {
    const body = parseBody(updateSpaceStatusSchema, req.body, res);
    if (!body) return;

    const result = updateSpaceStatusForRequest(req, req.params.id, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/spaces/:id/force-release", requireAnyRole(["admin", "guard"]), (req, res) => {
    const body = parseBody(forceReleaseSpaceSchema, req.body, res);
    if (!body) return;

    try {
      res.json(forceReleaseSpaceForRequest(req, req.params.id, body.reason));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/spaces/:id/open-barrier", requireAnyRole(["admin", "guard"]), (req, res) => {
    const result = openSpaceBarrierManuallyForRequest(req, req.params.id);
    if (!result) return res.status(404).json({ error: "Espacio no encontrado" });
    res.json(result);
  });
}

