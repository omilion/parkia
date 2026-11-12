import type { AuthUser } from "../../auth/sessions";
import { db } from "../../db";

export type TaskCategory = "finance" | "access" | "documents" | "contracts" | "maintenance" | "general";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export function getStaffAssigneeFromDb(staffId: number | null | undefined, tenantId: number) {
  if (!staffId) return null;
  return db.prepare(`
    SELECT s.id, s.name, s.email, s.role, s.status
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.id = ?
      AND tm.tenant_id = ?
      AND tm.status = 'active'
  `).get(staffId, tenantId) as { id: number; name: string; email: string; role: AuthUser["role"]; status: string } | undefined;
}

export function getTaskRowByIdFromDb(id: string | number, tenantId: number) {
  return db.prepare(`
    SELECT t.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           creator.name as created_by_staff_name,
           b.name as branch_name,
           b.code as branch_code
    FROM operational_tasks t
    LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
    LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
    LEFT JOIN branches b ON b.id = t.branch_id AND b.tenant_id = t.tenant_id
    WHERE t.id = ? AND t.tenant_id = ?
  `).get(id, tenantId) as any | undefined;
}

export function listTaskAssigneesFromDb(tenantId: number) {
  return db.prepare(`
    SELECT s.id, s.name, s.email, s.role
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.status = 'active'
      AND tm.tenant_id = ?
      AND tm.status = 'active'
    ORDER BY s.name ASC
  `).all(tenantId);
}

export function getTaskSummaryCountsFromDb(
  categoryScope: { sql: string; params: Array<string | number> },
  currentUserId: number,
) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM operational_tasks
    WHERE ${categoryScope.sql}
    GROUP BY status
  `).all(...categoryScope.params) as { status: string; count: number }[];
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
  `).get(...categoryScope.params, currentUserId) as { count: number };
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

  return {
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
  };
}

export function listTasksFromDb(where: string, params: Array<string | number>) {
  return db.prepare(`
    SELECT t.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           creator.name as created_by_staff_name,
           b.name as branch_name,
           b.code as branch_code
    FROM operational_tasks t
    LEFT JOIN staff assignee ON assignee.id = t.assigned_staff_id
    LEFT JOIN staff creator ON creator.id = t.created_by_staff_id
    LEFT JOIN branches b ON b.id = t.branch_id AND b.tenant_id = t.tenant_id
    ${where}
    ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.created_at DESC
  `).all(...params);
}

export function listTaskHistoryEventsFromDb(taskId: string | number, tenantId: number) {
  return db.prepare(`
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
      AND a.tenant_id = ?
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 50
  `).all(String(taskId), tenantId);
}

export function listTaskCommentsFromDb(taskId: string | number, tenantId: number) {
  return db.prepare(`
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
    LEFT JOIN task_attachments a ON a.comment_id = c.id AND a.tenant_id = c.tenant_id
    WHERE c.task_id = ? AND c.tenant_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `).all(taskId, tenantId);
}

export function insertTaskCommentWithAttachmentInDb(params: {
  taskId: number;
  staffId: number | null;
  note: string;
  tenantId: number;
  attachment?: {
    label: string | null;
    filePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
}) {
  const tx = db.transaction(() => {
    const commentResult = db.prepare(`
      INSERT INTO task_comments (task_id, staff_id, note, tenant_id)
      VALUES (?, ?, ?, ?)
    `).run(params.taskId, params.staffId, params.note, params.tenantId);

    if (params.attachment) {
      db.prepare(`
        INSERT INTO task_attachments (
          task_id, comment_id, staff_id, label, file_path, file_name, mime_type, size_bytes, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.taskId,
        commentResult.lastInsertRowid,
        params.staffId,
        params.attachment.label,
        params.attachment.filePath,
        params.attachment.fileName,
        params.attachment.mimeType,
        params.attachment.sizeBytes,
        params.tenantId,
      );
    }

    return commentResult.lastInsertRowid;
  });

  return tx();
}

export function getTaskAttachmentFromDb(attachmentId: string | number, taskId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT file_path, file_name, mime_type
    FROM task_attachments
    WHERE id = ? AND task_id = ? AND tenant_id = ?
  `).get(attachmentId, taskId, tenantId) as { file_path: string; file_name: string; mime_type: string } | undefined;
}

export function insertTaskInDb(params: {
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  assignedStaffId: number | null;
  branchId: number | null;
  sourceType: string | null;
  sourceId: string | null;
  dueDate: string | null;
  createdByStaffId: number | null;
  tenantId: number;
}) {
  const result = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, branch_id, source_type, source_id, due_date, created_by_staff_id, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.title,
    params.description,
    params.category,
    params.priority,
    params.assignedStaffId,
    params.branchId,
    params.sourceType,
    params.sourceId,
    params.dueDate,
    params.createdByStaffId,
    params.tenantId,
  );
  return result.lastInsertRowid;
}

export function updateTaskInDb(params: {
  id: string | number;
  tenantId: number;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  assignedStaffId: number | null;
  branchId: number | null;
  dueDate: string | null;
}) {
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
    WHERE id = ? AND tenant_id = ?
  `).run(
    params.title,
    params.description,
    params.category,
    params.priority,
    params.status,
    params.assignedStaffId,
    params.branchId,
    params.dueDate,
    params.id,
    params.tenantId,
  );
}

export function syncGuardShiftLogResolutionInDb(sourceId: string | number, tenantId: number, resolved: boolean) {
  if (resolved) {
    db.prepare("UPDATE guard_shift_log_entries SET resolved_at = COALESCE(resolved_at, datetime('now')) WHERE id = ? AND tenant_id = ?")
      .run(sourceId, tenantId);
  } else {
    db.prepare("UPDATE guard_shift_log_entries SET resolved_at = NULL WHERE id = ? AND tenant_id = ?")
      .run(sourceId, tenantId);
  }
}

export function markTaskCompleteInDb(id: string | number, tenantId: number, note: string | null) {
  db.prepare(`
    UPDATE operational_tasks
    SET status = 'done',
        completed_at = CURRENT_TIMESTAMP,
        completed_note = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?
  `).run(note, id, tenantId);
}
