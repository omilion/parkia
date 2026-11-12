import { db } from "../../db";
import { likeValue, type PaginationParams } from "../../pagination";

export type DocumentEntityType = "client" | "contract" | "payment";

export function documentBranchIdSql(alias = "d") {
  return `
    CASE
      WHEN ${alias}.entity_type = 'contract' THEN (SELECT branch_id FROM contracts WHERE id = ${alias}.entity_id AND tenant_id = ${alias}.tenant_id)
      WHEN ${alias}.entity_type = 'payment' THEN (
        SELECT COALESCE(p.branch_id, c.branch_id)
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id AND c.tenant_id = p.tenant_id
        WHERE p.id = ${alias}.entity_id AND p.tenant_id = ${alias}.tenant_id
      )
      WHEN ${alias}.entity_type = 'client' THEN (
        SELECT c.branch_id
        FROM contracts c
        WHERE c.client_id = ${alias}.entity_id AND c.tenant_id = ${alias}.tenant_id AND c.branch_id IS NOT NULL
        ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, c.id DESC
        LIMIT 1
      )
    END
  `;
}

export function documentBranchFilterSql(branchId: number | null, alias = "d") {
  if (!branchId) return { sql: "", params: [] as number[] };
  return {
    sql: `(
      (${alias}.entity_type = 'contract' AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = ${alias}.entity_id AND c.tenant_id = ${alias}.tenant_id AND c.branch_id = ?))
      OR (${alias}.entity_type = 'payment' AND EXISTS (
        SELECT 1
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id AND c.tenant_id = p.tenant_id
        WHERE p.id = ${alias}.entity_id AND p.tenant_id = ${alias}.tenant_id AND COALESCE(p.branch_id, c.branch_id) = ?
      ))
      OR (${alias}.entity_type = 'client' AND EXISTS (
        SELECT 1
        FROM contracts c
        WHERE c.client_id = ${alias}.entity_id AND c.tenant_id = ${alias}.tenant_id AND c.branch_id = ?
      ))
    )`,
    params: [branchId, branchId, branchId],
  };
}

export async function entityExistsInDb(entityType: DocumentEntityType, entityId: number, tenantId: number) {
  if (entityType === "client") {
    return Boolean(await db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(entityId, tenantId));
  }
  if (entityType === "contract") {
    return Boolean(await db.prepare("SELECT id FROM contracts WHERE id = ? AND tenant_id = ?").get(entityId, tenantId));
  }
  return Boolean(await db.prepare("SELECT id FROM payments WHERE id = ? AND tenant_id = ?").get(entityId, tenantId));
}

export async function getDocumentFromDb(id: number, tenantId: number) {
  return await db.prepare(`
    SELECT d.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           branch.id as branch_id,
           branch.name as branch_name,
           branch.code as branch_code
    FROM documents d
    LEFT JOIN staff assignee ON assignee.id = d.assigned_staff_id
    LEFT JOIN branches branch ON branch.id = ${documentBranchIdSql("d")}
    WHERE d.id = ? AND d.tenant_id = ?
  `).get(id, tenantId) as any | undefined;
}

export async function findActiveDocumentFollowUpTask(documentId: number, tenantId: number) {
  return await db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'document'
      AND source_id = ?
      AND tenant_id = ?
      AND status IN ('open', 'in_progress')
    ORDER BY id DESC
    LIMIT 1
  `).get(String(documentId), tenantId) as { id: number } | undefined;
}

export async function updateDocumentFollowUpTaskInDb(
  taskId: number,
  tenantId: number,
  input: {
    title: string;
    description: string;
    priority: string;
    assignedStaffId: number | null;
    branchId: number | null;
    dueDate: string;
  }
) {
  await db.prepare(`
    UPDATE operational_tasks
    SET title = ?,
        description = ?,
        priority = ?,
        assigned_staff_id = ?,
        branch_id = ?,
        due_date = ?,
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(
    input.title,
    input.description,
    input.priority,
    input.assignedStaffId,
    input.branchId,
    input.dueDate,
    taskId,
    tenantId
  );
}

export async function insertDocumentFollowUpTaskInDb(
  documentId: number,
  tenantId: number,
  createdByStaffId: number | null,
  input: {
    title: string;
    description: string;
    priority: string;
    assignedStaffId: number | null;
    branchId: number | null;
    dueDate: string;
  }
) {
  const result = await db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, branch_id, source_type, source_id, due_date, created_by_staff_id, tenant_id
    ) VALUES (?, ?, 'documents', ?, ?, ?, 'document', ?, ?, ?, ?)
  `).run(
    input.title,
    input.description,
    input.priority,
    input.assignedStaffId,
    input.branchId,
    String(documentId),
    input.dueDate,
    createdByStaffId,
    tenantId
  );
  return result.lastInsertRowid;
}

export async function listActiveDocumentFollowUpTasks(documentId: number, tenantId: number) {
  return await db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'document'
      AND source_id = ?
      AND tenant_id = ?
      AND status IN ('open', 'in_progress')
  `).all(String(documentId), tenantId) as { id: number }[];
}

export async function completeDocumentFollowUpTaskInDb(taskId: number, tenantId: number) {
  await db.prepare(`
    UPDATE operational_tasks
    SET status = 'done',
        completed_at = datetime('now'),
        completed_note = 'Documento aprobado o resuelto desde seguimiento documental',
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).run(taskId, tenantId);
}

export async function listDocumentAssigneesFromDb(tenantId: number) {
  return await db.prepare(`
    SELECT s.id, s.name, s.email, s.role
    FROM staff s
    JOIN tenant_memberships tm ON tm.staff_id = s.id
    WHERE s.status = 'active'
      AND s.role IN ('admin', 'finance')
      AND tm.tenant_id = ?
      AND tm.status = 'active'
    ORDER BY s.name ASC
  `).all(tenantId);
}

export async function queryDocumentReviewFromDb(params: {
  tenantId: number;
  scope: "all" | "critical";
  status: string | null;
  documentType: string | null;
  search: string;
  branchId: number | null;
  pagination: PaginationParams;
}) {
  const { tenantId, scope, status, documentType, search, branchId, pagination } = params;
  const conditions = scope === "all"
    ? ["d.tenant_id = ?"]
    : ["d.tenant_id = ?", "(d.status IN ('pending', 'rejected', 'expired') OR (d.expires_at IS NOT NULL AND date(d.expires_at) <= date('now', '+30 day') AND d.status != 'approved'))"];
  const sqlParams: any[] = [tenantId];
  const branchFilter = documentBranchFilterSql(branchId);

  if (status) {
    conditions[0] = "d.status = ?";
    sqlParams.push(status);
  }
  if (documentType) {
    conditions.push("d.document_type = ?");
    sqlParams.push(documentType);
  }
  if (search) {
    const like = likeValue(search);
    conditions.push(`(
      d.label LIKE ? OR d.file_name LIKE ? OR COALESCE(d.notes, '') LIKE ?
      OR COALESCE(c.name, '') LIKE ? OR COALESCE(cc.name, '') LIKE ? OR COALESCE(pc.name, '') LIKE ?
      OR CAST(d.entity_id AS TEXT) LIKE ?
    )`);
    sqlParams.push(like, like, like, like, like, like, like);
  }
  if (branchFilter.sql) {
    conditions.push(branchFilter.sql);
    sqlParams.push(...branchFilter.params);
  }

  const total = Number((await db.prepare(`
    SELECT COUNT(*) as count
    FROM documents d
    LEFT JOIN clients c ON d.entity_type = 'client' AND c.id = d.entity_id AND c.tenant_id = d.tenant_id
    LEFT JOIN contracts con ON d.entity_type = 'contract' AND con.id = d.entity_id AND con.tenant_id = d.tenant_id
    LEFT JOIN clients cc ON cc.id = con.client_id AND cc.tenant_id = d.tenant_id
    LEFT JOIN payments p ON d.entity_type = 'payment' AND p.id = d.entity_id AND p.tenant_id = d.tenant_id
    LEFT JOIN contracts pc_con ON pc_con.id = p.contract_id AND pc_con.tenant_id = d.tenant_id
    LEFT JOIN clients pc ON pc.id = pc_con.client_id AND pc.tenant_id = d.tenant_id
    WHERE ${conditions.join(" AND ")}
  `).get(...sqlParams) as { count: number }).count || 0);

  let documentsQuery = `
    SELECT d.id,
           d.entity_type,
           d.entity_id,
           d.label,
           d.document_type,
           d.status,
           d.expires_at,
           d.notes,
           d.file_name,
           d.mime_type,
           d.size_bytes,
           d.created_at,
           d.assigned_staff_id,
           d.next_action_at,
           d.reviewed_by_staff_id,
           d.reviewed_at,
           d.rejection_reason,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           branch.id as branch_id,
           branch.name as branch_name,
           branch.code as branch_code,
           CASE
             WHEN d.entity_type = 'client' THEN c.name
             WHEN d.entity_type = 'contract' THEN cc.name
             WHEN d.entity_type = 'payment' THEN pc.name
           END AS client_name,
           CASE
             WHEN d.entity_type = 'contract' THEN d.entity_id
             WHEN d.entity_type = 'payment' THEN p.contract_id
           END AS contract_id_display
    FROM documents d
    LEFT JOIN clients c ON d.entity_type = 'client' AND c.id = d.entity_id AND c.tenant_id = d.tenant_id
    LEFT JOIN contracts con ON d.entity_type = 'contract' AND con.id = d.entity_id AND con.tenant_id = d.tenant_id
    LEFT JOIN clients cc ON cc.id = con.client_id AND cc.tenant_id = d.tenant_id
    LEFT JOIN payments p ON d.entity_type = 'payment' AND p.id = d.entity_id AND p.tenant_id = d.tenant_id
    LEFT JOIN contracts pc_con ON pc_con.id = p.contract_id AND pc_con.tenant_id = d.tenant_id
    LEFT JOIN clients pc ON pc.id = pc_con.client_id AND pc.tenant_id = d.tenant_id
    LEFT JOIN staff assignee ON assignee.id = d.assigned_staff_id
    LEFT JOIN branches branch ON branch.id = ${documentBranchIdSql("d")}
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      d.next_action_at IS NULL,
      d.next_action_at ASC,
      CASE d.status
        WHEN 'pending' THEN 0
        WHEN 'rejected' THEN 1
        WHEN 'expired' THEN 2
        ELSE 3
      END,
      d.expires_at IS NULL,
      d.expires_at ASC,
      d.created_at DESC
  `;
  const listParams = [...sqlParams];
  if (pagination.requested) {
    documentsQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const documents = await db.prepare(documentsQuery).all(...listParams);

  const summary = await db.prepare(`
    SELECT status, COUNT(*) as count
    FROM documents d
    WHERE d.tenant_id = ?
      AND status IN ('pending', 'rejected', 'expired')
      ${branchFilter.sql ? `AND ${branchFilter.sql}` : ""}
    GROUP BY status
  `).all(tenantId, ...branchFilter.params) as { status: string; count: number }[];

  const expiringSoon = await db.prepare(`
    SELECT COUNT(*) as count
    FROM documents d
    WHERE d.tenant_id = ?
      AND expires_at IS NOT NULL
      AND date(expires_at) > date('now')
      AND date(expires_at) <= date('now', '+30 day')
      AND status != 'approved'
      ${branchFilter.sql ? `AND ${branchFilter.sql}` : ""}
  `).get(tenantId, ...branchFilter.params) as { count: number };

  return {
    documents,
    total,
    summary: {
      pending: summary.find(item => item.status === "pending")?.count || 0,
      rejected: summary.find(item => item.status === "rejected")?.count || 0,
      expired: summary.find(item => item.status === "expired")?.count || 0,
      expiringSoon: expiringSoon.count || 0,
    },
  };
}

export async function getDocumentFileMetadataFromDb(id: number, tenantId: number) {
  return await db.prepare(`
    SELECT file_path, file_name, mime_type
    FROM documents
    WHERE id = ? AND tenant_id = ?
  `).get(id, tenantId) as { file_path: string; file_name: string; mime_type: string } | undefined;
}

export async function listDocumentsByEntityFromDb(entityType: DocumentEntityType, entityId: number, tenantId: number) {
  return await db.prepare(`
    SELECT d.id, d.entity_type, d.entity_id, d.label, d.document_type, d.status, d.expires_at, d.notes,
           d.assigned_staff_id, d.next_action_at, d.reviewed_by_staff_id, d.reviewed_at, d.rejection_reason,
           d.file_name, d.mime_type, d.size_bytes, d.created_at,
           branch.id as branch_id,
           branch.name as branch_name,
           branch.code as branch_code
    FROM documents d
    LEFT JOIN branches branch ON branch.id = ${documentBranchIdSql("d")}
    WHERE d.entity_type = ? AND d.entity_id = ? AND d.tenant_id = ?
    ORDER BY
      CASE d.status
        WHEN 'pending' THEN 0
        WHEN 'rejected' THEN 1
        WHEN 'expired' THEN 2
        ELSE 3
      END,
      d.expires_at IS NULL,
      d.expires_at ASC,
      d.created_at DESC
  `).all(entityType, entityId, tenantId);
}

export async function insertDocumentInDb(
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
  },
  stored: { filePath: string; fileName: string; mimeType: string; sizeBytes: number }
) {
  const result = await db.prepare(`
    INSERT INTO documents (
      entity_type, entity_id, label, document_type, status, expires_at, notes,
      assigned_staff_id, next_action_at, file_path, file_name, mime_type, size_bytes, tenant_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entityType,
    entityId,
    body.label,
    body.document_type ?? "other",
    body.status ?? "received",
    body.expires_at ?? null,
    body.notes ?? null,
    body.assigned_staff_id || null,
    body.next_action_at ?? null,
    stored.filePath,
    stored.fileName,
    stored.mimeType,
    stored.sizeBytes,
    tenantId
  );
  return result.lastInsertRowid;
}

export async function updateDocumentInDb(
  documentId: number,
  tenantId: number,
  reviewedByStaffId: number | null,
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
) {
  await db.prepare(`
    UPDATE documents
    SET label = COALESCE(?, label),
        document_type = COALESCE(?, document_type),
        status = COALESCE(?, status),
        expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
        notes = CASE WHEN ? THEN ? ELSE notes END,
        assigned_staff_id = CASE WHEN ? THEN ? ELSE assigned_staff_id END,
        next_action_at = CASE WHEN ? THEN ? ELSE next_action_at END,
        rejection_reason = CASE WHEN ? THEN ? ELSE rejection_reason END,
        reviewed_by_staff_id = CASE WHEN ? THEN ? ELSE reviewed_by_staff_id END,
        reviewed_at = CASE WHEN ? THEN datetime('now') ELSE reviewed_at END
    WHERE id = ? AND tenant_id = ?
  `).run(
    body.label ?? null,
    body.document_type ?? null,
    body.status ?? null,
    Object.prototype.hasOwnProperty.call(body, "expires_at") ? 1 : 0,
    body.expires_at ?? null,
    Object.prototype.hasOwnProperty.call(body, "notes") ? 1 : 0,
    body.notes ?? null,
    Object.prototype.hasOwnProperty.call(body, "assigned_staff_id") ? 1 : 0,
    body.assigned_staff_id || null,
    Object.prototype.hasOwnProperty.call(body, "next_action_at") ? 1 : 0,
    body.next_action_at ?? null,
    Object.prototype.hasOwnProperty.call(body, "rejection_reason") || body.status === "rejected" ? 1 : 0,
    body.rejection_reason || body.notes || null,
    body.status ? 1 : 0,
    reviewedByStaffId,
    body.status ? 1 : 0,
    documentId,
    tenantId
  );
}

