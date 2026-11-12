import { existsSync } from "fs";
import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getBranchOrDefault } from "../../branches";
import { resolveStoredFile, storeSpaceMapImage } from "../../storage";
import { getTenantIdFromRequest } from "../../tenant";
import {
  countSpaceMapsInBranch,
  countTotalParkingSpacesInBranch,
  deleteSpaceMapRegionById,
  findSpaceMapById,
  insertSpaceMapInTx,
  queryLiveSpaceMapRegionRows,
  queryMapListSummaryCounts,
  querySpaceMapRegions,
  querySpaceMapsForTenant,
  querySpacesForBranchMap,
  queryValidSpaceIdsInBranch,
  replaceSpaceMapRegionsInTx,
  updateSpaceMapInTx,
  type RegionRow,
  type SpaceMapRow,
} from "./maps.repo";

function mapImageUrl(id: number) {
  return `/api/space-maps/${id}/image`;
}

export function formatMap(row: SpaceMapRow) {
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

export function formatRegion(row: RegionRow) {
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

export async function getRegions(mapId: number, tenantId: number) {
  return (await querySpaceMapRegions(mapId, tenantId)).map(formatRegion);
}

export async function getLiveRegions(mapId: number, tenantId: number) {
  const rows = await queryLiveSpaceMapRegionRows(mapId, tenantId);
  return rows.map((row) => {
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

export async function getMapSummary(map: SpaceMapRow, tenantId: number) {
  const live = await getLiveRegions(map.id, tenantId);
  const totalSpaces = await countTotalParkingSpacesInBranch(tenantId, map.branch_id);

  const counts = live.reduce(
    (acc, region) => {
      acc[region.status] = (acc[region.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    totalSpaces,
    mappedSpaces: live.length,
    unmappedSpaces: Math.max(0, totalSpaces - live.length),
    available: counts.available || 0,
    monthly: counts.monthly || 0,
    visitor: counts.visitor || 0,
    maintenance: counts.maintenance || 0,
    unknown: counts.unknown || 0,
  };
}

async function ensureSpacesBelongToMapBranch(spaceIds: number[], map: SpaceMapRow, tenantId: number) {
  if (spaceIds.length === 0) return;
  const validIds = await queryValidSpaceIdsInBranch(tenantId, map.branch_id, spaceIds);
  const invalid = spaceIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) throw new Error("Region asociada a espacio inexistente o de otra sucursal");
}

export async function listSpaceMapsForRequest(req: Request, branchIdParam?: number) {
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = branchIdParam ? await getBranchOrDefault(branchIdParam, tenantId) : null;
  const maps = await querySpaceMapsForTenant(tenantId, branchId);

  return {
    maps: maps.map(formatMap),
    spaces: await querySpacesForBranchMap(tenantId, branchId),
    summary: await queryMapListSummaryCounts(tenantId, branchId),
  };
}

export async function createSpaceMapForRequest(
  req: Request,
  body: {
    branch_id: number;
    name: string;
    image: { fileName: string; mimeType: "image/jpeg" | "image/png"; dataBase64: string };
    image_width: number;
    image_height: number;
    is_default?: boolean;
  },
) {
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = await getBranchOrDefault(body.branch_id, tenantId);
  const stored = storeSpaceMapImage({ ...body.image, tenantId });
  const currentCount = await countSpaceMapsInBranch(tenantId, branchId);
  const shouldBeDefault = Boolean(body.is_default) || currentCount === 0;

  const mapId = await insertSpaceMapInTx({
    tenantId,
    branchId,
    name: body.name,
    filePath: stored.filePath,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    imageWidth: body.image_width,
    imageHeight: body.image_height,
    shouldBeDefault,
  });

  const map = await findSpaceMapById(mapId, tenantId);
  await recordAuditEvent(req, {
    action: "space_map.created",
    entityType: "space_map",
    entityId: mapId,
    metadata: { branch_id: branchId, name: body.name, is_default: shouldBeDefault },
  });

  return { success: true as const, map: map ? formatMap(map) : null };
}

export async function resolveSpaceMapImageForRequest(req: Request, mapId: number) {
  const tenantId = await getTenantIdFromRequest(req);
  const map = await findSpaceMapById(mapId, tenantId);
  if (!map) return { status: 404 as const, error: "Mapa no encontrado" };

  try {
    const absolutePath = resolveStoredFile(map.image_file_path);
    if (!existsSync(absolutePath)) return { status: 404 as const, error: "Imagen no encontrada" };
    return { status: 200 as const, mimeType: map.image_mime_type, absolutePath };
  } catch {
    return { status: 404 as const, error: "Imagen no encontrada" };
  }
}

export async function getSpaceMapLiveForRequest(req: Request, mapId: number) {
  const tenantId = await getTenantIdFromRequest(req);
  const map = await findSpaceMapById(mapId, tenantId);
  if (!map) return null;
  const live = await getLiveRegions(map.id, tenantId);
  return {
    live,
    regions: live,
    summary: await getMapSummary(map, tenantId),
    generated_at: new Date().toISOString(),
  };
}

export async function getSpaceMapDetailForRequest(req: Request, mapId: number) {
  const tenantId = await getTenantIdFromRequest(req);
  const map = await findSpaceMapById(mapId, tenantId);
  if (!map) return null;
  const live = await getLiveRegions(map.id, tenantId);
  return {
    map: formatMap(map),
    regions: await getRegions(map.id, tenantId),
    live,
    summary: await getMapSummary(map, tenantId),
  };
}

export async function updateSpaceMapForRequest(
  req: Request,
  mapId: number,
  body: { name?: string; status?: "active" | "archived"; is_default?: boolean },
) {
  const fields = ["name", "status"].filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  const hasIsDefault = Object.prototype.hasOwnProperty.call(body, "is_default");
  if (fields.length === 0 && !hasIsDefault) {
    return { status: 400 as const, body: { error: "No hay campos validos para actualizar" } };
  }

  const tenantId = await getTenantIdFromRequest(req);
  const current = await findSpaceMapById(mapId, tenantId);
  if (!current) return { status: 404 as const, body: { error: "Mapa no encontrado" } };

  await updateSpaceMapInTx({
    mapId,
    tenantId,
    branchId: current.branch_id,
    fields,
    values: fields.map((field) => (body as Record<string, unknown>)[field]),
    hasIsDefault,
    isDefaultValue: body.is_default,
  });

  const map = await findSpaceMapById(mapId, tenantId);
  await recordAuditEvent(req, {
    action: "space_map.updated",
    entityType: "space_map",
    entityId: mapId,
    metadata: { fields: [...fields, ...(hasIsDefault ? ["is_default"] : [])] },
  });

  return { status: 200 as const, body: { success: true as const, map: map ? formatMap(map) : null } };
}

export async function saveSpaceMapRegionsForRequest(
  req: Request,
  mapId: number,
  regions: Array<{
    id?: number;
    space_id: number;
    geometry?: unknown;
    label?: string | null;
    color?: string | null;
    sort_order?: number;
  }>,
) {
  const tenantId = await getTenantIdFromRequest(req);
  const map = await findSpaceMapById(mapId, tenantId);
  if (!map) return { status: 404 as const, body: { error: "Mapa no encontrado" } };

  const spaceIds = regions.map((region) => region.space_id);
  if (new Set(spaceIds).size !== spaceIds.length) {
    return { status: 400 as const, body: { error: "No se puede asignar el mismo espacio dos veces en un mapa" } };
  }

  await ensureSpacesBelongToMapBranch(spaceIds, map, tenantId);
  await replaceSpaceMapRegionsInTx({ tenantId, mapId: map.id, regions });

  await recordAuditEvent(req, {
    action: "space_map.regions_saved",
    entityType: "space_map",
    entityId: map.id,
    metadata: { count: regions.length },
  });

  return {
    status: 200 as const,
    body: {
      success: true as const,
      regions: await getRegions(map.id, tenantId),
      live: await getLiveRegions(map.id, tenantId),
    },
  };
}

export async function deleteSpaceMapRegionForRequest(req: Request, mapId: number, regionId: number) {
  const tenantId = await getTenantIdFromRequest(req);
  const map = await findSpaceMapById(mapId, tenantId);
  if (!map) return { status: 404 as const, body: { error: "Mapa no encontrado" } };

  const changes = await deleteSpaceMapRegionById(regionId, map.id, tenantId);
  if (changes === 0) return { status: 404 as const, body: { error: "Region no encontrada" } };

  await recordAuditEvent(req, {
    action: "space_map.region_deleted",
    entityType: "space_map_region",
    entityId: regionId,
    metadata: { map_id: map.id },
  });

  return { status: 200 as const, body: { success: true as const } };
}
