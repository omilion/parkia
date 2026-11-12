import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { DEFAULT_TIMEZONE, resolveTimezone } from "../../platform/timezone";
import { assertPlanLimit, getTenantIdFromRequest } from "../../tenant";
import {
  findBranchByIdAndTenant,
  insertBranch,
  queryBranchesWithCounts,
  updateBranchById,
} from "./repo";

export type CreateBranchInput = {
  name: string;
  code: string;
  address?: string | null;
  commune?: string | null;
  city?: string | null;
  phone?: string | null;
  timezone?: string | null;
  status: "active" | "inactive";
};

export type UpdateBranchInput = Partial<CreateBranchInput> & {
  reason: string;
};

export function listBranchesForRequest(req: Request) {
  const tenantId = getTenantIdFromRequest(req);
  return queryBranchesWithCounts(tenantId).map((branch) => ({
    ...branch,
    timezone: branch.timezone || DEFAULT_TIMEZONE,
    spaces_count: Number(branch.spaces_count || 0),
    active_tickets_count: Number(branch.active_tickets_count || 0),
  }));
}

export function createBranchForRequest(req: Request, body: CreateBranchInput) {
  const tenantId = getTenantIdFromRequest(req);
  if (body.status === "active") assertPlanLimit(req, "branches");

  const timezone = resolveTimezone(body.timezone || DEFAULT_TIMEZONE);
  const id = Number(
    insertBranch({
      name: body.name,
      code: body.code,
      address: body.address ?? null,
      commune: body.commune ?? null,
      city: body.city ?? null,
      phone: body.phone ?? null,
      timezone,
      status: body.status,
      tenantId,
    }),
  );

  recordAuditEvent(req, {
    action: "branch.created",
    entityType: "branch",
    entityId: id,
    metadata: { ...body, timezone },
  });

  return { success: true as const, id };
}

export function updateBranchForRequest(req: Request, branchId: string, body: UpdateBranchInput) {
  const tenantId = getTenantIdFromRequest(req);
  const current = findBranchByIdAndTenant(branchId, tenantId);
  if (!current) {
    return { status: 404 as const, body: { error: "Sucursal no encontrada" } };
  }

  const fields = ["name", "code", "address", "commune", "city", "phone", "timezone", "status"].filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (fields.length === 0) {
    return { status: 400 as const, body: { error: "No hay campos validos para actualizar" } };
  }

  if (body.status === "active" && current.status !== "active") {
    assertPlanLimit(req, "branches");
  }

  const values = fields.map((field) => {
    if (field === "timezone") return resolveTimezone(body.timezone);
    return (body as Record<string, unknown>)[field] ?? null;
  });
  updateBranchById(branchId, tenantId, fields, values);

  recordAuditEvent(req, {
    action: "branch.updated",
    entityType: "branch",
    entityId: branchId,
    metadata: {
      fields,
      reason: body.reason,
      previous: current,
    },
  });

  return { status: 200 as const, body: { success: true as const } };
}
