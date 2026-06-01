import type { Express } from "express";
import { existsSync } from "fs";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { getBranchOrDefault } from "../branches";
import { db } from "../db";
import { likeValue, parsePagination, queryText } from "../pagination";
import { resolveStoredFile, storeDocumentFile } from "../storage";
import { dateStringSchema, optionalTextSchema, parseBody } from "../validation";

const entityTypeSchema = z.enum(["client", "contract", "payment"]);
const documentTypeSchema = z.enum(["contract", "identity", "mandate", "receipt", "other"]);
const documentStatusSchema = z.enum(["pending", "received", "approved", "rejected", "expired"]);

const nullableDateSchema = z.union([dateStringSchema, z.literal("")]).nullable().optional()
  .transform(value => value || null);

const uploadDocumentSchema = z.object({
  label: z.string().trim().min(1).max(120),
  document_type: documentTypeSchema.default("other"),
  status: documentStatusSchema.default("received"),
  expires_at: nullableDateSchema,
  notes: optionalTextSchema,
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  next_action_at: nullableDateSchema,
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  dataBase64: z.string().trim().min(1),
});

const updateDocumentSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  document_type: documentTypeSchema.optional(),
  status: documentStatusSchema.optional(),
  expires_at: nullableDateSchema,
  notes: optionalTextSchema,
  assigned_staff_id: z.coerce.number().int().positive().optional().nullable(),
  next_action_at: nullableDateSchema,
  rejection_reason: optionalTextSchema,
});

function entityExists(entityType: z.infer<typeof entityTypeSchema>, entityId: number) {
  if (entityType === "client") {
    return Boolean(db.prepare("SELECT id FROM clients WHERE id = ?").get(entityId));
  }
  if (entityType === "contract") {
    return Boolean(db.prepare("SELECT id FROM contracts WHERE id = ?").get(entityId));
  }
  return Boolean(db.prepare("SELECT id FROM payments WHERE id = ?").get(entityId));
}

function getDocument(id: number) {
  return db.prepare(`
    SELECT d.*,
           assignee.name as assigned_staff_name,
           assignee.email as assigned_staff_email,
           branch.id as branch_id,
           branch.name as branch_name,
           branch.code as branch_code
    FROM documents d
    LEFT JOIN staff assignee ON assignee.id = d.assigned_staff_id
    LEFT JOIN branches branch ON branch.id = ${documentBranchIdSql("d")}
    WHERE d.id = ?
  `).get(id) as any | undefined;
}

function parseBranchIdQuery(value: unknown) {
  if (value === undefined || value === null || value === "" || value === "all") return null;
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? getBranchOrDefault(branchId) : null;
}

function documentBranchIdSql(alias = "d") {
  return `
    CASE
      WHEN ${alias}.entity_type = 'contract' THEN (SELECT branch_id FROM contracts WHERE id = ${alias}.entity_id)
      WHEN ${alias}.entity_type = 'payment' THEN (
        SELECT COALESCE(p.branch_id, c.branch_id)
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        WHERE p.id = ${alias}.entity_id
      )
      WHEN ${alias}.entity_type = 'client' THEN (
        SELECT c.branch_id
        FROM contracts c
        WHERE c.client_id = ${alias}.entity_id AND c.branch_id IS NOT NULL
        ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END, c.id DESC
        LIMIT 1
      )
    END
  `;
}

function documentBranchFilterSql(branchId: number | null, alias = "d") {
  if (!branchId) return { sql: "", params: [] as number[] };
  return {
    sql: `(
      (${alias}.entity_type = 'contract' AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = ${alias}.entity_id AND c.branch_id = ?))
      OR (${alias}.entity_type = 'payment' AND EXISTS (
        SELECT 1
        FROM payments p
        LEFT JOIN contracts c ON c.id = p.contract_id
        WHERE p.id = ${alias}.entity_id AND COALESCE(p.branch_id, c.branch_id) = ?
      ))
      OR (${alias}.entity_type = 'client' AND EXISTS (
        SELECT 1
        FROM contracts c
        WHERE c.client_id = ${alias}.entity_id AND c.branch_id = ?
      ))
    )`,
    params: [branchId, branchId, branchId],
  };
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
    dueDate: document.next_action_at || document.expires_at || new Date().toISOString().slice(0, 10),
  };
}

function ensureDocumentFollowUpTask(req: any, documentId: number, reason?: string | null) {
  const document = getDocument(documentId);
  if (!document || !["pending", "rejected", "expired"].includes(document.status)) return;
  const task = buildDocumentFollowUpTask(document, reason);

  const existing = db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'document'
      AND source_id = ?
      AND status IN ('open', 'in_progress')
    ORDER BY id DESC
    LIMIT 1
  `).get(String(documentId)) as { id: number } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE operational_tasks
      SET title = ?,
          description = ?,
          priority = ?,
          assigned_staff_id = ?,
          branch_id = ?,
          due_date = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      task.title,
      task.description,
      task.priority,
      task.assignedStaffId,
      document.branch_id || null,
      task.dueDate,
      existing.id,
    );

    recordAuditEvent(req, {
      action: "document.follow_up_task_synced",
      entityType: "operational_task",
      entityId: existing.id,
      metadata: { document_id: documentId, status: document.status, reason: reason || null },
    });
    return;
  }

  const result = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, assigned_staff_id, branch_id, source_type, source_id, due_date, created_by_staff_id
    ) VALUES (?, ?, 'documents', ?, ?, ?, 'document', ?, ?, ?)
  `).run(
    task.title,
    task.description,
    task.priority,
    task.assignedStaffId,
    document.branch_id || null,
    String(documentId),
    task.dueDate,
    getCurrentUser(req)?.id || null,
  );

  recordAuditEvent(req, {
    action: "document.follow_up_task_created",
    entityType: "operational_task",
    entityId: result.lastInsertRowid,
    metadata: { document_id: documentId, status: document.status, reason: reason || null },
  });
}

function closeDocumentFollowUpTasks(req: any, documentId: number) {
  const activeTasks = db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'document'
      AND source_id = ?
      AND status IN ('open', 'in_progress')
  `).all(String(documentId)) as { id: number }[];

  for (const task of activeTasks) {
    db.prepare(`
      UPDATE operational_tasks
      SET status = 'done',
          completed_at = datetime('now'),
          completed_note = 'Documento aprobado o resuelto desde seguimiento documental',
          updated_at = datetime('now')
      WHERE id = ?
    `).run(task.id);
    recordAuditEvent(req, {
      action: "operational_task.completed",
      entityType: "operational_task",
      entityId: task.id,
      metadata: { note: "Cierre automatico por documento aprobado", document_id: documentId },
    });
  }
}

export function registerDocumentsRoutes(app: Express) {
  app.use("/api/documents", requireAnyRole(["admin", "finance"]));

  app.get("/api/documents/assignees", (_req, res) => {
    const staff = db.prepare(`
      SELECT id, name, email, role
      FROM staff
      WHERE status = 'active' AND role IN ('admin', 'finance')
      ORDER BY name ASC
    `).all();
    res.json(staff);
  });

  app.get("/api/documents/review", (req, res) => {
    const status = req.query.status ? documentStatusSchema.safeParse(req.query.status) : null;
    const documentType = req.query.type ? documentTypeSchema.safeParse(req.query.type) : null;
    if (status && !status.success) return res.status(400).json({ error: "Estado inválido" });
    if (documentType && !documentType.success) return res.status(400).json({ error: "Tipo inválido" });

    const scope = queryText(req.query.scope) === "all" ? "all" : "critical";
    const search = queryText(req.query.search);
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const conditions = scope === "all"
      ? ["1=1"]
      : ["(d.status IN ('pending', 'rejected', 'expired') OR (d.expires_at IS NOT NULL AND date(d.expires_at) <= date('now', '+30 day') AND d.status != 'approved'))"];
    const params: any[] = [];
    const branchFilter = documentBranchFilterSql(branchId);
    if (status?.success) {
      conditions[0] = "d.status = ?";
      params.push(status.data);
    }
    if (documentType?.success) {
      conditions.push("d.document_type = ?");
      params.push(documentType.data);
    }
    if (search) {
      const like = likeValue(search);
      conditions.push(`(
        d.label LIKE ? OR d.file_name LIKE ? OR COALESCE(d.notes, '') LIKE ?
        OR COALESCE(c.name, '') LIKE ? OR COALESCE(cc.name, '') LIKE ? OR COALESCE(pc.name, '') LIKE ?
        OR CAST(d.entity_id AS TEXT) LIKE ?
      )`);
      params.push(like, like, like, like, like, like, like);
    }
    if (branchFilter.sql) {
      conditions.push(branchFilter.sql);
      params.push(...branchFilter.params);
    }

    const total = Number((db.prepare(`
      SELECT COUNT(*) as count
      FROM documents d
      LEFT JOIN clients c ON d.entity_type = 'client' AND c.id = d.entity_id
      LEFT JOIN contracts con ON d.entity_type = 'contract' AND con.id = d.entity_id
      LEFT JOIN clients cc ON cc.id = con.client_id
      LEFT JOIN payments p ON d.entity_type = 'payment' AND p.id = d.entity_id
      LEFT JOIN contracts pc_con ON pc_con.id = p.contract_id
      LEFT JOIN clients pc ON pc.id = pc_con.client_id
      WHERE ${conditions.join(" AND ")}
    `).get(...params) as { count: number }).count || 0);

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
      LEFT JOIN clients c ON d.entity_type = 'client' AND c.id = d.entity_id
      LEFT JOIN contracts con ON d.entity_type = 'contract' AND con.id = d.entity_id
      LEFT JOIN clients cc ON cc.id = con.client_id
      LEFT JOIN payments p ON d.entity_type = 'payment' AND p.id = d.entity_id
      LEFT JOIN contracts pc_con ON pc_con.id = p.contract_id
      LEFT JOIN clients pc ON pc.id = pc_con.client_id
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
    const listParams = [...params];
    if (pagination.requested) {
      documentsQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const documents = db.prepare(documentsQuery).all(...listParams);

    const summary = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM documents d
      WHERE status IN ('pending', 'rejected', 'expired')
        ${branchFilter.sql ? `AND ${branchFilter.sql}` : ""}
      GROUP BY status
    `).all(...branchFilter.params) as { status: string, count: number }[];

    const expiringSoon = db.prepare(`
      SELECT COUNT(*) as count
      FROM documents d
      WHERE expires_at IS NOT NULL
        AND date(expires_at) > date('now')
        AND date(expires_at) <= date('now', '+30 day')
        AND status != 'approved'
        ${branchFilter.sql ? `AND ${branchFilter.sql}` : ""}
    `).get(...branchFilter.params) as { count: number };

    res.json({
      documents,
      total,
      page: pagination.requested ? pagination.page : 1,
      pageSize: pagination.requested ? pagination.pageSize : documents.length,
      totalPages: pagination.requested ? Math.max(1, Math.ceil(total / pagination.pageSize)) : 1,
      summary: {
        pending: summary.find(item => item.status === "pending")?.count || 0,
        rejected: summary.find(item => item.status === "rejected")?.count || 0,
        expired: summary.find(item => item.status === "expired")?.count || 0,
        expiringSoon: expiringSoon.count || 0,
      },
    });
  });

  app.get("/api/documents/:id/download", (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Documento inválido" });

    const document = db.prepare(`
      SELECT file_path, file_name, mime_type
      FROM documents
      WHERE id = ?
    `).get(id.data) as { file_path: string, file_name: string, mime_type: string } | undefined;

    if (!document) return res.status(404).json({ error: "Documento no encontrado" });

    try {
      const absolutePath = resolveStoredFile(document.file_path);
      if (!existsSync(absolutePath)) return res.status(404).json({ error: "Archivo no encontrado" });
      res.type(document.mime_type);
      res.download(absolutePath, document.file_name);
    } catch {
      res.status(400).json({ error: "Ruta de documento inválida" });
    }
  });

  app.get("/api/documents/:entityType/:entityId", (req, res) => {
    const entityType = entityTypeSchema.safeParse(req.params.entityType);
    const entityId = z.coerce.number().int().positive().safeParse(req.params.entityId);
    if (!entityType.success || !entityId.success) return res.status(400).json({ error: "Entidad inválida" });
    if (!entityExists(entityType.data, entityId.data)) return res.status(404).json({ error: "Entidad no encontrada" });

    const documents = db.prepare(`
      SELECT d.id, d.entity_type, d.entity_id, d.label, d.document_type, d.status, d.expires_at, d.notes,
             d.assigned_staff_id, d.next_action_at, d.reviewed_by_staff_id, d.reviewed_at, d.rejection_reason,
             d.file_name, d.mime_type, d.size_bytes, d.created_at,
             branch.id as branch_id,
             branch.name as branch_name,
             branch.code as branch_code
      FROM documents d
      LEFT JOIN branches branch ON branch.id = ${documentBranchIdSql("d")}
      WHERE d.entity_type = ? AND d.entity_id = ?
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
    `).all(entityType.data, entityId.data);

    res.json(documents);
  });

  app.post("/api/documents/:entityType/:entityId", (req, res) => {
    const entityType = entityTypeSchema.safeParse(req.params.entityType);
    const entityId = z.coerce.number().int().positive().safeParse(req.params.entityId);
    if (!entityType.success || !entityId.success) return res.status(400).json({ error: "Entidad inválida" });
    if (!entityExists(entityType.data, entityId.data)) return res.status(404).json({ error: "Entidad no encontrada" });

    const body = parseBody(uploadDocumentSchema, req.body, res);
    if (!body) return;

    try {
      const stored = storeDocumentFile({
        fileName: body.fileName,
        mimeType: body.mimeType,
        dataBase64: body.dataBase64,
        folder: `${entityType.data}-documents`,
      });

      const result = db.prepare(`
        INSERT INTO documents (
          entity_type, entity_id, label, document_type, status, expires_at, notes,
          assigned_staff_id, next_action_at, file_path, file_name, mime_type, size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entityType.data,
        entityId.data,
        body.label,
        body.document_type,
        body.status,
        body.expires_at,
        body.notes,
        body.assigned_staff_id || null,
        body.next_action_at,
        stored.filePath,
        stored.fileName,
        stored.mimeType,
        stored.sizeBytes
      );

      recordAuditEvent(req, {
        action: "document.uploaded",
        entityType: entityType.data,
        entityId: entityId.data,
        metadata: {
          document_id: result.lastInsertRowid,
          label: body.label,
          document_type: body.document_type,
          status: body.status,
          expires_at: body.expires_at,
          assigned_staff_id: body.assigned_staff_id || null,
          next_action_at: body.next_action_at,
          file_name: stored.fileName,
        },
      });

      ensureDocumentFollowUpTask(req, Number(result.lastInsertRowid), body.notes || null);
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo guardar el documento" });
    }
  });

  app.patch("/api/documents/:id", (req, res) => {
    const id = z.coerce.number().int().positive().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Documento inválido" });

    const body = parseBody(updateDocumentSchema, req.body, res);
    if (!body) return;

    const current = getDocument(id.data);
    if (!current) return res.status(404).json({ error: "Documento no encontrado" });
    if (body.status === "rejected" && !body.rejection_reason?.trim() && !body.notes?.trim()) {
      return res.status(400).json({ error: "Observar un documento requiere motivo o nota de rechazo" });
    }

    db.prepare(`
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
      WHERE id = ?
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
      getCurrentUser(req)?.id || null,
      body.status ? 1 : 0,
      id.data
    );

    recordAuditEvent(req, {
      action: "document.updated",
      entityType: "document",
      entityId: id.data,
      metadata: body,
    });

    const updated = getDocument(id.data);
    if (updated?.status === "approved") {
      closeDocumentFollowUpTasks(req, id.data);
    } else if (updated && ["pending", "rejected", "expired"].includes(updated.status)) {
      ensureDocumentFollowUpTask(req, id.data, body.rejection_reason || body.notes || null);
    }

    res.json({ success: true });
  });
}
