import { existsSync } from "fs";
import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import type { AuthUser } from "../../auth/sessions";
import { getCurrentUser } from "../../auth/sessions";
import { getBranchOrDefault } from "../../branches";
import { resolveStoredFile, storeDocumentFile } from "../../storage";
import { getTenantIdFromRequest } from "../../tenant";
import {
  getStaffAssigneeFromDb,
  getTaskAttachmentFromDb,
  getTaskRowByIdFromDb,
  getTaskSummaryCountsFromDb,
  insertTaskCommentWithAttachmentInDb,
  insertTaskInDb,
  listTaskAssigneesFromDb,
  listTaskCommentsFromDb,
  listTaskHistoryEventsFromDb,
  listTasksFromDb,
  markTaskCompleteInDb,
  syncGuardShiftLogResolutionInDb,
  updateTaskInDb,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "./repo";

export type { TaskCategory, TaskPriority, TaskStatus };

export const taskCategoriesByRole: Record<AuthUser["role"], TaskCategory[]> = {
  admin: ["finance", "access", "documents", "contracts", "maintenance", "general"],
  finance: ["finance", "documents", "contracts", "general"],
  guard: ["access", "maintenance", "general"],
  cashier: ["access", "general"],
};

export function canManageTaskCategory(user: AuthUser | null, category: TaskCategory) {
  return !!user && taskCategoriesByRole[user.role].includes(category);
}

export function roleCanManageTaskCategory(role: AuthUser["role"], category: TaskCategory) {
  return taskCategoriesByRole[role].includes(category);
}

export function validateAssigneeForTaskCategory(assignedStaffId: number | null | undefined, category: TaskCategory, tenantId: number) {
  const assignee = getStaffAssigneeFromDb(assignedStaffId, tenantId);
  if (!assignee) return { ok: true as const };
  if (assignee.status !== "active") return { ok: false as const, error: "El responsable seleccionado no esta activo" };
  if (!roleCanManageTaskCategory(assignee.role, category)) {
    return { ok: false as const, error: "El responsable seleccionado no puede ver tareas de esta categoria" };
  }
  return { ok: true as const };
}

export function parseBranchIdQuery(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

export function resolveBranchId(branchId: number | null | undefined, tenantId: number) {
  return branchId ? getBranchOrDefault(branchId, tenantId) : null;
}

export function getTaskCategoriesForUser(user: AuthUser | null) {
  return user ? taskCategoriesByRole[user.role] : [];
}

export function sourceHrefForTask(task: any) {
  if (task.source_type === "dashboard_alert") {
    if (task.source_id === "overdue-payments") return "/finance?tab=collections&collectionStatus=open&collectionDue=all";
    if (task.source_id === "overdue-expenses") return "/finance?tab=expenses&expenseStatus=overdue&expenseDue=all";
    if (task.source_id === "bank-reconciliation") return "/finance?tab=cgvc&movementStatus=attention";
    if (task.source_id === "collection-actions") return "/finance?tab=collections&collectionStatus=open&collectionDue=actionable";
    if (task.source_id === "document-review") return "/documents?filter=critical";
    if (task.source_id === "guard-shift-follow-ups") return "/access?tab=shift-log";
    if (task.source_id === "expiring-contracts") return "/contracts?filter=expiring";
    if (task.source_id === "denied-access") return "/access?tab=audit&type=denied";
  }
  if (task.source_type === "guard_shift_log") {
    if (task.category === "finance") return `/tasks?source=guard_shift_log&taskId=${encodeURIComponent(String(task.id))}`;
    return `/access?tab=shift-log&entryId=${encodeURIComponent(String(task.source_id || ""))}`;
  }
  if (task.source_type === "document") return `/documents?documentId=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "finance_payment_adjustment") return `/finance?tab=payments&paymentId=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "finance_expense_approval") return `/finance?tab=expenses&expenseId=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "finance_monthly_close_approval") return `/finance?tab=reports&month=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "finance_monthly_reopen_approval") return `/finance?tab=reports&month=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "monthly_finance_close") return `/finance?tab=reports&month=${encodeURIComponent(task.source_id || "")}`;
  if (task.source_type === "monthly_finance_reopen") return `/finance?tab=reports&month=${encodeURIComponent(task.source_id || "")}`;
  return null;
}

export function sourceLabelForTask(task: any) {
  if (task.source_type === "dashboard_alert") return "Alerta dashboard";
  if (task.source_type === "guard_shift_log") return "Bitácora guardia";
  if (task.source_type === "document") return "Documento";
  if (task.source_type === "finance_payment_adjustment") return "Aprobación ajuste";
  if (task.source_type === "finance_expense_approval") return "Aprobación gasto";
  if (task.source_type === "finance_monthly_close_approval") return "Aprobación cierre mensual";
  if (task.source_type === "finance_monthly_reopen_approval") return "Aprobación reapertura mensual";
  if (task.source_type === "monthly_finance_close") return "Cierre financiero";
  if (task.source_type === "monthly_finance_reopen") return "Reapertura financiera";
  return "Manual";
}

export function withTaskSourceHref(task: any) {
  return {
    ...task,
    source_href: sourceHrefForTask(task),
    source_label: sourceLabelForTask(task),
  };
}

export function getTask(id: string | number, tenantId: number) {
  const task = getTaskRowByIdFromDb(id, tenantId);
  if (!task) return undefined;
  return withTaskSourceHref(task);
}

export type TaskFilterQuery = {
  status?: "open" | "in_progress" | "done" | "cancelled" | "active" | "all";
  category?: TaskCategory | "all";
  priority?: TaskPriority | "all";
  due?: "today" | "overdue" | "all";
  assigned?: "me" | "unassigned" | "all";
  branch_id?: number;
  source?:
    | "dashboard_alert"
    | "guard_shift_log"
    | "document"
    | "finance_approval"
    | "finance_payment_adjustment"
    | "finance_expense_approval"
    | "finance_monthly_close_approval"
    | "finance_monthly_reopen_approval"
    | "manual"
    | "all";
};

export function buildTaskWhere(query: TaskFilterQuery, currentUser: AuthUser | null, tenantId: number) {
  const conditions: string[] = ["t.tenant_id = ?"];
  const params: Array<string | number> = [tenantId];
  const allowedCategories = getTaskCategoriesForUser(currentUser);

  if (allowedCategories.length === 0) {
    conditions.push("1 = 0");
  } else if (query.category && query.category !== "all") {
    if (!allowedCategories.includes(query.category)) {
      conditions.push("1 = 0");
    } else {
      conditions.push("t.category = ?");
      params.push(query.category);
    }
  } else {
    conditions.push(`t.category IN (${allowedCategories.map(() => "?").join(", ")})`);
    params.push(...allowedCategories);
  }

  if (!query.status || query.status === "active") {
    conditions.push("t.status IN ('open', 'in_progress')");
  } else if (query.status !== "all") {
    conditions.push("t.status = ?");
    params.push(query.status);
  }

  if (query.priority && query.priority !== "all") {
    conditions.push("t.priority = ?");
    params.push(query.priority);
  }

  if (query.due === "today") {
    conditions.push("t.due_date = date('now')");
  } else if (query.due === "overdue") {
    conditions.push("t.due_date IS NOT NULL");
    conditions.push("t.due_date < date('now')");
  }

  if (query.assigned === "me") {
    conditions.push("t.assigned_staff_id = ?");
    params.push(currentUser?.id || 0);
  } else if (query.assigned === "unassigned") {
    conditions.push("t.assigned_staff_id IS NULL");
  }

  if (query.branch_id) {
    conditions.push("t.branch_id = ?");
    params.push(query.branch_id);
  }

  if (query.source === "dashboard_alert") {
    conditions.push("t.source_type = 'dashboard_alert'");
  } else if (query.source === "guard_shift_log") {
    conditions.push("t.source_type = 'guard_shift_log'");
  } else if (query.source === "document") {
    conditions.push("t.source_type = 'document'");
  } else if (query.source === "finance_approval") {
    conditions.push("t.source_type IN ('finance_payment_adjustment', 'finance_expense_approval', 'finance_monthly_close_approval', 'finance_monthly_reopen_approval')");
  } else if (query.source === "finance_payment_adjustment") {
    conditions.push("t.source_type = 'finance_payment_adjustment'");
  } else if (query.source === "finance_expense_approval") {
    conditions.push("t.source_type = 'finance_expense_approval'");
  } else if (query.source === "finance_monthly_close_approval") {
    conditions.push("t.source_type = 'finance_monthly_close_approval'");
  } else if (query.source === "finance_monthly_reopen_approval") {
    conditions.push("t.source_type = 'finance_monthly_reopen_approval'");
  } else if (query.source === "manual") {
    conditions.push("t.source_type IS NULL");
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function categoryWhereForUser(user: AuthUser | null, tenantId: number, alias = "") {
  const categories = getTaskCategoriesForUser(user);
  if (categories.length === 0) return { sql: "1 = 0", params: [] as Array<string | number> };
  const column = alias ? `${alias}.category` : "category";
  const tenantColumn = alias ? `${alias}.tenant_id` : "tenant_id";
  return {
    sql: `${tenantColumn} = ? AND ${column} IN (${categories.map(() => "?").join(", ")})`,
    params: [tenantId, ...categories],
  };
}

export function taskScopeWhereForUser(user: AuthUser | null, branchId: number | null, tenantId: number, alias = "") {
  const categoryScope = categoryWhereForUser(user, tenantId, alias);
  const columnPrefix = alias ? `${alias}.` : "";
  if (!branchId) return categoryScope;
  return {
    sql: `${categoryScope.sql} AND ${columnPrefix}branch_id = ?`,
    params: [...categoryScope.params, branchId],
  };
}

export function listTaskAssignees(tenantId: number) {
  return listTaskAssigneesFromDb(tenantId);
}

export function getTaskSummary(currentUser: AuthUser | null, tenantId: number, rawBranchId: number | null) {
  const branchId = rawBranchId ? getBranchOrDefault(rawBranchId, tenantId) : null;
  const categoryScope = taskScopeWhereForUser(currentUser, branchId, tenantId);
  return getTaskSummaryCountsFromDb(categoryScope, currentUser?.id || 0);
}

export function listTasks(query: TaskFilterQuery, currentUser: AuthUser | null, tenantId: number) {
  const queryData: TaskFilterQuery = {
    ...query,
    branch_id: query.branch_id ? getBranchOrDefault(query.branch_id, tenantId) : undefined,
  };
  const { where, params } = buildTaskWhere(queryData, currentUser, tenantId);
  return listTasksFromDb(where, params).map(withTaskSourceHref);
}

export function getTaskHistory(taskId: string, currentUser: AuthUser | null, tenantId: number) {
  const task = getTask(taskId, tenantId);
  if (!task) return { ok: false as const, status: 404, error: "Tarea no encontrada" };
  if (!canManageTaskCategory(currentUser, task.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para revisar tareas de esta categoría" };
  }
  const events = listTaskHistoryEventsFromDb(task.id, tenantId);
  return { ok: true as const, events };
}

export function getTaskComments(taskId: string, currentUser: AuthUser | null, tenantId: number) {
  const task = getTask(taskId, tenantId);
  if (!task) return { ok: false as const, status: 404, error: "Tarea no encontrada" };
  if (!canManageTaskCategory(currentUser, task.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para revisar tareas de esta categoria" };
  }
  const comments = listTaskCommentsFromDb(task.id, tenantId);
  return { ok: true as const, comments };
}

export function createTaskComment(
  req: Request,
  taskId: string,
  body: {
    note?: string;
    attachment?: {
      label?: string | null;
      fileName?: string;
      mimeType?: "application/pdf" | "image/jpeg" | "image/png";
      dataBase64?: string;
    };
  },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const task = getTask(taskId, tenantId);
  if (!task) return { ok: false as const, status: 404, error: "Tarea no encontrada" };
  if (!canManageTaskCategory(currentUser, task.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para comentar tareas de esta categoria" };
  }

  let storedAttachment: {
    label: string | null;
    filePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  } | null = null;

  if (body.attachment) {
    const stored = storeDocumentFile({
      fileName: body.attachment.fileName!,
      mimeType: body.attachment.mimeType!,
      dataBase64: body.attachment.dataBase64!,
      folder: "task-attachments",
      tenantId,
    });
    storedAttachment = {
      label: body.attachment.label || null,
      filePath: stored.filePath,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    };
  }

  const commentId = insertTaskCommentWithAttachmentInDb({
    taskId: task.id,
    staffId: currentUser?.id || null,
    note: body.note!,
    tenantId,
    attachment: storedAttachment,
  });

  recordAuditEvent(req, {
    action: "operational_task.commented",
    entityType: "operational_task",
    entityId: task.id,
    metadata: { comment_id: commentId, has_attachment: Boolean(body.attachment) },
  });

  return { ok: true as const, id: commentId };
}

export function resolveTaskAttachmentDownload(
  taskId: string,
  attachmentId: string,
  currentUser: AuthUser | null,
  tenantId: number,
) {
  const task = getTask(taskId, tenantId);
  if (!task) return { ok: false as const, status: 404, error: "Tarea no encontrada" };
  if (!canManageTaskCategory(currentUser, task.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para descargar adjuntos de esta tarea" };
  }

  const attachment = getTaskAttachmentFromDb(attachmentId, task.id, tenantId);
  if (!attachment) return { ok: false as const, status: 404, error: "Adjunto no encontrado" };

  try {
    const absolutePath = resolveStoredFile(attachment.file_path);
    if (!existsSync(absolutePath)) return { ok: false as const, status: 404, error: "Archivo no encontrado" };
    return {
      ok: true as const,
      absolutePath,
      fileName: attachment.file_name,
      mimeType: attachment.mime_type,
    };
  } catch {
    return { ok: false as const, status: 400, error: "Ruta de adjunto invalida" };
  }
}

export function createTask(
  req: Request,
  body: {
    title?: string;
    description?: string | null;
    category?: TaskCategory;
    priority?: TaskPriority;
    assigned_staff_id?: number | null;
    branch_id?: number | null;
    source_type?: string | null;
    source_id?: string | null;
    due_date?: string | null;
  },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const category = body.category || "general";
  const priority = body.priority || "medium";
  if (!canManageTaskCategory(currentUser, category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para crear tareas de esta categoría" };
  }

  const assigneeValidation = validateAssigneeForTaskCategory(body.assigned_staff_id, category, tenantId);
  if (assigneeValidation.ok === false) {
    return { ok: false as const, status: 400, error: assigneeValidation.error };
  }
  const branchId = resolveBranchId(body.branch_id || null, tenantId);

  const insertedId = insertTaskInDb({
    title: body.title!,
    description: body.description || null,
    category,
    priority,
    assignedStaffId: body.assigned_staff_id || null,
    branchId,
    sourceType: body.source_type || null,
    sourceId: body.source_id || null,
    dueDate: body.due_date || null,
    createdByStaffId: currentUser?.id || null,
    tenantId,
  });

  recordAuditEvent(req, {
    action: "operational_task.created",
    entityType: "operational_task",
    entityId: insertedId,
    metadata: body as Record<string, unknown>,
  });
  return { ok: true as const, task: getTask(insertedId, tenantId) };
}

export function updateTask(
  req: Request,
  taskId: string,
  body: {
    title?: string;
    description?: string | null;
    category?: TaskCategory;
    priority?: TaskPriority;
    status?: TaskStatus;
    status_note?: string | null;
    assigned_staff_id?: number | null;
    branch_id?: number | null;
    due_date?: string | null;
  },
) {
  const currentUser = getCurrentUser(req);
  const tenantId = getTenantIdFromRequest(req);
  const existing = getTask(taskId, tenantId);
  if (!existing) return { ok: false as const, status: 404, error: "Tarea no encontrada" };

  const next = {
    title: body.title ?? existing.title,
    description: body.description ?? existing.description,
    category: (body.category ?? existing.category) as TaskCategory,
    priority: (body.priority ?? existing.priority) as TaskPriority,
    status: (body.status ?? existing.status) as TaskStatus,
    assigned_staff_id: body.assigned_staff_id === undefined ? existing.assigned_staff_id : body.assigned_staff_id,
    branch_id: body.branch_id === undefined ? existing.branch_id : resolveBranchId(body.branch_id || null, tenantId),
    due_date: body.due_date === undefined ? existing.due_date : body.due_date,
  };
  if (!canManageTaskCategory(currentUser, existing.category) || !canManageTaskCategory(currentUser, next.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para modificar tareas de esta categoría" };
  }

  const assigneeValidation = validateAssigneeForTaskCategory(next.assigned_staff_id, next.category, tenantId);
  if (assigneeValidation.ok === false) {
    return { ok: false as const, status: 400, error: assigneeValidation.error };
  }

  if (body.status === "cancelled" && existing.status !== "cancelled" && !body.status_note?.trim()) {
    return { ok: false as const, status: 400, error: "Anular una tarea requiere una nota operacional" };
  }

  updateTaskInDb({
    id: taskId,
    tenantId,
    title: next.title,
    description: next.description || null,
    category: next.category,
    priority: next.priority,
    status: next.status,
    assignedStaffId: next.assigned_staff_id || null,
    branchId: next.branch_id || null,
    dueDate: next.due_date || null,
  });

  if (existing.source_type === "guard_shift_log" && existing.source_id) {
    if (next.status === "done") {
      syncGuardShiftLogResolutionInDb(existing.source_id, tenantId, true);
    } else if (existing.status === "done") {
      syncGuardShiftLogResolutionInDb(existing.source_id, tenantId, false);
    }
  }

  recordAuditEvent(req, {
    action: "operational_task.updated",
    entityType: "operational_task",
    entityId: taskId,
    metadata: { previous: existing, next, status_note: body.status_note || null },
  });
  return { ok: true as const, task: getTask(taskId, tenantId) };
}

export function completeTask(req: Request, taskId: string, note?: string | null) {
  const tenantId = getTenantIdFromRequest(req);
  const existing = getTask(taskId, tenantId);
  if (!existing) return { ok: false as const, status: 404, error: "Tarea no encontrada" };
  const currentUser = getCurrentUser(req);
  if (!canManageTaskCategory(currentUser, existing.category)) {
    return { ok: false as const, status: 403, error: "No tienes permisos para cerrar tareas de esta categoría" };
  }
  if (existing.status === "done") return { ok: false as const, status: 400, error: "La tarea ya está cerrada" };
  if ((existing.priority === "critical" || existing.source_type === "dashboard_alert") && !note?.trim()) {
    return { ok: false as const, status: 400, error: "Las tareas críticas o creadas desde alertas requieren nota de cierre" };
  }

  markTaskCompleteInDb(taskId, tenantId, note || null);

  if (existing.source_type === "guard_shift_log" && existing.source_id) {
    syncGuardShiftLogResolutionInDb(existing.source_id, tenantId, true);
  }

  recordAuditEvent(req, {
    action: "operational_task.completed",
    entityType: "operational_task",
    entityId: taskId,
    metadata: { note: note || null },
  });
  return { ok: true as const, task: getTask(taskId, tenantId) };
}
