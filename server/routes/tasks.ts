import type { Express } from "express";
import { existsSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import type { AuthUser } from "../auth/sessions";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { getBranchOrDefault } from "../branches";
import { db } from "../db";
import { resolveStoredFile, storeDocumentFile } from "../storage";
import { dateStringSchema, optionalTextSchema, parseBody } from "../validation";

const taskCategorySchema = z.enum(["finance", "access", "documents", "contracts", "maintenance", "general"]);
const taskPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
const taskStatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);

const taskQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled", "active", "all"]).optional(),
  category: z.enum(["finance", "access", "documents", "contracts", "maintenance", "general", "all"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical", "all"]).optional(),
  due: z.enum(["today", "overdue", "all"]).optional(),
  assigned: z.enum(["me", "unassigned", "all"]).optional(),
  branch_id: z.coerce.number().int().positive().optional(),
  source: z.enum([
    "dashboard_alert",
    "guard_shift_log",
    "document",
    "finance_approval",
    "finance_payment_adjustment",
    "finance_expense_approval",
    "finance_monthly_close_approval",
    "finance_monthly_reopen_approval",
    "manual",
    "all",
  ]).optional(),
});

const createTaskSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: optionalTextSchema,
  category: taskCategorySchema.default("general"),
  priority: taskPrioritySchema.default("medium"),
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  source_type: optionalTextSchema,
  source_id: optionalTextSchema,
  due_date: dateStringSchema.optional().nullable(),
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  description: optionalTextSchema,
  category: taskCategorySchema.optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  status_note: optionalTextSchema,
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  branch_id: z.coerce.number().int().positive().optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
}).partial();

const completeTaskSchema = z.object({
  note: optionalTextSchema,
});

const taskAttachmentSchema = z.object({
  label: optionalTextSchema,
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  dataBase64: z.string().trim().min(1),
});

const createTaskCommentSchema = z.object({
  note: z.string().trim().min(1).max(1000),
  attachment: taskAttachmentSchema.optional(),
});

type TaskCategory = z.infer<typeof taskCategorySchema>;

const taskCategoriesByRole: Record<AuthUser["role"], TaskCategory[]> = {
  admin: ["finance", "access", "documents", "contracts", "maintenance", "general"],
  finance: ["finance", "documents", "contracts", "general"],
  guard: ["access", "maintenance", "general"],
  cashier: ["access", "general"],
};

function canManageTaskCategory(user: AuthUser | null, category: TaskCategory) {
  return !!user && taskCategoriesByRole[user.role].includes(category);
}

function roleCanManageTaskCategory(role: AuthUser["role"], category: TaskCategory) {
  return taskCategoriesByRole[role].includes(category);
}

function getStaffAssignee(staffId: number | null | undefined) {
  if (!staffId) return null;
  return db.prepare(`
    SELECT id, name, email, role, status
    FROM staff
    WHERE id = ?
  `).get(staffId) as { id: number, name: string, email: string, role: AuthUser["role"], status: string } | undefined;
}

function validateAssigneeForTaskCategory(assignedStaffId: number | null | undefined, category: TaskCategory) {
  const assignee = getStaffAssignee(assignedStaffId);
  if (!assignee) return { ok: true as const };
  if (assignee.status !== "active") return { ok: false as const, error: "El responsable seleccionado no esta activo" };
  if (!roleCanManageTaskCategory(assignee.role, category)) {
    return { ok: false as const, error: "El responsable seleccionado no puede ver tareas de esta categoria" };
  }
  return { ok: true as const };
}

function parseBranchIdQuery(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function resolveBranchId(branchId: number | null | undefined) {
  return branchId ? getBranchOrDefault(branchId) : null;
}

function getTaskCategoriesForUser(user: AuthUser | null) {
  return user ? taskCategoriesByRole[user.role] : [];
}

function getTask(id: string | number) {
  const task = db.prepare(`
    SELECT t.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           creator.name as created_by_staff_name,
           b.name as branch_name,
           b.code as branch_code
    FROM operational_tasks t
    LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
    LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
    LEFT JOIN branches b ON b.id = t.branch_id
    WHERE t.id = ?
  `).get(id) as any | undefined;
  if (!task) return undefined;
  return withTaskSourceHref(task);
}

function sourceHrefForTask(task: any) {
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

function sourceLabelForTask(task: any) {
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

function withTaskSourceHref(task: any) {
  return {
    ...task,
    source_href: sourceHrefForTask(task),
    source_label: sourceLabelForTask(task),
  };
}

function buildTaskWhere(query: z.infer<typeof taskQuerySchema>, currentUser: AuthUser | null) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
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

function categoryWhereForUser(user: AuthUser | null, alias = "") {
  const categories = getTaskCategoriesForUser(user);
  if (categories.length === 0) return { sql: "1 = 0", params: [] as TaskCategory[] };
  const column = alias ? `${alias}.category` : "category";
  return {
    sql: `${column} IN (${categories.map(() => "?").join(", ")})`,
    params: categories,
  };
}

function taskScopeWhereForUser(user: AuthUser | null, branchId: number | null, alias = "") {
  const categoryScope = categoryWhereForUser(user, alias);
  const columnPrefix = alias ? `${alias}.` : "";
  if (!branchId) return categoryScope;
  return {
    sql: `${categoryScope.sql} AND ${columnPrefix}branch_id = ?`,
    params: [...categoryScope.params, branchId],
  };
}

export function registerTasksRoutes(app: Express) {
  app.use("/api/tasks", requireAnyRole(["admin", "finance", "guard", "cashier"]));

  app.get("/api/tasks/assignees", (req, res) => {
    const staff = db.prepare(`
      SELECT id, name, email, role
      FROM staff
      WHERE status = 'active'
      ORDER BY name ASC
    `).all();
    res.json(staff);
  });

  app.get("/api/tasks/summary", (req, res) => {
    const currentUser = getCurrentUser(req);
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const categoryScope = taskScopeWhereForUser(currentUser, branchId);
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM operational_tasks
      WHERE ${categoryScope.sql}
      GROUP BY status
    `).all(...categoryScope.params) as { status: string, count: number }[];
    const dueToday = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND due_date = date('now')
    `).get(...categoryScope.params) as { count: number };
    const overdue = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND due_date IS NOT NULL
        AND due_date < date('now')
    `).get(...categoryScope.params) as { count: number };
    const assignedToMe = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND assigned_staff_id = ?
    `).get(...categoryScope.params, currentUser?.id || 0) as { count: number };
    const fromAlerts = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND source_type = 'dashboard_alert'
    `).get(...categoryScope.params) as { count: number };
    const fromShiftLogs = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND source_type = 'guard_shift_log'
    `).get(...categoryScope.params) as { count: number };
    const fromDocuments = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND source_type = 'document'
    `).get(...categoryScope.params) as { count: number };
    const criticalActive = db.prepare(`
      SELECT COUNT(*) as count
      FROM operational_tasks
      WHERE status IN ('open', 'in_progress')
        AND ${categoryScope.sql}
        AND priority = 'critical'
    `).get(...categoryScope.params) as { count: number };

    res.json({
      open: rows.find(row => row.status === "open")?.count || 0,
      inProgress: rows.find(row => row.status === "in_progress")?.count || 0,
      done: rows.find(row => row.status === "done")?.count || 0,
      cancelled: rows.find(row => row.status === "cancelled")?.count || 0,
      dueToday: dueToday.count || 0,
      overdue: overdue.count || 0,
      assignedToMe: assignedToMe.count || 0,
      fromAlerts: fromAlerts.count || 0,
      fromShiftLogs: fromShiftLogs.count || 0,
      fromDocuments: fromDocuments.count || 0,
      criticalActive: criticalActive.count || 0,
    });
  });

  app.get("/api/tasks", (req, res) => {
    const currentUser = getCurrentUser(req);
    const query = taskQuerySchema.safeParse({
      status: req.query.status || undefined,
      category: req.query.category || undefined,
      priority: req.query.priority || undefined,
      due: req.query.due || undefined,
      assigned: req.query.assigned || undefined,
      branch_id: req.query.branch_id || undefined,
      source: req.query.source || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de tareas inválidos" });

    const { where, params } = buildTaskWhere(query.data, currentUser);
    const tasks = db.prepare(`
      SELECT t.*,
             assignee.name as assigned_staff_name,
             assignee.email as assigned_staff_email,
             creator.name as created_by_staff_name,
             b.name as branch_name,
             b.code as branch_code
      FROM operational_tasks t
      LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
      LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
      LEFT JOIN branches b ON b.id = t.branch_id
      ${where}
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
        t.due_date ASC,
        t.created_at DESC
    `).all(...params).map(withTaskSourceHref);
    res.json(tasks);
  });

  app.get("/api/tasks/:id/history", (req, res) => {
    const currentUser = getCurrentUser(req);
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarea no encontrada" });
    if (!canManageTaskCategory(currentUser, task.category)) {
      return res.status(403).json({ error: "No tienes permisos para revisar tareas de esta categoría" });
    }

    const events = db.prepare(`
      SELECT a.id,
             a.action,
             a.entity_type,
             a.entity_id,
             a.metadata,
             a.created_at,
             s.name as staff_name,
             s.email as staff_email
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.entity_type = 'operational_task'
        AND a.entity_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 50
    `).all(String(task.id));

    res.json(events);
  });

  app.get("/api/tasks/:id/comments", (req, res) => {
    const currentUser = getCurrentUser(req);
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarea no encontrada" });
    if (!canManageTaskCategory(currentUser, task.category)) {
      return res.status(403).json({ error: "No tienes permisos para revisar tareas de esta categoria" });
    }

    const comments = db.prepare(`
      SELECT c.id,
             c.task_id,
             c.staff_id,
             c.note,
             c.created_at,
             s.name as staff_name,
             s.email as staff_email,
             a.id as attachment_id,
             a.label as attachment_label,
             a.file_name as attachment_file_name,
             a.mime_type as attachment_mime_type,
             a.size_bytes as attachment_size_bytes
      FROM task_comments c
      LEFT JOIN staff s ON s.id = c.staff_id
      LEFT JOIN task_attachments a ON a.comment_id = c.id
      WHERE c.task_id = ?
      ORDER BY c.created_at ASC, c.id ASC
    `).all(task.id);
    res.json(comments);
  });

  app.post("/api/tasks/:id/comments", (req, res) => {
    const body = parseBody(createTaskCommentSchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Tarea no encontrada" });
    if (!canManageTaskCategory(currentUser, task.category)) {
      return res.status(403).json({ error: "No tienes permisos para comentar tareas de esta categoria" });
    }

    const tx = db.transaction(() => {
      const commentResult = db.prepare(`
        INSERT INTO task_comments (task_id, staff_id, note)
        VALUES (?, ?, ?)
      `).run(task.id, currentUser?.id || null, body.note);

      if (body.attachment) {
        const stored = storeDocumentFile({
          fileName: body.attachment.fileName,
          mimeType: body.attachment.mimeType,
          dataBase64: body.attachment.dataBase64,
          folder: "task-attachments",
        });
        db.prepare(`
          INSERT INTO task_attachments (
            task_id, comment_id, staff_id, label, file_path, file_name, mime_type, size_bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          task.id,
          commentResult.lastInsertRowid,
          currentUser?.id || null,
          body.attachment.label || null,
          stored.filePath,
          stored.fileName,
          stored.mimeType,
          stored.sizeBytes,
        );
      }

      return commentResult.lastInsertRowid;
    });

    const commentId = tx();
    recordAuditEvent(req, {
      action: "operational_task.commented",
      entityType: "operational_task",
      entityId: task.id,
      metadata: { comment_id: commentId, has_attachment: Boolean(body.attachment) },
    });

    res.json({ success: true, id: commentId });
  });

  app.get("/api/tasks/:taskId/attachments/:attachmentId/download", (req, res) => {
    const currentUser = getCurrentUser(req);
    const task = getTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: "Tarea no encontrada" });
    if (!canManageTaskCategory(currentUser, task.category)) {
      return res.status(403).json({ error: "No tienes permisos para descargar adjuntos de esta tarea" });
    }

    const attachment = db.prepare(`
      SELECT file_path, file_name, mime_type
      FROM task_attachments
      WHERE id = ? AND task_id = ?
    `).get(req.params.attachmentId, task.id) as { file_path: string, file_name: string, mime_type: string } | undefined;
    if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });

    try {
      const absolutePath = resolveStoredFile(attachment.file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Archivo no encontrado" });
      res.type(attachment.mime_type);
      res.download(absolutePath, attachment.file_name);
    } catch {
      res.status(400).json({ error: "Ruta de adjunto invalida" });
    }
  });

  app.post("/api/tasks", (req, res) => {
    const body = parseBody(createTaskSchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);
    if (!canManageTaskCategory(currentUser, body.category)) {
      return res.status(403).json({ error: "No tienes permisos para crear tareas de esta categoría" });
    }

    const assigneeValidation = validateAssigneeForTaskCategory(body.assigned_staff_id, body.category);
    if (!assigneeValidation.ok) return res.status(400).json({ error: assigneeValidation.error });
    const branchId = resolveBranchId(body.branch_id || null);

    const result = db.prepare(`
      INSERT INTO operational_tasks (
        title, description, category, priority, assigned_staff_id, branch_id, source_type, source_id, due_date, created_by_staff_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.title,
      body.description || null,
      body.category,
      body.priority,
      body.assigned_staff_id || null,
      branchId,
      body.source_type || null,
      body.source_id || null,
      body.due_date || null,
      currentUser?.id || null,
    );

    recordAuditEvent(req, {
      action: "operational_task.created",
      entityType: "operational_task",
      entityId: result.lastInsertRowid,
      metadata: body,
    });
    res.json({ success: true, task: getTask(result.lastInsertRowid) });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const body = parseBody(updateTaskSchema, req.body, res);
    if (!body) return;
    const currentUser = getCurrentUser(req);

    const existing = getTask(req.params.id);
    if (!existing) return res.status(404).json({ error: "Tarea no encontrada" });

    const next = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      category: body.category ?? existing.category,
      priority: body.priority ?? existing.priority,
      status: body.status ?? existing.status,
      assigned_staff_id: body.assigned_staff_id === undefined ? existing.assigned_staff_id : body.assigned_staff_id,
      branch_id: body.branch_id === undefined ? existing.branch_id : resolveBranchId(body.branch_id || null),
      due_date: body.due_date === undefined ? existing.due_date : body.due_date,
    };
    if (!canManageTaskCategory(currentUser, existing.category) || !canManageTaskCategory(currentUser, next.category)) {
      return res.status(403).json({ error: "No tienes permisos para modificar tareas de esta categoría" });
    }

    const assigneeValidation = validateAssigneeForTaskCategory(next.assigned_staff_id, next.category);
    if (!assigneeValidation.ok) return res.status(400).json({ error: assigneeValidation.error });

    if (body.status === "cancelled" && existing.status !== "cancelled" && !body.status_note?.trim()) {
      return res.status(400).json({ error: "Anular una tarea requiere una nota operacional" });
    }

    db.prepare(`
      UPDATE operational_tasks
      SET title = ?,
          description = ?,
          category = ?,
          priority = ?,
          status = ?,
          assigned_staff_id = ?,
          branch_id = ?,
          due_date = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      next.title,
      next.description || null,
      next.category,
      next.priority,
      next.status,
      next.assigned_staff_id || null,
      next.branch_id || null,
      next.due_date || null,
      req.params.id,
    );

    if (existing.source_type === "guard_shift_log" && existing.source_id) {
      if (next.status === "done") {
        db.prepare("UPDATE guard_shift_log_entries SET resolved_at = COALESCE(resolved_at, datetime('now')) WHERE id = ?").run(existing.source_id);
      } else if (existing.status === "done" && next.status !== "done") {
        db.prepare("UPDATE guard_shift_log_entries SET resolved_at = NULL WHERE id = ?").run(existing.source_id);
      }
    }

    recordAuditEvent(req, {
      action: "operational_task.updated",
      entityType: "operational_task",
      entityId: req.params.id,
      metadata: { previous: existing, next, status_note: body.status_note || null },
    });
    res.json({ success: true, task: getTask(req.params.id) });
  });

  app.post("/api/tasks/:id/complete", (req, res) => {
    const body = parseBody(completeTaskSchema, req.body, res);
    if (!body) return;

    const existing = getTask(req.params.id);
    if (!existing) return res.status(404).json({ error: "Tarea no encontrada" });
    const currentUser = getCurrentUser(req);
    if (!canManageTaskCategory(currentUser, existing.category)) {
      return res.status(403).json({ error: "No tienes permisos para cerrar tareas de esta categoría" });
    }
    if (existing.status === "done") return res.status(400).json({ error: "La tarea ya está cerrada" });
    if ((existing.priority === "critical" || existing.source_type === "dashboard_alert") && !body.note?.trim()) {
      return res.status(400).json({ error: "Las tareas críticas o creadas desde alertas requieren nota de cierre" });
    }

    db.prepare(`
      UPDATE operational_tasks
      SET status = 'done',
          completed_at = CURRENT_TIMESTAMP,
          completed_note = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.note || null, req.params.id);

    if (existing.source_type === "guard_shift_log" && existing.source_id) {
      db.prepare("UPDATE guard_shift_log_entries SET resolved_at = COALESCE(resolved_at, datetime('now')) WHERE id = ?").run(existing.source_id);
    }

    recordAuditEvent(req, {
      action: "operational_task.completed",
      entityType: "operational_task",
      entityId: req.params.id,
      metadata: { note: body.note || null },
    });
    res.json({ success: true, task: getTask(req.params.id) });
  });
}
