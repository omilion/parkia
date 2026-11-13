import type { Request } from "express";
import { existsSync } from "fs";
import { recordAuditEvent } from "../../audit";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import type { PaginationParams } from "../../pagination";
import { resolveStoredFile, storeDocumentFile } from "../../storage";
import { todayLocal } from "../../../shared/dates";
import {
  completeDocumentFollowUpTaskInDb,
  entityExistsInDb,
  findActiveDocumentFollowUpTask,
  getDocumentFileMetadataFromDb,
  getDocumentFromDb,
  insertDocumentFollowUpTaskInDb,
  insertDocumentInDb,
  listActiveDocumentFollowUpTasks,
  listDocumentAssigneesFromDb,
  listDocumentsByEntityFromDb,
  queryDocumentReviewFromDb,
  updateDocumentFollowUpTaskInDb,
  updateDocumentInDb,
  type DocumentEntityType,
} from "./repo";

export async function parseBranchIdQuery(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? await getBranchOrDefault(branchId) : null;
}

function documentOriginLabel(document: any) {
  if (document.entity_type === "client") return `Ficha cliente #${document.entity_id}`;
  if (document.entity_type === "contract") return `Contrato #CON-${String(document.entity_id).padStart(3, "0")}`;
  return `Pago #PAG-${String(document.entity_id).padStart(4, "0")}`;
}

function buildDocumentFollowUpTask(document: any, reason?: string | null) {
  const priority = document.status === "expired" ? "critical" : document.status === "rejected" ? "high" : "medium";
  const title = document.status === "expired"
    ? `Documento vencido: ${document.label}`
    : document.status === "rejected"
      ? `Documento observado: ${document.label}`
      : `Revisar documento: ${document.label}`;
  const description = [
    `${documentOriginLabel(document)} requiere seguimiento documental.`,
    `Estado: ${document.status}.`,
    document.expires_at ? `Vencimiento: ${document.expires_at}.` : null,
    document.assigned_staff_name ? `Responsable documental: ${document.assigned_staff_name}.` : null,
    reason ? `Motivo: ${reason}.` : null,
    document.notes ? `Nota: ${document.notes}.` : null,
  ].filter(Boolean).join("\n");

  return {
    title,
    description,
    priority,
    assignedStaffId: document.assigned_staff_id || null,
    dueDate: document.next_action_at || document.expires_at || todayLocal(),
  };
}

export async function ensureDocumentFollowUpTask(req: Request, documentId: number, tenantId: number, reason?: string | null) {
  const document = await getDocumentFromDb(documentId, tenantId);
  if (!document || !["pending", "rejected", "expired"].includes(document.status)) return;
  const task = buildDocumentFollowUpTask(document, reason);

  const existing = await findActiveDocumentFollowUpTask(documentId, tenantId);
  if (existing) {
    await updateDocumentFollowUpTaskInDb(existing.id, tenantId, {
      title: task.title,
      description: task.description,
      priority: task.priority,
      assignedStaffId: task.assignedStaffId,
      branchId: document.branch_id || null,
      dueDate: task.dueDate,
    });

    await recordAuditEvent(req, {
      action: "document.follow_up_task_synced",
      entityType: "operational_task",
      entityId: existing.id,
      metadata: { document_id: documentId, status: document.status, reason: reason || null },
    });
    return;
  }

  const taskId = await insertDocumentFollowUpTaskInDb(documentId, tenantId, (await getCurrentUser(req))?.id || null, {
    title: task.title,
    description: task.description,
    priority: task.priority,
    assignedStaffId: task.assignedStaffId,
    branchId: document.branch_id || null,
    dueDate: task.dueDate,
  });

  await recordAuditEvent(req, {
    action: "document.follow_up_task_created",
    entityType: "operational_task",
    entityId: taskId,
    metadata: { document_id: documentId, status: document.status, reason: reason || null },
  });
}

export async function closeDocumentFollowUpTasks(req: Request, documentId: number, tenantId: number) {
  const activeTasks = await listActiveDocumentFollowUpTasks(documentId, tenantId);
  for (const task of activeTasks) {
    await completeDocumentFollowUpTaskInDb(task.id, tenantId);
    await recordAuditEvent(req, {
      action: "operational_task.completed",
      entityType: "operational_task",
      entityId: task.id,
      metadata: { note: "Cierre automatico por documento aprobado", document_id: documentId },
    });
  }
}

export async function listDocumentAssignees(tenantId: number) {
  return await listDocumentAssigneesFromDb(tenantId);
}

export async function getDocumentReview(params: {
  tenantId: number;
  scope: "all" | "critical";
  status: string | null;
  documentType: string | null;
  search: string;
  branchId: number | null;
  pagination: PaginationParams;
}) {
  const { documents, total, summary } = await queryDocumentReviewFromDb(params);
  return {
    documents,
    total,
    page: params.pagination.requested ? params.pagination.page : 1,
    pageSize: params.pagination.requested ? params.pagination.pageSize : documents.length,
    totalPages: params.pagination.requested ? Math.max(1, Math.ceil(total / params.pagination.pageSize)) : 1,
    summary,
  };
}

export async function resolveDocumentDownload(
  documentId: number,
  tenantId: number
): Promise<{ ok: true; absolutePath: string; fileName: string; mimeType: string } | { ok: false; status: number; error: string }> {
  const document = await getDocumentFileMetadataFromDb(documentId, tenantId);
  if (!document) return { ok: false, status: 404, error: "Documento no encontrado" };

  try {
    const absolutePath = resolveStoredFile(document.file_path);
    if (!existsSync(absolutePath)) return { ok: false, status: 404, error: "Archivo no encontrado" };
    return {
      ok: true,
      absolutePath,
      fileName: document.file_name,
      mimeType: document.mime_type,
    };
  } catch {
    return { ok: false, status: 400, error: "Ruta de documento inválida" };
  }
}

export async function listDocumentsForEntity(entityType: DocumentEntityType, entityId: number, tenantId: number) {
  if (!await entityExistsInDb(entityType, entityId, tenantId)) return null;
  return await listDocumentsByEntityFromDb(entityType, entityId, tenantId);
}

export async function uploadEntityDocument(
  req: Request,
  entityType: DocumentEntityType,
  entityId: number,
  tenantId: number,
  body: {
    label?: string;
    document_type?: string;
    status?: string;
    expires_at?: string | null;
    notes?: string | null;
    assigned_staff_id?: number | null;
    next_action_at?: string | null;
    fileName?: string;
    mimeType?: "application/pdf" | "image/jpeg" | "image/png";
    dataBase64?: string;
  }
): Promise<{ ok: true; id: number | bigint } | { ok: false; status: number; error: string }> {
  if (!await entityExistsInDb(entityType, entityId, tenantId)) {
    return { ok: false, status: 404, error: "Entidad no encontrada" };
  }

  const stored = storeDocumentFile({
    fileName: body.fileName || "document",
    mimeType: body.mimeType || "application/pdf",
    dataBase64: body.dataBase64 || "",
    folder: `${entityType}-documents`,
    tenantId,
  });

  const documentId = await insertDocumentInDb(entityType, entityId, tenantId, body, stored);

  await recordAuditEvent(req, {
    action: "document.uploaded",
    entityType,
    entityId,
    metadata: {
      document_id: documentId,
      label: body.label,
      document_type: body.document_type,
      status: body.status,
      expires_at: body.expires_at,
      assigned_staff_id: body.assigned_staff_id || null,
      next_action_at: body.next_action_at,
      file_name: stored.fileName,
    },
  });

  await ensureDocumentFollowUpTask(req, Number(documentId), tenantId, body.notes || null);
  return { ok: true, id: documentId };
}

export async function updateDocument(
  req: Request,
  documentId: number,
  tenantId: number,
  body: {
    label?: string;
    document_type?: string;
    status?: string;
    expires_at?: string | null;
    notes?: string | null;
    assigned_staff_id?: number | null;
    next_action_at?: string | null;
    rejection_reason?: string | null;
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const current = await getDocumentFromDb(documentId, tenantId);
  if (!current) return { ok: false, status: 404, error: "Documento no encontrado" };
  if (body.status === "rejected" && !body.rejection_reason?.trim() && !body.notes?.trim()) {
    return { ok: false, status: 400, error: "Observar un documento requiere motivo o nota de rechazo" };
  }

  await updateDocumentInDb(documentId, tenantId, (await getCurrentUser(req))?.id || null, body);

  await recordAuditEvent(req, {
    action: "document.updated",
    entityType: "document",
    entityId: documentId,
    metadata: body,
  });

  const updated = await getDocumentFromDb(documentId, tenantId);
  if (updated?.status === "approved") {
    await closeDocumentFollowUpTasks(req, documentId, tenantId);
  } else if (updated && ["pending", "rejected", "expired"].includes(updated.status)) {
    await ensureDocumentFollowUpTask(req, documentId, tenantId, body.rejection_reason || body.notes || null);
  }

  return { ok: true };
}
