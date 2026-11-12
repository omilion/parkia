import { db } from "../../db";

export function insertAuditEventInDb(params: {
  staffId: number | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadataJson: string | null;
  ipAddress: string | null;
  tenantId: number | null;
}) {
  db.prepare(`
    INSERT INTO audit_events (staff_id, action, entity_type, entity_id, metadata, ip_address, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.staffId,
    params.action,
    params.entityType,
    params.entityId,
    params.metadataJson,
    params.ipAddress,
    params.tenantId,
  );
}

export function listAuditEventsFromDb(whereSql: string, params: unknown[], limit: number) {
  return db.prepare(`
    SELECT a.*, s.name as staff_name, s.email as staff_email
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `).all(...params, limit);
}

export function getAuditSummaryFromDb(whereSql: string, params: unknown[]) {
  const total = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
  `).get(...params) as { count: number };

  const byAction = db.prepare(`
    SELECT a.action, COUNT(*) as count
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
    GROUP BY a.action
    ORDER BY count DESC, a.action ASC
    LIMIT 8
  `).all(...params);

  const byEntity = db.prepare(`
    SELECT a.entity_type, COUNT(*) as count
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
    GROUP BY a.entity_type
    ORDER BY count DESC, a.entity_type ASC
    LIMIT 8
  `).all(...params);

  const byUser = db.prepare(`
    SELECT COALESCE(s.name, 'Sistema') as staff_name, COALESCE(s.email, '') as staff_email, COUNT(*) as count
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
    GROUP BY COALESCE(s.name, 'Sistema'), COALESCE(s.email, '')
    ORDER BY count DESC, staff_name ASC
    LIMIT 8
  `).all(...params);

  return { total: total.count, byAction, byEntity, byUser };
}

export function listAuditEventsForCsvFromDb(whereSql: string, params: unknown[], limit: number) {
  return db.prepare(`
    SELECT a.id, a.created_at, s.name as staff_name, s.email as staff_email, a.action,
           a.entity_type, a.entity_id, a.metadata, a.ip_address
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    ${whereSql}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ?
  `).all(...params, limit) as Record<string, unknown>[];
}
