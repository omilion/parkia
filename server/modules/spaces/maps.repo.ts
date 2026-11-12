import { db } from "../../db";

export type SpaceMapRow = {
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

export type RegionRow = {
  id: number;
  map_id: number;
  space_id: number;
  space_name?: string | null;
  geometry_json: string;
  label?: string | null;
  color?: string | null;
  sort_order?: number | null;
};

export async function findSpaceMapById(mapId: number, tenantId: number): Promise<SpaceMapRow | undefined> {
  return await db.prepare(`
    SELECT sm.*, b.name as branch_name
    FROM space_maps sm
    LEFT JOIN branches b ON b.id = sm.branch_id AND b.tenant_id = sm.tenant_id
    WHERE sm.id = ? AND sm.tenant_id = ?
  `).get(mapId, tenantId) as SpaceMapRow | undefined;
}

export async function querySpaceMapRegions(mapId: number, tenantId: number): Promise<RegionRow[]> {
  return await db.prepare(`
    SELECT r.*, s.name as space_name
    FROM space_map_regions r
    JOIN spaces s ON s.id = r.space_id AND s.tenant_id = r.tenant_id
    WHERE r.map_id = ? AND r.tenant_id = ?
    ORDER BY r.sort_order ASC, r.id ASC
  `).all(mapId, tenantId) as RegionRow[];
}

export async function querySpacesForBranchMap(tenantId: number, branchId?: number | null) {
  const params: Array<number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND s.branch_id = ?";
    params.push(branchId);
  }

  return await db.prepare(`
    SELECT s.id, s.name, s.type, s.status, s.price, s.branch_id, b.name as branch_name, b.code as branch_code,
           s.location, s.level, s.width_m, s.length_m, s.height_m, s.features, s.notes, s.updated_at
    FROM spaces s
    LEFT JOIN branches b ON b.id = s.branch_id AND b.tenant_id = s.tenant_id
    WHERE s.type = 'parking' AND s.tenant_id = ?
      ${branchFilter}
    ORDER BY b.name ASC, s.name ASC
  `).all(...params);
}

export async function queryMapListSummaryCounts(tenantId: number, branchId?: number | null) {
  const params: Array<number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND branch_id = ?";
    params.push(branchId);
  }

  const total = await db.prepare(`
    SELECT COUNT(*) as count
    FROM spaces
    WHERE tenant_id = ? AND type = 'parking'
      ${branchFilter}
  `).get(...params) as { count: number };

  const mapped = await db.prepare(`
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

export async function queryLiveSpaceMapRegionRows(mapId: number, tenantId: number) {
  return await db.prepare(`
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
  `).all(mapId, tenantId) as Array<
    RegionRow & {
      space_status: string;
      space_updated_at?: string | null;
      contract_id?: number | null;
      client_name?: string | null;
      visitor_ticket_id?: number | null;
      visitor_plate?: string | null;
      visitor_entry_time?: string | null;
      last_access_time?: string | null;
    }
  >;
}

export async function countTotalParkingSpacesInBranch(tenantId: number, branchId: number): Promise<number> {
  const total = await db.prepare(`
    SELECT COUNT(*) as count
    FROM spaces
    WHERE tenant_id = ? AND branch_id = ? AND type = 'parking'
  `).get(tenantId, branchId) as { count: number };
  return Number(total.count || 0);
}

export async function queryValidSpaceIdsInBranch(
  tenantId: number,
  branchId: number,
  spaceIds: number[],
): Promise<Set<number>> {
  if (spaceIds.length === 0) return new Set();
  const placeholders = spaceIds.map(() => "?").join(", ");
  const rows = await db.prepare(`
    SELECT id
    FROM spaces
    WHERE tenant_id = ?
      AND branch_id = ?
      AND type = 'parking'
      AND id IN (${placeholders})
  `).all(tenantId, branchId, ...spaceIds) as { id: number }[];
  return new Set(rows.map((row) => Number(row.id)));
}

export async function querySpaceMapsForTenant(tenantId: number, branchId?: number | null): Promise<SpaceMapRow[]> {
  const params: Array<number> = [tenantId];
  let branchFilter = "";
  if (branchId) {
    branchFilter = "AND sm.branch_id = ?";
    params.push(branchId);
  }

  return await db.prepare(`
    SELECT sm.*, b.name as branch_name
    FROM space_maps sm
    LEFT JOIN branches b ON b.id = sm.branch_id AND b.tenant_id = sm.tenant_id
    WHERE sm.tenant_id = ?
      ${branchFilter}
    ORDER BY sm.is_default DESC, b.name ASC, sm.name ASC
  `).all(...params) as SpaceMapRow[];
}

export async function countSpaceMapsInBranch(tenantId: number, branchId: number): Promise<number> {
  const currentCount = await db
    .prepare("SELECT COUNT(*) as count FROM space_maps WHERE tenant_id = ? AND branch_id = ?")
    .get(tenantId, branchId) as { count: number };
  return Number(currentCount.count || 0);
}

export async function insertSpaceMapInTx(params: {
  tenantId: number;
  branchId: number;
  name: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  imageWidth: number;
  imageHeight: number;
  shouldBeDefault: boolean;
}): Promise<number> {
  const tx = db.transaction(async () => {
    if (params.shouldBeDefault) {
      await db.prepare("UPDATE space_maps SET is_default = 0, updated_at = datetime('now') WHERE tenant_id = ? AND branch_id = ?").run(
        params.tenantId,
        params.branchId,
      );
    }
    const result = await db.prepare(`
      INSERT INTO space_maps (
        tenant_id, branch_id, name, image_file_path, image_file_name, image_mime_type,
        image_width, image_height, status, is_default
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      params.tenantId,
      params.branchId,
      params.name,
      params.filePath,
      params.fileName,
      params.mimeType,
      params.imageWidth,
      params.imageHeight,
      params.shouldBeDefault ? 1 : 0,
    );
    return Number(result.lastInsertRowid);
  });
  return await tx();
}

export async function updateSpaceMapInTx(params: {
  mapId: number;
  tenantId: number;
  branchId: number;
  fields: string[];
  values: unknown[];
  hasIsDefault: boolean;
  isDefaultValue?: boolean;
}): Promise<void> {
  const tx = db.transaction(async () => {
    if (params.isDefaultValue === true) {
      await db.prepare("UPDATE space_maps SET is_default = 0, updated_at = datetime('now') WHERE tenant_id = ? AND branch_id = ?").run(
        params.tenantId,
        params.branchId,
      );
    }

    const sets = params.fields.map((field) => `${field} = ?`);
    const values = [...params.values];
    if (params.hasIsDefault) {
      sets.push("is_default = ?");
      values.push(params.isDefaultValue ? 1 : 0);
    }
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      await db.prepare(`UPDATE space_maps SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`).run(
        ...values,
        params.mapId,
        params.tenantId,
      );
    }
  });
  await tx();
}

export async function replaceSpaceMapRegionsInTx(params: {
  tenantId: number;
  mapId: number;
  regions: Array<{
    space_id: number;
    geometry?: unknown;
    label?: string | null;
    color?: string | null;
    sort_order?: number;
  }>;
}): Promise<void> {
  const tx = db.transaction(async () => {
    await db.prepare("DELETE FROM space_map_regions WHERE map_id = ? AND tenant_id = ?").run(params.mapId, params.tenantId);
    const insert = db.prepare(`
      INSERT INTO space_map_regions (tenant_id, map_id, space_id, geometry_json, label, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [index, region] of params.regions.entries()) {
      await insert.run(
        params.tenantId,
        params.mapId,
        region.space_id,
        JSON.stringify(region.geometry),
        region.label || null,
        region.color || null,
        region.sort_order ?? index,
      );
    }
    await db.prepare("UPDATE space_maps SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(
      params.mapId,
      params.tenantId,
    );
  });
  await tx();
}

export async function deleteSpaceMapRegionById(regionId: number, mapId: number, tenantId: number): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM space_map_regions
    WHERE id = ? AND map_id = ? AND tenant_id = ?
  `).run(regionId, mapId, tenantId);
  if (result.changes > 0) {
    await db.prepare("UPDATE space_maps SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(
      mapId,
      tenantId,
    );
  }
  return result.changes;
}
