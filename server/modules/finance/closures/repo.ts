import { db } from "../../../db";
import { addDays } from "../shared";

export function createMonthlyCloseNotificationTaskInDb(
  month: string,
  operationalClose: any,
  staffId: number | null,
  tenantId: number
) {
  if (Number(operationalClose?.summary?.pendingItems || 0) <= 0) return null;

  const existing = db.prepare(`
    SELECT id
    FROM operational_tasks
    WHERE source_type = 'monthly_finance_close'
      AND source_id = ?
      AND tenant_id = ?
      AND status IN ('open', 'in_progress')
    LIMIT 1
  `).get(month, tenantId) as { id: number } | undefined;
  if (existing) return existing.id;

  const priority = Number(operationalClose?.summary?.criticalCount || 0) > 0 ? "critical" : "high";
  const dueDate = addDays(new Date().toISOString().slice(0, 10), 1);
  const result = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, status, source_type, source_id, due_date, created_by_staff_id, tenant_id
    )
    VALUES (?, ?, 'finance', ?, 'open', 'monthly_finance_close', ?, ?, ?, ?)
  `).run(
    `Resolver pendientes del cierre ${month}`,
    `${operationalClose.summary.pendingItems} pendiente(s) aceptado(s) en cierre mensual por $${Number(operationalClose.summary.pendingAmount || 0).toLocaleString()}.`,
    priority,
    month,
    dueDate,
    staffId,
    tenantId
  );
  return Number(result.lastInsertRowid);
}

export function listMonthlyClosuresFromDb(tenantId: number) {
  return db.prepare(`
    SELECT mfc.id, mfc.month, mfc.status, mfc.closed_at, mfc.accepted_pending_note,
           mfc.reopened_at, mfc.reopened_reason, closed_by.name as closed_by_name,
           reopened_by.name as reopened_by_name
    FROM monthly_finance_closures mfc
    LEFT JOIN staff closed_by ON closed_by.id = mfc.closed_by_staff_id
    LEFT JOIN staff reopened_by ON reopened_by.id = mfc.reopened_by_staff_id
    WHERE mfc.tenant_id = ?
    ORDER BY mfc.month DESC
    LIMIT 24
  `).all(tenantId);
}

export function closeFinanceMonthInDb(
  month: string,
  staffId: number,
  acceptedPendingNote: string | null,
  monthlyClose: any,
  operationalClose: any,
  tenantId: number
) {
  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO monthly_finance_closures (
        month, status, closed_by_staff_id, closed_at, accepted_pending_note,
        monthly_snapshot_json, operational_snapshot_json, reopened_by_staff_id,
        reopened_at, reopened_reason, updated_at, tenant_id
      )
      VALUES (?, 'closed', ?, CURRENT_TIMESTAMP, ?, ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(tenant_id, month) DO UPDATE SET
        status = 'closed',
        closed_by_staff_id = excluded.closed_by_staff_id,
        closed_at = CURRENT_TIMESTAMP,
        accepted_pending_note = excluded.accepted_pending_note,
        monthly_snapshot_json = excluded.monthly_snapshot_json,
        operational_snapshot_json = excluded.operational_snapshot_json,
        reopened_by_staff_id = NULL,
        reopened_at = NULL,
        reopened_reason = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      month,
      staffId,
      acceptedPendingNote,
      JSON.stringify(monthlyClose),
      JSON.stringify(operationalClose),
      tenantId
    );

    return createMonthlyCloseNotificationTaskInDb(month, operationalClose, staffId, tenantId);
  });

  return transaction();
}

export function reopenFinanceMonthInDb(month: string, staffId: number, reason: string, tenantId: number) {
  db.prepare(`
    UPDATE monthly_finance_closures
    SET status = 'reopened',
        reopened_by_staff_id = ?,
        reopened_at = CURRENT_TIMESTAMP,
        reopened_reason = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE month = ? AND tenant_id = ?
  `).run(staffId, reason, month, tenantId);

  const taskResult = db.prepare(`
    INSERT INTO operational_tasks (
      title, description, category, priority, status, source_type, source_id, due_date, created_by_staff_id, tenant_id
    )
    VALUES (?, ?, 'finance', 'high', 'open', 'monthly_finance_reopen', ?, ?, ?, ?)
  `).run(
    `Revisar mes reabierto ${month}`,
    `El cierre financiero ${month} fue reabierto. Motivo: ${reason}`,
    month,
    addDays(new Date().toISOString().slice(0, 10), 1),
    staffId,
    tenantId
  );

  return Number(taskResult.lastInsertRowid);
}

