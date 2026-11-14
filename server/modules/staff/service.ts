import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { hashPassword } from "../../auth/password";
import { getCurrentUser, revokeUserSessions } from "../../auth/sessions";
import { recordStaffAccessEvent } from "../../staffAccess";
import {
  assertPlanLimit,
  createTenantMembershipForStaff,
  getTenantIdFromRequest,
  assertNotPlatformIdentity,
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

export async function listStaffForRequest(req: Request) {
  const tenantId = await getTenantIdFromRequest(req);
  return (await queryStaffForTenant(tenantId)).map((user) => ({
    ...user,
    must_change_password: Boolean(user.must_change_password),
  }));
}

export async function createStaffForRequest(req: Request, body: CreateStaffInput) {
  const tenantId = await getTenantIdFromRequest(req);
  const reserved = assertNotPlatformIdentity(await getCurrentUser(req), { newEmail: body.email });
  if (reserved) throw new Error(reserved);
  await assertPlanLimit(req, "users");
  const id = Number(
    await insertStaffMember({
      name: body.name,
      rut: body.rut,
      email: body.email,
      phone: body.phone ?? null,
      role: body.role,
      passwordHash: hashPassword(body.password || "Cambiar123!"),
    }),
  );
  await createTenantMembershipForStaff(tenantId, id, body.role);
  await recordAuditEvent(req, {
    action: "staff.created",
    entityType: "staff",
    entityId: id,
    metadata: { email: body.email, role: body.role, must_change_password: true },
  });
  return { success: true as const, id };
}

export async function listStaffAccessEventsForRequest(req: Request, staffId: string) {
  const tenantId = await getTenantIdFromRequest(req);
  const staff = await findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }
  return { status: 200 as const, body: await queryStaffAccessEvents(staffId) };
}

export async function updateStaffForRequest(req: Request, staffId: string, body: UpdateStaffInput) {
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const staff = await findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }
  const reserved = assertNotPlatformIdentity(currentUser, { targetEmail: staff.email, newEmail: body.email });
  if (reserved) return { status: 403 as const, body: { error: reserved, code: "PLATFORM_IDENTITY_PROTECTED" } };

  const roleChanged = staff.role !== body.role;
  if (staff.id === currentUser?.id && roleChanged && body.role !== "admin") {
    return { status: 400 as const, body: { error: "No puedes quitarte tu propio rol administrador" } };
  }

  if (staff.role === "admin" && staff.status === "active" && roleChanged && body.role !== "admin") {
    const activeAdmins = await countOtherActiveAdminsInTenant(staff.id, tenantId);
    if (activeAdmins === 0) {
      return { status: 400 as const, body: { error: "Debe existir al menos un administrador activo" } };
    }
  }

  await updateStaffProfileAndRole({
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
    await revokeUserSessions(staff.id);
  }

  await recordAuditEvent(req, {
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
  await recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: roleChanged ? "role_changed" : "profile_updated",
    metadata: { reason: body.reason, previous_role: staff.role, role: body.role },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export async function updateStaffStatusForRequest(req: Request, staffId: string, body: UpdateStaffStatusInput) {
  const { status } = body;
  const currentUser = await getCurrentUser(req);
  const tenantId = await getTenantIdFromRequest(req);
  const staff = await findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }
  const reserved = assertNotPlatformIdentity(currentUser, { targetEmail: staff.email });
  if (reserved) return { status: 403 as const, body: { error: reserved, code: "PLATFORM_IDENTITY_PROTECTED" } };

  if (staff.id === currentUser?.id && status === "inactive") {
    return { status: 400 as const, body: { error: "No puedes desactivar tu propio usuario" } };
  }

  if (staff.role === "admin" && staff.status === "active" && status === "inactive") {
    const activeAdmins = await countOtherActiveAdminsInTenant(staff.id, tenantId);
    if (activeAdmins === 0) {
      return { status: 400 as const, body: { error: "Debe existir al menos un administrador activo" } };
    }
  }

  if (status === "active" && staff.status !== "active") {
    await assertPlanLimit(req, "users");
  }

  await updateStaffStatusById(staff.id, status);
  if (status === "inactive") await revokeUserSessions(staff.id);

  await recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: "status_changed",
    metadata: { previous_status: staff.status, status, reason: body.reason },
  });
  await recordAuditEvent(req, {
    action: "staff.status_updated",
    entityType: "staff",
    entityId: staff.id,
    metadata: { email: staff.email, role: staff.role, previous_status: staff.status, status, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}

export async function resetStaffPasswordForRequest(req: Request, staffId: string, body: ResetStaffPasswordInput) {
  const tenantId = await getTenantIdFromRequest(req);
  const staff = await findActiveTenantStaffById(staffId, tenantId);
  if (!staff) {
    return { status: 404 as const, body: { error: "Usuario no encontrado" } };
  }
  // Cambiarle la clave a un administrador de Parkia seria tomar el control de la plataforma.
  const reserved = assertNotPlatformIdentity(await getCurrentUser(req), { targetEmail: staff.email });
  if (reserved) return { status: 403 as const, body: { error: reserved, code: "PLATFORM_IDENTITY_PROTECTED" } };

  await resetStaffPasswordHashById(staff.id, hashPassword(body.password));
  await revokeUserSessions(staff.id);
  await recordStaffAccessEvent(req, {
    staffId: staff.id,
    eventType: "password_reset",
    metadata: { email: staff.email, reason: body.reason },
  });
  await recordAuditEvent(req, {
    action: "staff.password_reset",
    entityType: "staff",
    entityId: staff.id,
    metadata: { email: staff.email, reason: body.reason },
  });

  return { status: 200 as const, body: { success: true as const } };
}
