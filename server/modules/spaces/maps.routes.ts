import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { optionalTextSchema, parseBody } from "../../validation";
import {
  createSpaceMapForRequest,
  deleteSpaceMapRegionForRequest,
  getSpaceMapDetailForRequest,
  getSpaceMapLiveForRequest,
  listSpaceMapsForRequest,
  resolveSpaceMapImageForRequest,
  saveSpaceMapRegionsForRequest,
  updateSpaceMapForRequest,
} from "./maps.service";

const viewRoles = ["admin", "finance", "guard", "cashier"] as const;

const branchQuerySchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
});

const imagePayloadSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  dataBase64: z.string().trim().min(1),
});

const createMapSchema = z.object({
  branch_id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  image: imagePayloadSchema,
  image_width: z.coerce.number().int().positive().max(20000),
  image_height: z.coerce.number().int().positive().max(20000),
  is_default: z.coerce.boolean().optional().default(false),
});

const updateMapSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
  is_default: z.coerce.boolean().optional(),
});

const pointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

const rectGeometrySchema = z
  .object({
    type: z.literal("rect"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0.001).max(1),
    height: z.number().min(0.001).max(1),
  })
  .refine((value) => value.x + value.width <= 1 && value.y + value.height <= 1, "Rectangulo fuera del mapa");

const polygonGeometrySchema = z.object({
  type: z.literal("polygon"),
  points: z.array(pointSchema).min(3).max(40),
});

const geometrySchema = z.discriminatedUnion("type", [rectGeometrySchema, polygonGeometrySchema]);

const saveRegionsSchema = z.object({
  regions: z
    .array(
      z.object({
        id: z.coerce.number().int().optional(),
        space_id: z.coerce.number().int().positive(),
        geometry: geometrySchema,
        label: optionalTextSchema,
        color: optionalTextSchema,
        sort_order: z.coerce.number().int().optional().default(0),
      }),
    )
    .max(1000),
});

function parsePositiveId(value: string | undefined) {
  const result = z.coerce.number().int().positive().safeParse(value);
  return result.success ? result.data : null;
}

export function registerSpaceMapRoutes(app: Express) {
  app.get("/api/space-maps", requireAnyRole([...viewRoles]), (req, res) => {
    const query = branchQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    try {
      res.json(listSpaceMapsForRequest(req, query.data.branch_id));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudieron cargar los mapas" });
    }
  });

  app.post("/api/space-maps", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(createMapSchema, req.body, res);
    if (!body) return;

    try {
      res.json(createSpaceMapForRequest(req, body));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo crear el mapa" });
    }
  });

  app.get("/api/space-maps/:id/image", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const resolved = resolveSpaceMapImageForRequest(req, mapId);
    if (resolved.status !== 200) return res.status(resolved.status).json({ error: resolved.error });

    res.type(resolved.mimeType);
    res.sendFile(resolved.absolutePath);
  });

  app.get("/api/space-maps/:id/live", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const payload = getSpaceMapLiveForRequest(req, mapId);
    if (!payload) return res.status(404).json({ error: "Mapa no encontrado" });
    res.json(payload);
  });

  app.get("/api/space-maps/:id", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const payload = getSpaceMapDetailForRequest(req, mapId);
    if (!payload) return res.status(404).json({ error: "Mapa no encontrado" });
    res.json(payload);
  });

  app.patch("/api/space-maps/:id", requireAnyRole(["admin"]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const body = parseBody(updateMapSchema, req.body, res);
    if (!body) return;

    try {
      const result = updateSpaceMapForRequest(req, mapId, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar el mapa" });
    }
  });

  app.put("/api/space-maps/:id/regions", requireAnyRole(["admin"]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const body = parseBody(saveRegionsSchema, req.body, res);
    if (!body) return;

    try {
      const result = saveSpaceMapRegionsForRequest(req, mapId, body.regions);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudieron guardar las regiones" });
    }
  });

  app.delete("/api/space-maps/:id/regions/:regionId", requireAnyRole(["admin"]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    const regionId = parsePositiveId(req.params.regionId);
    if (!mapId || !regionId) return res.status(400).json({ error: "Region invalida" });

    const result = deleteSpaceMapRegionForRequest(req, mapId, regionId);
    res.status(result.status).json(result.body);
  });
}

