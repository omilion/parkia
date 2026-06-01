import type { Request } from "express";
import { getCurrentUser } from "./auth/sessions";
import { db } from "./db";

type AuditEventInput = {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
};

export function recordAuditEvent(req: Request, input: AuditEventInput) {
  const user = getCurrentUser(req);

  db.prepare(`
    INSERT INTO audit_events (staff_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    user?.id || null,
    input.action,
    input.entityType,
    input.entityId == null ? null : String(input.entityId),
    input.metadata ? JSON.stringify(input.metadata) : null,
    req.ip || req.socket.remoteAddress || null
  );
}
