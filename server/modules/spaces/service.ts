import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { assertPlanLimit, getTenantIdFromRequest } from "../../tenant";
import {
  bulkInsertSpaces,
  executeForceReleaseTransaction,
  findActiveContractForSpace,
  findParkingSpaceById,
  findSpaceDetailById,
  insertManualSpaceEntryAccessLog,
  insertSpaceHistoryRow,
  insertSpaceRow,
  listBranchesForSpaceImport,
  listExistingSpaceNamesByBranch,
  queryAllSpacesWithOccupancy,
  queryAvailableSpaces,
  querySpaceAccessLogs,
  querySpaceStatusHistory,
  updateSpaceFieldsById,
  updateSpaceStatusRow,
} from "./repo";

export type CreateSpaceInput = {
  name: string;
  type: "parking";
  status: "available" | "occupied" | "maintenance";
  price: number;
  location?: string | null;
  level?: string | null;
  width_m?: number | null;
  length_m?: number | null;
  height_m?: number | null;
  features?: string | null;
  notes?: string | null;
  branch_id?: number;
};

export type UpdateSpaceInput = Partial<Omit<CreateSpaceInput, "status">> & {
  reason: string;
};

export type UpdateSpaceStatusInput = {
  status: "available" | "occupied" | "maintenance";
  notes?: string | null;
};

function isLimitedOperationalRole(role?: string | null) {
  return role === "guard" || role === "cashier";
}

function assignedClientForRole(row: Record<string, any>, role?: string | null) {
  if (!row.client_id) return null;
  if (isLimitedOperationalRole(role)) {
    return {
      id: row.client_id,
      name: row.client_name,
    };
  }
  return {
    id: row.client_id,
    name: row.client_name,
    rut: row.client_rut,
    financial_status: row.financial_status,
  };
}

export async function listAvailableSpacesForRequest(req: Request, branchId?: number) {
  const tenantId = await getTenantIdFromRequest(req);
  return await queryAvailableSpaces(tenantId, branchId);
}

export async function listSpacesForRequest(req: Request, branchId?: number) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const spaces = await queryAllSpacesWithOccupancy(tenantId, branchId);

  return spaces.map((s) => {
    const { client_rut, financial_status, ...safeSpace } = s;
    return {
      ...safeSpace,
      ...(isLimitedOperationalRole(currentUser?.role) ? {} : { client_rut, financial_status }),
      assigned_client: assignedClientForRole(s, currentUser?.role),
      is_present: s.last_access_type === "entry",
      entry_time: s.last_access_type === "entry" ? s.last_access_time : null,
      current_plate: s.last_access_type === "entry" ? s.last_access_plate : null,
    };
  });
}

export async function getSpaceDetailForRequest(req: Request, spaceId: string) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const space = await findSpaceDetailById(spaceId, tenantId);
  if (!space) return null;

  const access = await querySpaceAccessLogs(spaceId, tenantId);
  const history = await querySpaceStatusHistory(spaceId, tenantId);
  const { client_rut, financial_status, ...safeSpace } = space;

  return {
    space: {
      ...safeSpace,
      ...(isLimitedOperationalRole(currentUser?.role) ? {} : { client_rut, financial_status }),
      assigned_client: assignedClientForRole(space, currentUser?.role),
    },
    access,
    history,
  };
}

export async function createSpaceForRequest(req: Request, body: CreateSpaceInput) {
  const user = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const branchId = await getBranchOrDefault(body.branch_id || null, tenantId);
  await assertPlanLimit(req, "spaces");

  const id = await insertSpaceRow({
    name: body.name,
    type: body.type,
    status: body.status,
    price: body.price,
    location: body.location ?? null,
    level: body.level ?? null,
    width_m: body.width_m ?? null,
    length_m: body.length_m ?? null,
    height_m: body.height_m ?? null,
    features: body.features ?? null,
    notes: body.notes ?? null,
    branchId,
    tenantId,
  });

  await insertSpaceHistoryRow({
    spaceId: id,
    staffId: user?.id || null,
    previousStatus: null,
    status: body.status,
    reason: "Creacion de espacio",
    source: "created",
    tenantId,
  });

  await recordAuditEvent(req, {
    action: "space.created",
    entityType: "space",
    entityId: id,
    metadata: { name: body.name, type: body.type, status: body.status, price: body.price, branch_id: branchId },
  });

  return { success: true as const, id };
}

export async function updateSpaceForRequest(req: Request, spaceId: string, body: UpdateSpaceInput) {
  const user = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const current = await findParkingSpaceById(spaceId, tenantId);
  if (!current) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  if (Object.prototype.hasOwnProperty.call(body, "branch_id")) {
    try {
      await getBranchOrDefault(body.branch_id || null, tenantId);
    } catch (e: any) {
      return { status: 400 as const, body: { error: e.message || "Sucursal invalida" } };
    }
  }

  const fields = [
    "name",
    "type",
    "price",
    "location",
    "level",
    "width_m",
    "length_m",
    "height_m",
    "features",
    "notes",
    "branch_id",
  ].filter((field) => Object.prototype.hasOwnProperty.call(body, field));

  if (fields.length === 0) {
    return { status: 400 as const, body: { error: "No hay campos validos para actualizar" } };
  }

  const values = fields.map((field) => (body as Record<string, unknown>)[field] ?? null);
  await updateSpaceFieldsById(spaceId, tenantId, fields, values);

  await insertSpaceHistoryRow({
    spaceId,
    staffId: user?.id || null,
    previousStatus: current.status,
    status: current.status,
    reason: body.reason,
    source: "profile_update",
    tenantId,
  });

  await recordAuditEvent(req, {
    action: "space.updated",
    entityType: "space",
    entityId: spaceId,
    metadata: { fields, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export async function updateSpaceStatusForRequest(req: Request, spaceId: string, body: UpdateSpaceStatusInput) {
  const user = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const current = await findParkingSpaceById(spaceId, tenantId);
  if (!current) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  const changes = await updateSpaceStatusRow({
    spaceId,
    tenantId,
    status: body.status,
    notes: body.notes ?? null,
  });
  if (changes === 0) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  await insertSpaceHistoryRow({
    spaceId,
    staffId: user?.id || null,
    previousStatus: current.status,
    status: body.status,
    reason: body.notes ?? null,
    source: "status_update",
    tenantId,
  });

  await recordAuditEvent(req, {
    action: "space.status_updated",
    entityType: "space",
    entityId: spaceId,
    metadata: { status: body.status, reason: body.notes || null },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export async function forceReleaseSpaceForRequest(req: Request, spaceId: string, reason: string) {
  const user = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);

  await executeForceReleaseTransaction({
    spaceId,
    tenantId,
    reason,
    staffId: user?.id || null,
    staffName: user?.name || null,
  });

  await recordAuditEvent(req, {
    action: "space.force_released",
    entityType: "space",
    entityId: spaceId,
    metadata: { reason },
  });

  return { success: true as const };
}

export async function openSpaceBarrierManuallyForRequest(req: Request, spaceId: string) {
  const tenantId = await getTenantIdFromRequest(req);
  const space = await findParkingSpaceById(spaceId, tenantId);
  if (!space) return null;

  const contract = await findActiveContractForSpace(spaceId, tenantId);
  if (contract) {
    await insertManualSpaceEntryAccessLog({
      clientId: contract.client_id,
      spaceId,
      branchId: space.branch_id || null,
      tenantId,
    });
  }

  await recordAuditEvent(req, {
    action: "space.manual_access_registered",
    entityType: "space",
    entityId: spaceId,
    metadata: { client_id: contract?.client_id || null, device_action: "manual_protocol_no_remote_actuator" },
  });

  return {
    success: true as const,
    manual_only: true as const,
    message: `Apertura manual registrada para ${space.name}. Accione el acceso fisico segun protocolo operativo.`,
  };
}

function parseCsvLines(csvText: string): string[][] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const separator = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  return lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === separator && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

function normalizeSpaceHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseSpaceStatus(raw: string): "available" | "occupied" | "maintenance" {
  const normalized = normalizeSpaceHeader(raw);
  if (normalized === "occupied" || normalized === "ocupado" || normalized === "ocupada") return "occupied";
  if (normalized === "maintenance" || normalized === "mantencion") return "maintenance";
  return "available";
}

function parseOptionalMetric(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw.replace(",", "."));
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export async function importSpacesFromCsv(
  req: Request,
  body: { csv: string; branch_id?: number },
): Promise<
  | { ok: true; payload: { success: true; imported: number; skipped: number; errors: string[] } }
  | { ok: false; status: 400; payload: { error: string } }
> {
  const user = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const rows = parseCsvLines(body.csv);
  if (rows.length < 2) {
    return { ok: false, status: 400, payload: { error: "El CSV debe incluir encabezados y al menos una plaza." } };
  }

  const headers = rows[0].map(normalizeSpaceHeader);
  const colIndex = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));
  const idxName = colIndex(["nombre", "name", "plaza", "codigo", "code"]);
  if (idxName === -1) {
    return { ok: false, status: 400, payload: { error: "Falta la columna obligatoria 'Nombre'." } };
  }
  const idxBranch = colIndex(["sucursal", "branch"]);
  const idxStatus = colIndex(["estado", "status"]);
  const idxPrice = colIndex(["precio mensual", "precio", "price"]);
  const idxLocation = colIndex(["ubicacion", "location"]);
  const idxLevel = colIndex(["nivel", "level"]);
  const idxWidth = colIndex(["ancho m", "width_m", "ancho"]);
  const idxLength = colIndex(["largo m", "length_m", "largo"]);
  const idxHeight = colIndex(["alto m", "height_m", "alto"]);
  const idxFeatures = colIndex(["caracteristicas", "features"]);
  const idxNotes = colIndex(["notas", "notes"]);

  const branches = await listBranchesForSpaceImport(tenantId);
  const defaultBranchId = await getBranchOrDefault(body.branch_id || null, tenantId);
  const existing = await listExistingSpaceNamesByBranch(tenantId);
  const seen = new Set(existing.map((item) => `${item.branch_id ?? 0}:${item.name.trim().toLowerCase()}`));

  const toInsert: Parameters<typeof bulkInsertSpaces>[0] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const name = (cells[idxName] || "").trim();
    if (!name) {
      skipped += 1;
      errors.push(`Fila ${i + 1}: falta el nombre de la plaza.`);
      continue;
    }

    let branchId = defaultBranchId;
    if (idxBranch !== -1 && cells[idxBranch]) {
      const target = cells[idxBranch].trim().toLowerCase();
      const matched = branches.find(
        (b) => b.name.trim().toLowerCase() === target || b.code.trim().toLowerCase() === target,
      );
      if (matched) branchId = matched.id;
    }

    const key = `${branchId}:${name.toLowerCase()}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);

    const rawPrice = idxPrice !== -1 ? Number(String(cells[idxPrice] || "0").replace(/[^0-9.-]/g, "")) : 0;
    const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : 0;

    toInsert.push({
      name: name.slice(0, 200),
      status: parseSpaceStatus(idxStatus !== -1 ? cells[idxStatus] || "" : ""),
      price,
      location: idxLocation !== -1 && cells[idxLocation] ? cells[idxLocation] : null,
      level: idxLevel !== -1 && cells[idxLevel] ? cells[idxLevel] : null,
      width_m: parseOptionalMetric(idxWidth !== -1 ? cells[idxWidth] : undefined),
      length_m: parseOptionalMetric(idxLength !== -1 ? cells[idxLength] : undefined),
      height_m: parseOptionalMetric(idxHeight !== -1 ? cells[idxHeight] : undefined),
      features: idxFeatures !== -1 && cells[idxFeatures] ? cells[idxFeatures] : null,
      notes: idxNotes !== -1 && cells[idxNotes] ? cells[idxNotes] : null,
      branchId,
    });
  }

  if (toInsert.length > 0) {
    await assertPlanLimit(req, "spaces", toInsert.length);
    await bulkInsertSpaces(toInsert, tenantId, user?.id || null);
    await recordAuditEvent(req, {
      action: "spaces.imported",
      entityType: "space",
      metadata: { imported: toInsert.length, skipped },
    });
  }

  return {
    ok: true,
    payload: { success: true, imported: toInsert.length, skipped, errors },
  };
}

