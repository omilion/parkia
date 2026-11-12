import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { assertPlanLimit, getTenantIdFromRequest } from "../../tenant";
import {
  executeForceReleaseTransaction,
  findActiveContractForSpace,
  findParkingSpaceById,
  findSpaceDetailById,
  insertManualSpaceEntryAccessLog,
  insertSpaceHistoryRow,
  insertSpaceRow,
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

export function listAvailableSpacesForRequest(req: Request, branchId?: number) {
  const tenantId = getTenantIdFromRequest(req);
  return queryAvailableSpaces(tenantId, branchId);
}

export function listSpacesForRequest(req: Request, branchId?: number) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const spaces = queryAllSpacesWithOccupancy(tenantId, branchId);

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

export function getSpaceDetailForRequest(req: Request, spaceId: string) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const space = findSpaceDetailById(spaceId, tenantId);
  if (!space) return null;

  const access = querySpaceAccessLogs(spaceId, tenantId);
  const history = querySpaceStatusHistory(spaceId, tenantId);
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

export function createSpaceForRequest(req: Request, body: CreateSpaceInput) {
  const user = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const branchId = getBranchOrDefault(body.branch_id || null, tenantId);
  assertPlanLimit(req, "spaces");

  const id = insertSpaceRow({
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

  insertSpaceHistoryRow({
    spaceId: id,
    staffId: user?.id || null,
    previousStatus: null,
    status: body.status,
    reason: "Creacion de espacio",
    source: "created",
    tenantId,
  });

  recordAuditEvent(req, {
    action: "space.created",
    entityType: "space",
    entityId: id,
    metadata: { name: body.name, type: body.type, status: body.status, price: body.price, branch_id: branchId },
  });

  return { success: true as const, id };
}

export function updateSpaceForRequest(req: Request, spaceId: string, body: UpdateSpaceInput) {
  const user = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const current = findParkingSpaceById(spaceId, tenantId);
  if (!current) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  if (Object.prototype.hasOwnProperty.call(body, "branch_id")) {
    try {
      getBranchOrDefault(body.branch_id || null, tenantId);
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
  updateSpaceFieldsById(spaceId, tenantId, fields, values);

  insertSpaceHistoryRow({
    spaceId,
    staffId: user?.id || null,
    previousStatus: current.status,
    status: current.status,
    reason: body.reason,
    source: "profile_update",
    tenantId,
  });

  recordAuditEvent(req, {
    action: "space.updated",
    entityType: "space",
    entityId: spaceId,
    metadata: { fields, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export function updateSpaceStatusForRequest(req: Request, spaceId: string, body: UpdateSpaceStatusInput) {
  const user = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const current = findParkingSpaceById(spaceId, tenantId);
  if (!current) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  const changes = updateSpaceStatusRow({
    spaceId,
    tenantId,
    status: body.status,
    notes: body.notes ?? null,
  });
  if (changes === 0) {
    return { status: 404 as const, body: { error: "Espacio no encontrado" } };
  }

  insertSpaceHistoryRow({
    spaceId,
    staffId: user?.id || null,
    previousStatus: current.status,
    status: body.status,
    reason: body.notes ?? null,
    source: "status_update",
    tenantId,
  });

  recordAuditEvent(req, {
    action: "space.status_updated",
    entityType: "space",
    entityId: spaceId,
    metadata: { status: body.status, reason: body.notes || null },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export function forceReleaseSpaceForRequest(req: Request, spaceId: string, reason: string) {
  const user = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);

  executeForceReleaseTransaction({
    spaceId,
    tenantId,
    reason,
    staffId: user?.id || null,
    staffName: user?.name || null,
  });

  recordAuditEvent(req, {
    action: "space.force_released",
    entityType: "space",
    entityId: spaceId,
    metadata: { reason },
  });

  return { success: true as const };
}

export function openSpaceBarrierManuallyForRequest(req: Request, spaceId: string) {
  const tenantId = getTenantIdFromRequest(req);
  const space = findParkingSpaceById(spaceId, tenantId);
  if (!space) return null;

  const contract = findActiveContractForSpace(spaceId, tenantId);
  if (contract) {
    insertManualSpaceEntryAccessLog({
      clientId: contract.client_id,
      spaceId,
      branchId: space.branch_id || null,
      tenantId,
    });
  }

  recordAuditEvent(req, {
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

