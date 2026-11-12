import { db } from "../../db";

export async function findDefaultAssigneeByRoleInTenant(role: "finance" | "admin", tenantId: number): Promise<number | null> {
  const row = await db.prepare(`
    SELECT s.id
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.role = ?
      AND s.status = 'active'
      AND tm.tenant_id = ?
      AND tm.status = 'active'
    ORDER BY s.id ASC
    LIMIT 1
  `).get(role, tenantId) as { id: number } | undefined;
  return row?.id || null;
}

export async function insertShiftFollowUpOperationalTask(params: {
  title: string;
  description: string;
  category: string;
  priority: string;
  assigneeId: number | null;
  branchId: number | null;
  entryId: number;
  dueDate: string;
  createdByStaffId: number | null;
  tenantId: number;
}): Promise<number> {
  const taskResult = await db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, branch_id, source_type, source_id, due_date, created_by_staff_id, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, 'guard_shift_log', ?, ?, ?, ?)
  `).run(
    params.title,
    params.description,
    params.category,
    params.priority,
    params.assigneeId,
    params.branchId,
    String(params.entryId),
    params.dueDate,
    params.createdByStaffId,
    params.tenantId,
  );
  await db.prepare("UPDATE guard_shift_log_entries SET task_id = ? WHERE id = ? AND tenant_id = ?").run(
    taskResult.lastInsertRowid,
    params.entryId,
    params.tenantId,
  );
  return Number(taskResult.lastInsertRowid);
}

export async function findShiftLogById(id: string | number, tenantId: number): Promise<Record<string, any> | undefined> {
  return await db.prepare(`
    SELECT l.*,
           s.name as staff_name,
           s.email as staff_email,
           b.name as branch_name,
           b.code as branch_code,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id) as entries_count,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
    FROM guard_shift_logs l
    JOIN staff s ON s.id = l.staff_id
    LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = l.tenant_id
    WHERE l.id = ? AND l.tenant_id = ?
  `).get(id, tenantId) as Record<string, any> | undefined;
}

export async function queryShiftLogsForTenant(params: {
  tenantId: number;
  status: "open" | "closed" | "all";
  date?: string;
  branchId?: number;
}): Promise<Record<string, any>[]> {
  let where = "WHERE l.tenant_id = ?";
  const sqlParams: Array<string | number> = [params.tenantId];
  if (params.status !== "all") {
    where += " AND l.status = ?";
    sqlParams.push(params.status);
  }
  if (params.date) {
    where += " AND l.shift_date = ?";
    sqlParams.push(params.date);
  }
  if (params.branchId) {
    where += " AND l.branch_id = ?";
    sqlParams.push(params.branchId);
  }

  return await db.prepare(`
    SELECT l.*,
           s.name as staff_name,
           s.email as staff_email,
           b.name as branch_name,
           b.code as branch_code,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id) as entries_count,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
    FROM guard_shift_logs l
    JOIN staff s ON s.id = l.staff_id
    LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = l.tenant_id
    ${where}
    ORDER BY l.opened_at DESC
    LIMIT 50
  `).all(...sqlParams) as Record<string, any>[];
}

export async function findCurrentOpenShiftLogForStaff(
  staffId: number,
  tenantId: number,
  branchId: number | null,
): Promise<Record<string, any> | undefined> {
  return await db.prepare(`
    SELECT l.*,
           s.name as staff_name,
           s.email as staff_email,
           b.name as branch_name,
           b.code as branch_code,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id) as entries_count,
           (SELECT COUNT(*) FROM guard_shift_log_entries e WHERE e.shift_log_id = l.id AND e.tenant_id = l.tenant_id AND e.follow_up_required = 1 AND e.resolved_at IS NULL) as pending_follow_ups
    FROM guard_shift_logs l
    JOIN staff s ON s.id = l.staff_id
    LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = l.tenant_id
    WHERE l.staff_id = ? AND l.status = 'open' AND l.tenant_id = ?
      ${branchId ? "AND l.branch_id = ?" : ""}
    ORDER BY l.opened_at DESC
    LIMIT 1
  `).get(...(branchId ? [staffId, tenantId, branchId] : [staffId, tenantId])) as Record<string, any> | undefined;
}

export async function queryShiftFollowUpEntries(params: {
  tenantId: number;
  status: "open" | "resolved" | "all";
  branchId?: number;
  forExport?: boolean;
}): Promise<Record<string, any>[]> {
  let where = "WHERE e.follow_up_required = 1 AND e.tenant_id = ?";
  const sqlParams: Array<string | number> = [params.tenantId];
  if (params.status === "open") {
    where += " AND e.resolved_at IS NULL";
  } else if (params.status === "resolved") {
    where += " AND e.resolved_at IS NOT NULL";
  }
  if (params.branchId) {
    where += " AND l.branch_id = ?";
    sqlParams.push(params.branchId);
  }

  if (params.forExport) {
    return await db.prepare(`
      SELECT e.id,
             l.id as shift_log_id,
             l.shift_date,
             l.shift_name,
             l.status as shift_status,
             b.name as branch_name,
             e.category,
             e.priority,
             e.title,
             e.detail,
             e.created_at,
             e.resolved_at,
             e.task_id,
             t.status as task_status,
             sp.name as related_space_name,
             author.name as staff_name,
             owner.name as shift_staff_name
      FROM guard_shift_log_entries e
      JOIN guard_shift_logs l ON l.id = e.shift_log_id AND l.tenant_id = e.tenant_id
      JOIN staff author ON author.id = e.staff_id
      JOIN staff owner ON owner.id = l.staff_id
      LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = e.tenant_id
      LEFT JOIN spaces sp ON sp.id = e.related_space_id AND sp.tenant_id = e.tenant_id
      LEFT JOIN operational_tasks t ON t.id = e.task_id AND t.tenant_id = e.tenant_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT 500
    `).all(...sqlParams) as Record<string, any>[];
  }

  return await db.prepare(`
    SELECT e.*,
           author.name as staff_name,
           sp.name as related_space_name,
           t.status as task_status,
           t.title as task_title,
           (SELECT COUNT(*) FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id) as attachment_count,
           (SELECT id FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id ORDER BY a.id DESC LIMIT 1) as attachment_id,
           (SELECT file_name FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id ORDER BY a.id DESC LIMIT 1) as attachment_file_name,
           l.shift_date,
           l.shift_name,
           l.status as shift_status,
           l.branch_id,
           b.name as branch_name,
           b.code as branch_code,
           owner.name as shift_staff_name
    FROM guard_shift_log_entries e
    JOIN guard_shift_logs l ON l.id = e.shift_log_id AND l.tenant_id = e.tenant_id
    JOIN staff author ON author.id = e.staff_id
    JOIN staff owner ON owner.id = l.staff_id
    LEFT JOIN branches b ON b.id = l.branch_id AND b.tenant_id = e.tenant_id
    LEFT JOIN spaces sp ON sp.id = e.related_space_id AND sp.tenant_id = e.tenant_id
    LEFT JOIN operational_tasks t ON t.id = e.task_id AND t.tenant_id = e.tenant_id
    ${where}
    ORDER BY
      CASE e.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      e.created_at DESC
    LIMIT 100
  `).all(...sqlParams) as Record<string, any>[];
}

export async function linkCashSessionToShiftLog(params: {
  shiftLogId: string | number;
  cashSessionId: number;
  branchId: number | null;
  tenantId: number;
}): Promise<void> {
  if (params.branchId) {
    await db.prepare(
      "UPDATE cash_sessions SET shift_log_id = COALESCE(shift_log_id, ?), branch_id = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
    ).run(params.shiftLogId, params.branchId, params.cashSessionId, params.tenantId);
  }
  await db.prepare("UPDATE guard_shift_logs SET cash_session_id = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(
    params.cashSessionId,
    params.shiftLogId,
    params.tenantId,
  );
}

export async function queryEntriesForShiftLog(
  shiftLogId: string | number,
  tenantId: number,
  ascending = false,
): Promise<Record<string, any>[]> {
  return await db.prepare(`
    SELECT e.*,
           s.name as staff_name,
           sp.name as related_space_name,
           t.status as task_status,
           t.title as task_title,
           (SELECT COUNT(*) FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id) as attachment_count,
           (SELECT id FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id ORDER BY a.id DESC LIMIT 1) as attachment_id,
           (SELECT file_name FROM shift_log_entry_attachments a WHERE a.shift_log_entry_id = e.id AND a.tenant_id = e.tenant_id ORDER BY a.id DESC LIMIT 1) as attachment_file_name
    FROM guard_shift_log_entries e
    JOIN staff s ON s.id = e.staff_id
    LEFT JOIN spaces sp ON sp.id = e.related_space_id AND sp.tenant_id = e.tenant_id
    LEFT JOIN operational_tasks t ON t.id = e.task_id AND t.tenant_id = e.tenant_id
    WHERE e.shift_log_id = ? AND e.tenant_id = ?
    ORDER BY e.created_at ${ascending ? "ASC" : "DESC"}
  `).all(shiftLogId, tenantId) as Record<string, any>[];
}

export async function findExistingOpenShiftLogId(
  staffId: number,
  branchId: number,
  tenantId: number,
): Promise<{ id: number } | undefined> {
  return await db.prepare(`
    SELECT id FROM guard_shift_logs
    WHERE staff_id = ? AND status = 'open' AND branch_id = ? AND tenant_id = ?
    ORDER BY opened_at DESC
    LIMIT 1
  `).get(staffId, branchId, tenantId) as { id: number } | undefined;
}

export async function insertShiftLogRow(params: {
  staffId: number | null;
  shiftDate: string;
  shiftName: string;
  openingNotes: string | null;
  branchId: number;
  tenantId: number;
}): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO guard_shift_logs (staff_id, shift_date, shift_name, opening_notes, branch_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    params.staffId,
    params.shiftDate,
    params.shiftName,
    params.openingNotes,
    params.branchId,
    params.tenantId,
  );
  return Number(result.lastInsertRowid);
}

export async function insertShiftLogEntryRow(params: {
  shiftLogId: string | number;
  staffId: number | null;
  category: string;
  priority: string;
  title: string;
  detail: string | null;
  relatedSpaceId: number | null;
  relatedAccessLogId: number | null;
  followUpRequired: boolean;
  tenantId: number;
}): Promise<number> {
  const entryResult = await db.prepare(`
    INSERT INTO guard_shift_log_entries (
      shift_log_id, staff_id, category, priority, title, detail,
      related_space_id, related_access_log_id, follow_up_required, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.shiftLogId,
    params.staffId,
    params.category,
    params.priority,
    params.title,
    params.detail,
    params.relatedSpaceId,
    params.relatedAccessLogId,
    params.followUpRequired ? 1 : 0,
    params.tenantId,
  );
  return Number(entryResult.lastInsertRowid);
}

export async function insertShiftEntryAttachmentRow(params: {
  shiftLogEntryId: number;
  staffId: number | null;
  label: string | null;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tenantId: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO shift_log_entry_attachments (
      shift_log_entry_id, staff_id, label, file_path, file_name, mime_type, size_bytes, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.shiftLogEntryId,
    params.staffId,
    params.label,
    params.filePath,
    params.fileName,
    params.mimeType,
    params.sizeBytes,
    params.tenantId,
  );
}

export async function touchShiftLogUpdatedAt(shiftLogId: string | number, tenantId: number): Promise<void> {
  await db.prepare("UPDATE guard_shift_logs SET updated_at = datetime('now') WHERE id = ? AND tenant_id = ?").run(
    shiftLogId,
    tenantId,
  );
}

export async function findShiftLogEntryAttachment(
  attachmentId: string,
  entryId: string,
  tenantId: number,
): Promise<{ file_path: string; file_name: string; mime_type: string } | undefined> {
  return await db.prepare(`
    SELECT a.file_path, a.file_name, a.mime_type
    FROM shift_log_entry_attachments a
    JOIN guard_shift_log_entries e ON e.id = a.shift_log_entry_id
    WHERE a.id = ? AND a.shift_log_entry_id = ? AND a.tenant_id = ? AND e.tenant_id = ?
  `).get(attachmentId, entryId, tenantId, tenantId) as
    | { file_path: string; file_name: string; mime_type: string }
    | undefined;
}

export async function findShiftLogEntryById(entryId: string | number, tenantId: number) {
  return await db
    .prepare("SELECT * FROM guard_shift_log_entries WHERE id = ? AND tenant_id = ?")
    .get(entryId, tenantId) as Record<string, any> | undefined;
}

export async function findOperationalTaskCategoryStatus(taskId: number, tenantId: number) {
  return await db
    .prepare("SELECT category, status FROM operational_tasks WHERE id = ? AND tenant_id = ?")
    .get(taskId, tenantId) as { category: string; status: string } | undefined;
}

export async function resolveOrReopenShiftLogEntryInDb(params: {
  entryId: string | number;
  shiftLogId: number;
  taskId: number | null;
  resolved: boolean;
  tenantId: number;
}): Promise<void> {
  await db.prepare(`
    UPDATE guard_shift_log_entries
    SET resolved_at = ?
    WHERE id = ? AND tenant_id = ?
  `).run(params.resolved ? new Date().toISOString().replace("T", " ").slice(0, 19) : null, params.entryId, params.tenantId);

  if (params.taskId) {
    if (params.resolved) {
      await db.prepare(`
        UPDATE operational_tasks
        SET status = 'done',
            completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
            completed_note = COALESCE(completed_note, 'Resuelto desde bitácora de turno'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ? AND status != 'cancelled'
      `).run(params.taskId, params.tenantId);
    } else {
      await db.prepare(`
        UPDATE operational_tasks
        SET status = 'open',
            completed_at = NULL,
            completed_note = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND tenant_id = ? AND status = 'done'
      `).run(params.taskId, params.tenantId);
    }
  }
  await touchShiftLogUpdatedAt(params.shiftLogId, params.tenantId);
}

export async function markShiftLogClosedRow(params: {
  shiftLogId: string | number;
  handoverNotes: string;
  cashCountNote: string | null;
  tenantId: number;
}): Promise<void> {
  await db.prepare(`
    UPDATE guard_shift_logs
    SET status = 'closed',
        handover_notes = ?,
        cash_count_note = ?,
        closed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
      AND tenant_id = ?
  `).run(params.handoverNotes, params.cashCountNote, params.shiftLogId, params.tenantId);
}

