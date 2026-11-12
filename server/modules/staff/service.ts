import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { hashPassword } from "../../auth/password";
import { getCurrentUser, revokeUserSessions } from "../../auth/sessions";
import { recordStaffAccessEvent } from "../../staffAccess";
import {
  assertPlanLimit,
  createTenantMembershipForStaff,
  getTenantIdFromRequest,
} from "../../tenant";
import {
  countOtherActiveAdminsInTenant,
  findActiveTenantStaffById,
  insertStaffMember,
  queryStaffAccessEvents,
  queryStaffForTenant,
  resetStaffPasswordHashById,
  updateStaffProfileAndRole,
  updateStaffStatusById,
} from "./repo";

export type CreateStaffInput = {
  name: string;
  rut: string;
  email: string;
  phone?: string | null;
  role: "admin" | "finance" | "guard" | "cashier";
  password?: string;
};

export type UpdateStaffInput = {
  name: string;
  rut: string;
  email: string;
  phone?: string | null;
  role: "admin" | "finance" | "guard" | "cashier";
  reason: string;
};

export type UpdateStaffStatusInput = {
  status: "active" | "inactive";
  reason: string;
};

export type ResetStaffPasswordInput = {
  password: string;
  reason: string;
};

export function listStaffForRequest(req: Request) {
  const tenantId = getTenantIdFromRequest(req);
  return queryStaffForTenant(tenantId).map((user) => ({
    ...user,
    must_change_password: Boolean(user.must_change_password),
  }));
}

export function createStaffForRequest(req: Request, body: CreateStaffInput) {
  const tenantId = getTenantIdFromRequest(req);
  assertPlanLimit(req, "users");
  const id = Number(
    insertStaffMember({
      name: body.name,
      rut: body.rut,
      email: body.email,
      phone: body.phone ?? null,
      role: body.role,
      passwordHash: hashPassword(body.password || "Cambiar123!"),
    }),
  );
  createTenantMembershipForStaff(tenantId, id, body.role);
  recordAuditEvent(req, {
    action: "staff.created",
    entityType: "staff",
    entityId: id,
    metadata: { email: body.email, role: body.role, must_change_password: true },
  });
  return { success: true as const, id };
}

export function listStaffAccessEventsForRequest(req: Request, staffId: string) {
  const tenantId = getTenantIdFromRequest(req);
  const staff = findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }
  return { status: 200 as const, body: queryStaffAccessEvents(staffId) };
}

export function updateStaffForRequest(req: Request, staffId: string, body: UpdateStaffInput) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const staff = findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }

  const roleChanged = staff.role !== body.role;
  if (staff.id === currentUser?.id && roleChanged && body.role !== "admin") {
    return { status: 400 as const, body: { error: "No puedes quitarte tu propio rol administrador" } };
  }

  if (staff.role === "admin" && staff.status === "active" && roleChanged && body.role !== "admin") {
    const activeAdmins = countOtherActiveAdminsInTenant(staff.id, tenantId);
    if (activeAdmins === 0) {
      return { status: 400 as const, body: { error: "Debe existir al menos un administrador activo" } };
    }
  }

  updateStaffProfileAndRole({
    staffId: staff.id,
    tenantId,
    name: body.name,
    rut: body.rut,
    email: body.email,
    phone: body.phone ?? null,
    role: body.role,
    roleChanged,
  });

  if (roleChanged) {
    revokeUserSessions(staff.id);
  }

  recordAuditEvent(req, {
    action: roleChanged ? "staff.role_updated" : "staff.profile_updated",
    entityType: "staff",
    entityId: staff.id,
    metadata: {
      reason: body.reason,
      previous: { name: staff.name, rut: staff.rut, email: staff.email, phone: staff.phone, role: staff.role },
      current: { name: body.name, rut: body.rut, email: body.email, phone: body.phone, role: body.role },
      sessions_revoked: roleChanged,
    },
  });
  recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: roleChanged ? "role_changed" : "profile_updated",
    metadata: { reason: body.reason, previous_role: staff.role, role: body.role },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export function updateStaffStatusForRequest(req: Request, staffId: string, body: UpdateStaffStatusInput) {
  const { status } = body;
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const staff = findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }

  if (staff.id === currentUser?.id && status === "inactive") {
    return { status: 400 as const, body: { error: "No puedes desactivar tu propio usuario" } };
  }

  if (staff.role === "admin" && staff.status === "active" && status === "inactive") {
    const activeAdmins = countOtherActiveAdminsInTenant(staff.id, tenantId);
    if (activeAdmins === 0) {
      return { status: 400 as const, body: { error: "Debe existir al menos un administrador activo" } };
    }
  }

  if (status === "active" && staff.status !== "active") {
    assertPlanLimit(req, "users");
  }

  updateStaffStatusById(staff.id, status);
  if (status === "inactive") revokeUserSessions(staff.id);

  recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: "status_changed",
    metadata: { previous_status: staff.status, status, reason: body.reason },
  });
  recordAuditEvent(req, {
    action: "staff.status_updated",
    entityType: "staff",
    entityId: staff.id,
    metadata: { email: staff.email, role: staff.role, previous_status: staff.status, status, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export function resetStaffPasswordForRequest(req: Request, staffId: string, body: ResetStaffPasswordInput) {
  const tenantId = getTenantIdFromRequest(req);
  const staff = findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }

  resetStaffPasswordHashById(staff.id, hashPassword(body.password));
  revokeUserSessions(staff.id);
  recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: "password_reset",
    metadata: { email: staff.email, reason: body.reason },
  });
  recordAuditEvent(req, {
    action: "staff.password_reset",
    entityType: "staff",
    entityId: staff.id,
    metadata: { email: staff.email, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}
