import type { Request } from "express";
import { z } from "zod";
import { getCurrentUser } from "../../auth/sessions";
import { getTenantContextFromRequest } from "../../tenant";
import { optionalTextSchema } from "../../validation";
import {
  getAuditSummaryFromDb,
  insertAuditEventInDb,
  listAuditEventsForCsvFromDb,
  listAuditEventsFromDb,
} from "./repo";

export type AuditEventInput = {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(req: Request, input: AuditEventInput) {
  const user = await getCurrentUser(req);
  const tenantId = (await getTenantContextFromRequest(req))?.tenant.id || null;

  await insertAuditEventInDb({
    staffId: user?.id || null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId == null ? null : String(input.entityId),
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
    tenantId,
  });
}

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  action: optionalTextSchema,
  entity_type: optionalTextSchema,
  staff_id: z.coerce.number().int().positive().optional(),
  from: optionalTextSchema,
  to: optionalTextSchema,
  q: optionalTextSchema,
});

export const auditActionLabels: Record<string, string> = {
  "payment.registered": "Pago registrado",
  "payment_adjustment.created": "Ajuste financiero creado",
  "bank_movement.reconciled": "Movimiento bancario conciliado",
  "bank_movement.allocated": "Abono aplicado desde cartola",
  "payment_allocation.reversed": "Abono reversado",
  "expense.created": "Gasto creado",
  "expense.updated": "Gasto actualizado",
  "expense.status_updated": "Estado de gasto actualizado",
  "guard_shift_log.opened": "Bitácora de turno abierta",
  "guard_shift_log.closed": "Bitácora de turno cerrada",
  "guard_shift_log.entry_created": "Novedad de turno creada",
  "access.denied_resolved_by_override": "Acceso denegado resuelto por apertura manual",
  "access.manual_override": "Apertura manual registrada",
  "dashboard_alert.task_created": "Tarea creada desde alerta",
  "operational_task.created": "Tarea operacional creada",
  "operational_task.completed": "Tarea operacional cerrada",
  "staff.password_reset": "Contraseña de usuario reiniciada",
  "staff.status_updated": "Estado de usuario actualizado",
  "staff.role_updated": "Rol de usuario actualizado",
  "finance_month.closed": "Mes financiero cerrado",
  "finance_month.reopened": "Mes financiero reabierto",
  "document.updated": "Documento actualizado",
};

export const auditEntityLabels: Record<string, string> = {
  payment: "Pago",
  payment_adjustment: "Ajuste financiero",
  bank_movement: "Movimiento bancario",
  payment_allocation: "Abono",
  expense: "Gasto",
  guard_shift_log: "Bitácora de turno",
  guard_shift_log_entry: "Novedad de turno",
  access_log: "Registro de acceso",
  dashboard_alert: "Alerta dashboard",
  operational_task: "Tarea operacional",
  staff: "Usuario",
  monthly_finance_closure: "Cierre financiero",
  document: "Documento",
};

export function auditLabel(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key.replace(/[._]/g, " ");
}

export function buildAuditFilters(query: unknown, tenantId: number) {
  const parsed = auditQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false as const, error: "Filtros de auditoria invalidos" };

  const where: string[] = ["a.tenant_id = ?"];
  const params: unknown[] = [tenantId];
  const { action, entity_type, staff_id, from, to, q } = parsed.data;

  if (action) {
    where.push("a.action = ?");
    params.push(action);
  }
  if (entity_type) {
    where.push("a.entity_type = ?");
    params.push(entity_type);
  }
  if (staff_id) {
    where.push("a.staff_id = ?");
    params.push(staff_id);
  }
  if (from) {
    where.push("date(a.created_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    where.push("date(a.created_at) <= date(?)");
    params.push(to);
  }
  if (q) {
    const like = `%${q}%`;
    where.push("(a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.metadata LIKE ? OR s.name LIKE ? OR s.email LIKE ?)");
    params.push(like, like, like, like, like, like);
  }

  return {
    ok: true as const,
    whereSql: `WHERE ${where.join(" AND ")}`,
    params,
    limit: parsed.data.limit ?? 100,
  };
}

export async function listAuditEvents(query: unknown, tenantId: number) {
  const filters = buildAuditFilters(query, tenantId);
  if (filters.ok === false) return filters;
  const events = await listAuditEventsFromDb(filters.whereSql, filters.params, filters.limit);
  return { ok: true as const, events };
}

export async function getAuditEventsSummary(query: unknown, tenantId: number) {
  const filters = buildAuditFilters(query, tenantId);
  if (filters.ok === false) return filters;
  const summary = await getAuditSummaryFromDb(filters.whereSql, filters.params);
  return { ok: true as const, summary };
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export async function exportAuditEventsCsv(query: Record<string, unknown>, tenantId: number) {
  const filters = buildAuditFilters({ ...query, limit: 500 }, tenantId);
  if (filters.ok === false) return filters;

  const events = await listAuditEventsForCsvFromDb(filters.whereSql, filters.params, filters.limit);
  const csv = toCsv([
    ["ID", "Fecha", "Usuario", "Correo usuario", "Acción", "Tipo entidad", "ID entidad", "Detalle técnico", "IP"],
    ...events.map((event) => [
      event.id,
      event.created_at,
      event.staff_name,
      event.staff_email,
      auditLabel(auditActionLabels, event.action),
      auditLabel(auditEntityLabels, event.entity_type),
      event.entity_id,
      event.metadata,
      event.ip_address,
    ]),
  ]);

  return { ok: true as const, csv };
}
