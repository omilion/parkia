import type { Express } from "express";
import { existsSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { requireAnyRole } from "../auth/sessions";
import { getBranchOrDefault } from "../branches";
import { db } from "../db";
import { resolveStoredFile, storeSpaceMapImage } from "../storage";
import { getTenantIdFromRequest } from "../tenant";
import { optionalTextSchema, parseBody } from "../validation";

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

const rectGeometrySchema = z.object({
  type: z.literal("rect"),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.001).max(1),
  height: z.number().min(0.001).max(1),
}).refine(value => value.x + value.width <= 1 && value.y + value.height <= 1, "Rectangulo fuera del mapa");

const polygonGeometrySchema = z.object({
  type: z.literal("polygon"),
  points: z.array(pointSchema).min(3).max(40),
});

const geometrySchema = z.discriminatedUnion("type", [rectGeometrySchema, polygonGeometrySchema]);

const saveRegionsSchema = z.object({
  regions: z.array(z.object({
    id: z.coerce.number().int().optional(),
    space_id: z.coerce.number().int().positive(),
    geometry: geometrySchema,
    label: optionalTextSchema,
    color: optionalTextSchema,
    sort_order: z.coerce.number().int().optional().default(0),
  })).max(1000),
});

type SpaceMapRow = {
  id: number;
  tenant_id: number;
  branch_id: number;
  branch_name?: string | null;
  name: string;
  image_file_path: string;
  image_file_name: string;
  image_mime_type: string;
  image_width: number;
  image_height: number;
  status: "active" | "archived";
  is_default: number | boolean;
  created_at: string;
  updated_at: string;
};

type RegionRow = {
  id: number;
  map_id: number;
  space_id: number;
  space_name?: string | null;
  geometry_json: string;
  label?: string | null;
  color?: string | null;
  sort_order?: number | null;
};

function parsePositiveId(value: string | undefined) {
  const result = z.coerce.number().int().positive().safeParse(value);
  return result.success ? result.data : null;
}

function mapImageUrl(id: number) {
  return `/api/space-maps/${id}/image`;
}

function formatMap(row: SpaceMapRow) {
  return {
    id: row.id,
    branch_id: row.branch_id,
    branch_name: row.branch_name || null,
    name: row.name,
    image_url: mapImageUrl(row.id),
    image_file_name: row.image_file_name,
    image_mime_type: row.image_mime_type,
    image_width: row.image_width,
    image_height: row.image_height,
    status: row.status,
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseGeometry(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return { type: "polygon", points: [] };
  }
}

function formatRegion(row: RegionRow) {
  return {
    id: row.id,
    map_id: row.map_id,
    space_id: row.space_id,
    space_name: row.space_name || null,
    geometry: parseGeometry(row.geometry_json),
    label: row.label || row.space_name || null,
    color: row.color || null,
    sort_order: row.sort_order || 0,
  };
}

function getMapById(mapId: number, tenantId: number) {
  return db.prepare(`
    SELECT sm.*, b.name as branch_name
    FROM space_maps sm
    LEFT JOIN branches b ON b.id = sm.branch_id AND b.tenant_id = sm.tenant_id
    WHERE sm.id = ? AND sm.tenant_id = ?
  `).get(mapId, tenantId) as SpaceMapRow | undefined;
}

function getRegions(mapId: number, tenantId: number) {
  const rows = db.prepare(`
    SELECT r.*, s.name as space_name
    FROM space_map_regions r
    JOIN spaces s ON s.id = r.space_id AND s.tenant_id = r.tenant_id
    WHERE r.map_id = ? AND r.tenant_id = ?
    ORDER BY r.sort_order ASC, r.id ASC
  `).all(mapId, tenantId) as RegionRow[];
  return rows.map(formatRegion);
}

function getSpacesForBranch(tenantId: number, branchId?: number | null) {
  const params: Array<number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND s.branch_id = ?";
    params.push(branchId);
  }

  return db.prepare(`
    SELECT s.id, s.name, s.type, s.status, s.price, s.branch_id, b.name as branch_name, b.code as branch_code,
           s.location, s.level, s.width_m, s.length_m, s.height_m, s.features, s.notes, s.updated_at
    FROM spaces s
    LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
    WHERE s.type = 'parking' AND s.tenant_id = ?
      ${branchFilter}
    ORDER BY b.name ASC, s.name ASC
  `).all(...params);
}

function getListSummary(tenantId: number, branchId?: number | null) {
  const params: Array<number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND branch_id = ?";
    params.push(branchId);
  }

  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM spaces
    WHERE tenant_id = ? AND type = 'parking'
      ${branchFilter}
  `).get(...params) as { count: number };

  const mapped = db.prepare(`
    SELECT COUNT(DISTINCT r.space_id) as count
    FROM space_map_regions r
    JOIN space_maps sm ON sm.id = r.map_id AND sm.tenant_id = r.tenant_id
    WHERE r.tenant_id = ?
      AND sm.status = 'active'
      ${branchId ? "AND sm.branch_id = ?" : ""}
  `).get(...params) as { count: number };

  return {
    totalSpaces: Number(total.count || 0),
    mappedSpaces: Number(mapped.count || 0),
    unmappedSpaces: Math.max(0, Number(total.count || 0) - Number(mapped.count || 0)),
  };
}

function getLiveRegions(mapId: number, tenantId: number) {
  const rows = db.prepare(`
    SELECT r.*,
           s.name as space_name,
           s.status as space_status,
           s.updated_at as space_updated_at,
           c.id as contract_id,
           cl.name as client_name,
           vt.id as visitor_ticket_id,
           vt.plate as visitor_plate,
           vt.entry_time as visitor_entry_time,
           al.timestamp as last_access_time
    FROM space_map_regions r
    JOIN space_maps sm ON sm.id = r.map_id AND sm.tenant_id = r.tenant_id
    JOIN spaces s ON s.id = r.space_id AND s.tenant_id = r.tenant_id AND s.branch_id = sm.branch_id
    LEFT JOIN contracts c ON c.id = (
      SELECT id
      FROM contracts
      WHERE space_id = s.id
        AND tenant_id = r.tenant_id
        AND status = 'active'
      ORDER BY start_date DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN clients cl ON cl.id = c.client_id AND cl.tenant_id = r.tenant_id
    LEFT JOIN visitor_tickets vt ON vt.id = (
      SELECT id
      FROM visitor_tickets
      WHERE space_id = s.id
        AND tenant_id = r.tenant_id
        AND status IN ('active', 'paid')
        AND exit_time IS NULL
      ORDER BY entry_time DESC, id DESC
      LIMIT 1
    )
    LEFT JOIN access_logs al ON al.id = (
      SELECT id
      FROM access_logs
      WHERE space_id = s.id
        AND tenant_id = r.tenant_id
      ORDER BY timestamp DESC, id DESC
      LIMIT 1
    )
    WHERE r.map_id = ? AND r.tenant_id = ?
    ORDER BY r.sort_order ASC, r.id ASC
  `).all(mapId, tenantId) as Array<RegionRow & {
    space_status: string;
    space_updated_at?: string | null;
    contract_id?: number | null;
    client_name?: string | null;
    visitor_ticket_id?: number | null;
    visitor_plate?: string | null;
    visitor_entry_time?: string | null;
    last_access_time?: string | null;
  }>;

  return rows.map(row => {
    let status: "available" | "monthly" | "visitor" | "maintenance" | "unknown" = "unknown";
    if (row.space_status === "maintenance") status = "maintenance";
    else if (row.visitor_ticket_id) status = "visitor";
    else if (row.contract_id) status = "monthly";
    else if (row.space_status === "available") status = "available";

    return {
      ...formatRegion(row),
      status,
      client_name: row.client_name || null,
      contract_id: row.contract_id || null,
      visitor_ticket_id: row.visitor_ticket_id || null,
      plate: row.visitor_plate || null,
      entry_time: row.visitor_entry_time || null,
      last_access_time: row.last_access_time || row.space_updated_at || null,
    };
  });
}

function getMapSummary(map: SpaceMapRow, tenantId: number) {
  const live = getLiveRegions(map.id, tenantId);
  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM spaces
    WHERE tenant_id = ? AND branch_id = ? AND type = 'parking'
  `).get(tenantId, map.branch_id) as { count: number };

  const counts = live.reduce((acc, region) => {
    acc[region.status] = (acc[region.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalSpaces: Number(total.count || 0),
    mappedSpaces: live.length,
    unmappedSpaces: Math.max(0, Number(total.count || 0) - live.length),
    available: counts.available || 0,
    monthly: counts.monthly || 0,
    visitor: counts.visitor || 0,
    maintenance: counts.maintenance || 0,
    unknown: counts.unknown || 0,
  };
}

function ensureSpacesBelongToMapBranch(spaceIds: number[], map: SpaceMapRow, tenantId: number) {
  if (spaceIds.length === 0) return;

  const placeholders = spaceIds.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT id
    FROM spaces
    WHERE tenant_id = ?
      AND branch_id = ?
      AND type = 'parking'
      AND id IN (${placeholders})
  `).all(tenantId, map.branch_id, ...spaceIds) as { id: number }[];
  const validIds = new Set(rows.map(row => Number(row.id)));
  const invalid = spaceIds.filter(id => !validIds.has(id));
  if (invalid.length > 0) throw new Error("Region asociada a espacio inexistente o de otra sucursal");
}

export function registerSpaceMapRoutes(app: Express) {
  app.get("/api/space-maps", requireAnyRole([...viewRoles]), (req, res) => {
    const query = branchQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });

    try {
      const tenantId = getTenantIdFromRequest(req);
      const branchId = query.data.branch_id ? getBranchOrDefault(query.data.branch_id, tenantId) : null;
      const params: Array<number> = [tenantId];
      let branchFilter = "";
      if (branchId) {
        branchFilter = "AND sm.branch_id = ?";
        params.push(branchId);
      }

      const maps = db.prepare(`
        SELECT sm.*, b.name as branch_name
        FROM space_maps sm
        LEFT JOIN branches b ON b.id = sm.branch_id AND b.tenant_id = sm.tenant_id
        WHERE sm.tenant_id = ?
          ${branchFilter}
        ORDER BY sm.is_default DESC, b.name ASC, sm.name ASC
      `).all(...params) as SpaceMapRow[];

      res.json({
        maps: maps.map(formatMap),
        spaces: getSpacesForBranch(tenantId, branchId),
        summary: getListSummary(tenantId, branchId),
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudieron cargar los mapas" });
    }
  });

  app.post("/api/space-maps", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(createMapSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const branchId = getBranchOrDefault(body.branch_id, tenantId);
      const stored = storeSpaceMapImage(body.image);
      const currentCount = db.prepare("SELECT COUNT(*) as count FROM space_maps WHERE tenant_id = ? AND branch_id = ?").get(tenantId, branchId) as { count: number };
      const shouldBeDefault = body.is_default || Number(currentCount.count || 0) === 0;

      const create = db.transaction(() => {
        if (shouldBeDefault) {
          db.prepare("UPDATE space_maps SET is_default = 0, updated_at = datetime('now') WHERE tenant_id = ? AND branch_id = ?").run(tenantId, branchId);
        }
        return db.prepare(`
          INSERT INTO space_maps (
            tenant_id, branch_id, name, image_file_path, image_file_name, image_mime_type,
            image_width, image_height, status, is_default
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `).run(
          tenantId,
          branchId,
          body.name,
          stored.filePath,
          stored.fileName,
          stored.mimeType,
          body.image_width,
          body.image_height,
          shouldBeDefault ? 1 : 0
        );
      });

      const result = create();
      const map = getMapById(Number(result.lastInsertRowid), tenantId);
      recordAuditEvent(req, {
        action: "space_map.created",
        entityType: "space_map",
        entityId: result.lastInsertRowid,
        metadata: { branch_id: branchId, name: body.name, is_default: shouldBeDefault },
      });
      res.json({ success: true, map: map ? formatMap(map) : null });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo crear el mapa" });
    }
  });

  app.get("/api/space-maps/:id/image", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const tenantId = getTenantIdFromRequest(req);
    const map = getMapById(mapId, tenantId);
    if (!map) return res.status(404).json({ error: "Mapa no encontrado" });

    try {
      const absolutePath = resolveStoredFile(map.image_file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Imagen no encontrada" });
      res.type(map.image_mime_type);
      res.sendFile(absolutePath);
    } catch {
      res.status(404).json({ error: "Imagen no encontrada" });
    }
  });

  app.get("/api/space-maps/:id/live", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const tenantId = getTenantIdFromRequest(req);
    const map = getMapById(mapId, tenantId);
    if (!map) return res.status(404).json({ error: "Mapa no encontrado" });
    const live = getLiveRegions(map.id, tenantId);
    res.json({
      live,
      regions: live,
      summary: getMapSummary(map, tenantId),
      generated_at: new Date().toISOString(),
    });
  });

  app.get("/api/space-maps/:id", requireAnyRole([...viewRoles]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const tenantId = getTenantIdFromRequest(req);
    const map = getMapById(mapId, tenantId);
    if (!map) return res.status(404).json({ error: "Mapa no encontrado" });
    const live = getLiveRegions(map.id, tenantId);
    res.json({
      map: formatMap(map),
      regions: getRegions(map.id, tenantId),
      live,
      summary: getMapSummary(map, tenantId),
    });
  });

  app.patch("/api/space-maps/:id", requireAnyRole(["admin"]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    if (!mapId) return res.status(400).json({ error: "Mapa invalido" });

    const body = parseBody(updateMapSchema, req.body, res);
    if (!body) return;

    const fields = ["name", "status"].filter(field => Object.prototype.hasOwnProperty.call(body, field));
    if (fields.length === 0 && !Object.prototype.hasOwnProperty.call(body, "is_default")) {
      return res.status(400).json({ error: "No hay campos validos para actualizar" });
    }

    try {
      const tenantId = getTenantIdFromRequest(req);
      const current = getMapById(mapId, tenantId);
      if (!current) return res.status(404).json({ error: "Mapa no encontrado" });

      const update = db.transaction(() => {
        if (body.is_default === true) {
          db.prepare("UPDATE space_maps SET is_default = 0, updated_at = datetime('now') WHERE tenant_id = ? AND branch_id = ?").run(tenantId, current.branch_id);
        }

        const sets = fields.map(field => `${field} = ?`);
        const values = fields.map(field => (body as any)[field]);
        if (Object.prototype.hasOwnProperty.call(body, "is_default")) {
          sets.push("is_default = ?");
          values.push(body.is_default ? 1 : 0);
        }
        if (sets.length > 0) {
          sets.push("updated_at = datetime('now')");
          db.prepare(`UPDATE space_maps SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`).run(...values, mapId, tenantId);
        }
      });
      update();

      const map = getMapById(mapId, tenantId);
      recordAuditEvent(req, {
        action: "space_map.updated",
        entityType: "space_map",
        entityId: mapId,
        metadata: { fields: [...fields, ...(Object.prototype.hasOwnProperty.call(body, "is_default") ? ["is_default"] : [])] },
      });
      res.json({ success: true, map: map ? formatMap(map) : null });
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
      const tenantId = getTenantIdFromRequest(req);
      const map = getMapById(mapId, tenantId);
      if (!map) return res.status(404).json({ error: "Mapa no encontrado" });

      const spaceIds = body.regions.map(region => region.space_id);
      if (new Set(spaceIds).size !== spaceIds.length) {
        return res.status(400).json({ error: "No se puede asignar el mismo espacio dos veces en un mapa" });
      }
      ensureSpacesBelongToMapBranch(spaceIds, map, tenantId);

      const save = db.transaction(() => {
        db.prepare("DELETE FROM space_map_regions WHERE map_id = ? AND tenant_id = ?").run(map.id, tenantId);
        const insert = db.prepare(`
          INSERT INTO space_map_regions (tenant_id, map_id, space_id, geometry_json, label, color, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const [index, region] of body.regions.entries()) {
          insert.run(
            tenantId,
            map.id,
            region.space_id,
            JSON.stringify(region.geometry),
            region.label || null,
            region.color || null,
            region.sort_order ?? index
          );
        }
        db.prepare("UPDATE space_maps SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(map.id, tenantId);
      });
      save();

      recordAuditEvent(req, {
        action: "space_map.regions_saved",
        entityType: "space_map",
        entityId: map.id,
        metadata: { count: body.regions.length },
      });
      res.json({ success: true, regions: getRegions(map.id, tenantId), live: getLiveRegions(map.id, tenantId) });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudieron guardar las regiones" });
    }
  });

  app.delete("/api/space-maps/:id/regions/:regionId", requireAnyRole(["admin"]), (req, res) => {
    const mapId = parsePositiveId(req.params.id);
    const regionId = parsePositiveId(req.params.regionId);
    if (!mapId || !regionId) return res.status(400).json({ error: "Region invalida" });

    const tenantId = getTenantIdFromRequest(req);
    const map = getMapById(mapId, tenantId);
    if (!map) return res.status(404).json({ error: "Mapa no encontrado" });

    const result = db.prepare(`
      DELETE FROM space_map_regions
      WHERE id = ? AND map_id = ? AND tenant_id = ?
    `).run(regionId, map.id, tenantId);
    if (result.changes === 0) return res.status(404).json({ error: "Region no encontrada" });

    db.prepare("UPDATE space_maps SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(map.id, tenantId);
    recordAuditEvent(req, {
      action: "space_map.region_deleted",
      entityType: "space_map_region",
      entityId: regionId,
      metadata: { map_id: map.id },
    });
    res.json({ success: true });
  });
}
