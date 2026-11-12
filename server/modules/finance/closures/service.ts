import type { Request } from "express";
import { recordAuditEvent } from "../../../audit";
import { buildMonthlyClose, buildOperationalClose } from "../reports/service";
import { getMonthlyClosure } from "../shared";
import {
  closeFinanceMonthInDb,
  listMonthlyClosuresFromDb,
  reopenFinanceMonthInDb,
} from "./repo";

export { getMonthlyClosure };

export function listMonthlyClosures(tenantId: number) {
  return listMonthlyClosuresFromDb(tenantId);
}

export function closeFinanceMonth(
  req: Request,
  staffId: number,
  tenantId: number,
  body: { month?: string; accepted_pending_note?: string | null }
): { ok: true; closure: any; notificationTaskId: number | null } | { ok: false; status: number; error: string } {
  const month = body.month || "";
  const existing = getMonthlyClosure(month, tenantId);
  if (existing?.status === "closed") return { ok: false, status: 400, error: `El mes ${month} ya está cerrado` };

  const monthlyClose = buildMonthlyClose(month, tenantId);
  const operationalClose = buildOperationalClose(month, tenantId);
  if (Number(operationalClose.summary.pendingItems || 0) > 0 && !body.accepted_pending_note) {
    return { ok: false, status: 400, error: "Debes dejar una nota para aceptar pendientes en el cierre" };
  }

  const notificationTaskId = closeFinanceMonthInDb(
    month,
    staffId,
    body.accepted_pending_note || null,
    monthlyClose,
    operationalClose,
    tenantId
  );

  recordAuditEvent(req, {
    action: "finance_month.closed",
    entityType: "monthly_finance_closure",
    entityId: month,
    metadata: {
      month,
      accepted_pending_note: body.accepted_pending_note || null,
      operational_status: operationalClose.status,
      pending_items: operationalClose.summary.pendingItems,
      pending_amount: operationalClose.summary.pendingAmount,
      notification_task_id: notificationTaskId,
    },
  });

  return {
    ok: true,
    closure: getMonthlyClosure(month, tenantId),
    notificationTaskId,
  };
}

export function reopenFinanceMonth(
  req: Request,
  month: string,
  staffId: number,
  reason: string,
  tenantId: number
): { ok: true; closure: any; notificationTaskId: number } | { ok: false; status: number; error: string } {
  const closure = getMonthlyClosure(month, tenantId);
  if (!closure || closure.status !== "closed") {
    return { ok: false, status: 400, error: `El mes ${month} no está cerrado` };
  }

  const notificationTaskId = reopenFinanceMonthInDb(month, staffId, reason, tenantId);

  recordAuditEvent(req, {
    action: "finance_month.reopened",
    entityType: "monthly_finance_closure",
    entityId: month,
    metadata: {
      month,
      reason,
      notification_task_id: notificationTaskId,
    },
  });

  return {
    ok: true,
    closure: getMonthlyClosure(month, tenantId),
    notificationTaskId,
  };
}

