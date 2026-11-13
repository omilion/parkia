import { db } from "../../../db";
import { likeValue, type PaginationParams } from "../../../pagination";
import { storePaymentReceipt } from "../../../storage";
import { todayLocal } from "../../../../shared/dates";
import {
  ensureFinanceDateOpen,
  ensureFinanceDatesOpen,
  getPaymentAllocatedAmount,
  markPaymentAsPaid,
  paymentRemainingSql,
  recalculateMovementStatus,
  recalculatePaymentStatus,
} from "../shared";

export async function listAllPaymentsWithClientName() {
  return await db.prepare(`
    SELECT p.*, cl.name as client_name 
    FROM payments p 
    JOIN contracts c ON p.contract_id = c.id 
    JOIN clients cl ON c.client_id = cl.id
  `).all();
}

export async function listFinancePaymentsFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status: string;
  search: string;
  month: string;
  monthField: string;
  review: string;
  cutOffDate: string;
  pagination: PaginationParams;
}) {
  const { tenantId, branchId, status, search, month, monthField, review, cutOffDate, pagination } = params;
  const sqlParams: any[] = [tenantId];
  let where = "WHERE p.tenant_id = ?";
  if (branchId) {
    where += " AND p.branch_id = ?";
    sqlParams.push(branchId);
  }
  if (status && status !== "all") {
    where += " AND p.status = ?";
    sqlParams.push(status);
  }
  if (search) {
    const like = likeValue(search);
    where += `
      AND (
        cl.name LIKE ? OR cl.rut LIKE ? OR CAST(p.id AS TEXT) LIKE ? OR CAST(c.id AS TEXT) LIKE ?
        OR COALESCE(p.due_date, '') LIKE ? OR COALESCE(p.payment_date, '') LIKE ? OR COALESCE(p.reference, '') LIKE ?
      )
    `;
    sqlParams.push(like, like, like, like, like, like, like);
  }
  if (month) {
    if (monthField === "due") {
      where += " AND COALESCE(p.due_date, '') LIKE ?";
      sqlParams.push(`${month}%`);
    } else if (monthField === "paid") {
      where += " AND COALESCE(p.payment_date, '') LIKE ?";
      sqlParams.push(`${month}%`);
    } else {
      where += " AND (COALESCE(p.due_date, '') LIKE ? OR COALESCE(p.payment_date, '') LIKE ?)";
      sqlParams.push(`${month}%`, `${month}%`);
    }
  }
  if (review === "open-to-close") {
    where += " AND p.due_date < ? AND p.status IN ('pending', 'overdue')";
    sqlParams.push(cutOffDate);
  } else if (review === "manual-without-receipt") {
    where += " AND p.status = 'paid' AND p.method IN ('cash', 'card') AND p.receipt_file_path IS NULL";
  }

  const fromSql = `
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
    LEFT JOIN branches b ON b.id = p.branch_id AND b.tenant_id = p.tenant_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    LEFT JOIN (
      SELECT payment_id,
             SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_actions_count,
             MIN(CASE WHEN status = 'open' THEN next_action_at ELSE NULL END) as next_action_at,
             (
               SELECT note
               FROM collection_actions latest
               WHERE latest.payment_id = collection_actions.payment_id
                 AND latest.tenant_id = collection_actions.tenant_id
               ORDER BY latest.created_at DESC, latest.id DESC
               LIMIT 1
             ) as latest_note
      FROM collection_actions
      WHERE tenant_id = ?
      GROUP BY payment_id, tenant_id
    ) ca ON ca.payment_id = p.id
    ${where}
  `;
  const fromParams = [tenantId, tenantId, ...sqlParams];
  const total = Number((await db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...fromParams) as { count: number }).count || 0);
  let listQuery = `
    SELECT p.*,
           cl.name as client_name,
           cl.rut as client_rut,
           c.id as contract_id_display,
           b.name as branch_name,
           b.code as branch_code,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           ${paymentRemainingSql} as remaining_amount,
           COALESCE(ca.open_actions_count, 0) as open_collection_actions_count,
           ca.next_action_at as next_collection_action_at,
           ca.latest_note as latest_collection_note
    ${fromSql}
    ORDER BY p.due_date DESC
  `;
  const listParams = [...fromParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const payments = await db.prepare(listQuery).all(...listParams);
  return { payments, total };
}

export async function getPaymentDetailFromDb(paymentId: string | number, tenantId: number) {
  const payment = await db.prepare(`
    SELECT p.*,
           cl.id as client_id,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.email as client_email,
           cl.phone as client_phone,
           c.id as contract_id_display,
           c.start_date as contract_start_date,
           c.end_date as contract_end_date,
           c.monthly_fee,
           s.name as space_name,
           b.name as branch_name,
           b.code as branch_code,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           ${paymentRemainingSql} as remaining_amount
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = p.tenant_id
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = p.tenant_id
    LEFT JOIN spaces s ON s.id = c.space_id AND s.tenant_id = p.tenant_id
    LEFT JOIN branches b ON b.id = p.branch_id AND b.tenant_id = p.tenant_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    WHERE p.id = ? AND p.tenant_id = ?
  `).get(tenantId, paymentId, tenantId) as any | undefined;
  if (!payment) return null;

  const adjustments = await db.prepare(`
    SELECT a.*, s.name as staff_name, s.email as staff_email
    FROM payment_adjustments a
    LEFT JOIN staff s ON s.id = a.staff_id
    WHERE a.payment_id = ? AND a.tenant_id = ?
    ORDER BY a.created_at DESC, a.id DESC
  `).all(paymentId, tenantId);

  const allocations = await db.prepare(`
    SELECT pa.*, bm.date as movement_date, bm.description as movement_description, bm.rut as movement_rut, bm.amount as movement_amount
    FROM payment_allocations pa
    JOIN bank_movements bm ON bm.id = pa.bank_movement_id AND bm.tenant_id = pa.tenant_id
    WHERE pa.payment_id = ? AND pa.tenant_id = ?
    ORDER BY pa.created_at DESC, pa.id DESC
  `).all(paymentId, tenantId);

  const collectionActions = await db.prepare(`
    SELECT ca.*, s.name as staff_name, s.email as staff_email
    FROM collection_actions ca
    LEFT JOIN staff s ON s.id = ca.staff_id
    WHERE ca.payment_id = ? AND ca.tenant_id = ?
    ORDER BY ca.created_at DESC, ca.id DESC
  `).all(paymentId, tenantId);

  const invoices = await db.prepare(`
    SELECT i.*
    FROM invoices i
    WHERE i.client_id = ? AND i.amount = ? AND i.tenant_id = ?
    ORDER BY i.date DESC, i.id DESC
    LIMIT 10
  `).all(payment.client_id, payment.amount, tenantId);

  return { payment, adjustments, allocations, collectionActions, invoices };
}

export async function adjustPaymentInDb(
  paymentId: string | number,
  tenantId: number,
  staffId: number | null,
  body: { type?: "discount" | "waiver" | "fee"; amount?: number; reason?: string }
) {
  const transaction = db.transaction(async () => {
    const payment = await db.prepare("SELECT * FROM payments WHERE id = ? AND tenant_id = ?").get(paymentId, tenantId) as any | undefined;
    if (!payment) throw new Error("Cuenta por cobrar no encontrada");
    if (payment.status === "paid") throw new Error("No se puede ajustar una cuenta por cobrar pagada");
    if (payment.status === "cancelled") throw new Error("No se puede ajustar una cuenta por cobrar cancelada");
    await ensureFinanceDateOpen(payment.due_date, tenantId);

    const previousAmount = Number(payment.amount || 0);
    const signedAmount = body.type === "fee" ? Number(body.amount) : -Number(body.amount);
    const newAmount = Math.max(previousAmount + signedAmount, 0);
    const allocatedAmount = await getPaymentAllocatedAmount(payment.id, tenantId);
    if (newAmount < allocatedAmount) throw new Error("El ajuste no puede dejar el monto menor a los abonos ya aplicados");

    const today = todayLocal();
    const nextStatus = newAmount === 0
      ? "cancelled"
      : allocatedAmount >= newAmount
        ? "paid"
        : payment.due_date < today ? "overdue" : "pending";

    await db.prepare("UPDATE payments SET amount = ?, status = ? WHERE id = ? AND tenant_id = ?").run(newAmount, nextStatus, payment.id, tenantId);
    const adjustment = await db.prepare(`
      INSERT INTO payment_adjustments (payment_id, staff_id, type, amount, previous_amount, new_amount, reason, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payment.id, staffId, body.type, body.amount, previousAmount, newAmount, body.reason, tenantId);

    return {
      id: Number(adjustment.lastInsertRowid),
      paymentId: Number(payment.id),
      type: body.type,
      amount: Number(body.amount),
      previousAmount,
      newAmount,
      status: nextStatus,
      reason: body.reason,
    };
  });

  return await transaction();
}

export async function findPaymentBasicInDb(paymentId: string | number, tenantId: number) {
  return await db.prepare("SELECT id, status FROM payments WHERE id = ? AND tenant_id = ?").get(paymentId, tenantId) as { id: number; status: string } | undefined;
}

export async function listPaymentCollectionActionsFromDb(paymentId: string | number, tenantId: number) {
  return await db.prepare(`
    SELECT ca.*, s.name as staff_name, s.email as staff_email
    FROM collection_actions ca
    LEFT JOIN staff s ON s.id = ca.staff_id
    WHERE ca.payment_id = ? AND ca.tenant_id = ?
    ORDER BY CASE ca.status WHEN 'open' THEN 0 ELSE 1 END, ca.created_at DESC, ca.id DESC
  `).all(paymentId, tenantId);
}

export async function insertCollectionActionInDb(
  paymentId: number,
  staffId: number | null,
  tenantId: number,
  body: { channel?: string; note?: string; next_action_at?: string | null }
) {
  const result = await db.prepare(`
    INSERT INTO collection_actions (payment_id, staff_id, channel, note, next_action_at, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(paymentId, staffId, body.channel, body.note, body.next_action_at || null, tenantId);
  return result.lastInsertRowid;
}

export async function listCollectionQueueFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status: string;
  due: string;
}) {
  const { tenantId, branchId, status, due } = params;
  const conditions: string[] = ["ca.tenant_id = ?"];
  const sqlParams: Array<string | number> = [tenantId];
  if (branchId) {
    conditions.push("p.branch_id = ?");
    sqlParams.push(branchId);
  }
  if (status !== "all") {
    conditions.push("ca.status = ?");
    sqlParams.push(status);
  }
  if (due === "overdue") {
    conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at < date('now')");
  } else if (due === "today") {
    conditions.push("ca.next_action_at = date('now')");
  } else if (due === "actionable") {
    conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at <= date('now')");
  } else if (due === "upcoming") {
    conditions.push("ca.next_action_at IS NOT NULL AND ca.next_action_at > date('now')");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return await db.prepare(`
    SELECT ca.*,
           s.name as staff_name,
           s.email as staff_email,
           p.amount as payment_amount,
           p.branch_id,
           b.name as branch_name,
           b.code as branch_code,
           p.due_date as payment_due_date,
           p.status as payment_status,
           ${paymentRemainingSql} as payment_remaining_amount,
           c.id as contract_id_display,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.email as client_email,
           cl.phone as client_phone
    FROM collection_actions ca
    JOIN payments p ON p.id = ca.payment_id AND p.tenant_id = ca.tenant_id
    JOIN contracts c ON c.id = p.contract_id AND c.tenant_id = ca.tenant_id
    JOIN clients cl ON cl.id = c.client_id AND cl.tenant_id = ca.tenant_id
    LEFT JOIN branches b ON b.id = p.branch_id AND b.tenant_id = ca.tenant_id
    LEFT JOIN staff s ON s.id = ca.staff_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    ${where}
    ORDER BY
      CASE
        WHEN ca.status = 'open' AND ca.next_action_at IS NOT NULL AND ca.next_action_at < date('now') THEN 0
        WHEN ca.status = 'open' AND ca.next_action_at = date('now') THEN 1
        WHEN ca.status = 'open' THEN 2
        ELSE 3
      END,
      ca.next_action_at ASC,
      ca.created_at DESC,
      ca.id DESC
  `).all(tenantId, ...sqlParams);
}

export async function findCollectionActionById(actionId: string | number, tenantId: number) {
  return await db.prepare("SELECT * FROM collection_actions WHERE id = ? AND tenant_id = ?").get(actionId, tenantId) as any | undefined;
}

export async function completeCollectionActionInDb(actionId: string | number, tenantId: number, note: string | null) {
  await db.prepare(`
    UPDATE collection_actions
    SET status = 'done',
        completed_at = CURRENT_TIMESTAMP,
        completed_note = ?
    WHERE id = ? AND tenant_id = ?
  `).run(note, actionId, tenantId);
}

export async function listPaymentAllocationsFromDb(params: {
  tenantId: number;
  paymentId?: number;
  bankMovementId?: number;
}) {
  const conditions: string[] = ["pa.tenant_id = ?"];
  const sqlParams: Array<number> = [params.tenantId];
  if (params.paymentId) {
    conditions.push("pa.payment_id = ?");
    sqlParams.push(params.paymentId);
  }
  if (params.bankMovementId) {
    conditions.push("pa.bank_movement_id = ?");
    sqlParams.push(params.bankMovementId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return await db.prepare(`
    SELECT pa.*,
           p.amount as payment_amount,
           p.due_date as payment_due_date,
           p.status as payment_status,
           cl.name as client_name,
           cl.rut as client_rut,
           c.id as contract_id_display,
           bm.date as movement_date,
           bm.description as movement_description,
           bm.rut as movement_rut,
           bm.amount as movement_amount,
           bm.status as movement_status
    FROM payment_allocations pa
    JOIN payments p ON pa.payment_id = p.id AND p.tenant_id = pa.tenant_id
    JOIN contracts c ON p.contract_id = c.id AND c.tenant_id = pa.tenant_id
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = pa.tenant_id
    JOIN bank_movements bm ON pa.bank_movement_id = bm.id AND bm.tenant_id = pa.tenant_id
    ${where}
    ORDER BY pa.created_at DESC, pa.id DESC
  `).all(...sqlParams);
}

export async function reversePaymentAllocationInDb(allocationId: string | number, tenantId: number, note: string) {
  const transaction = db.transaction(async () => {
    const allocation = await db.prepare(`
      SELECT pa.*, p.amount as payment_amount, p.payment_date as payment_date, bm.amount as movement_amount, bm.date as movement_date
      FROM payment_allocations pa
      JOIN payments p ON p.id = pa.payment_id AND p.tenant_id = pa.tenant_id
      JOIN bank_movements bm ON bm.id = pa.bank_movement_id AND bm.tenant_id = pa.tenant_id
      WHERE pa.id = ? AND pa.tenant_id = ?
    `).get(allocationId, tenantId) as any | undefined;
    if (!allocation) throw new Error("Abono no encontrado");
    if (allocation.reversed_at) throw new Error("El abono ya fue reversado");
    await ensureFinanceDatesOpen([allocation.payment_date, allocation.movement_date], tenantId);

    await db.prepare(`
      UPDATE payment_allocations
      SET reversed_at = CURRENT_TIMESTAMP,
          reversed_note = ?
      WHERE id = ? AND tenant_id = ?
    `).run(note, allocationId, tenantId);

    const payment = await recalculatePaymentStatus(allocation.payment_id, tenantId);
    const movement = await recalculateMovementStatus(allocation.bank_movement_id, tenantId);

    return {
      allocationId: Number(allocation.id),
      paymentId: Number(allocation.payment_id),
      bankMovementId: Number(allocation.bank_movement_id),
      amount: Number(allocation.amount),
      note,
      payment,
      movement,
    };
  });

  return await transaction();
}

export async function getPaymentReceiptMetadataFromDb(paymentId: string | number, tenantId: number) {
  return await db.prepare(`
    SELECT receipt_file_path, receipt_file_name, receipt_mime_type
    FROM payments
    WHERE id = ? AND tenant_id = ?
  `).get(paymentId, tenantId) as {
    receipt_file_path: string | null;
    receipt_file_name: string | null;
    receipt_mime_type: string | null;
  } | undefined;
}

export async function registerPaymentInDb(
  paymentId: string | number,
  body: {
    method?: "cash" | "transfer" | "card" | "automatic";
    payment_date?: string;
    reference?: string | null;
    note?: string;
    receipt?: {
      fileName?: string;
      mimeType?: "application/pdf" | "image/jpeg" | "image/png";
      dataBase64?: string;
    };
  }
) {
  const transaction = db.transaction(async () => {
    const existing = await db.prepare("SELECT tenant_id FROM payments WHERE id = ?").get(paymentId) as { tenant_id: number | null } | undefined;
    const storedReceipt = body.receipt
      ? storePaymentReceipt({
          fileName: body.receipt.fileName || "receipt",
          mimeType: body.receipt.mimeType || "application/pdf",
          dataBase64: body.receipt.dataBase64 || "",
          tenantId: existing?.tenant_id || 1,
        })
      : null;
    const result = await markPaymentAsPaid({
      paymentId,
      method: body.method || "cash",
      paymentDate: body.payment_date || new Date().toISOString(),
      reference: body.reference,
      receiptFilePath: storedReceipt?.filePath || null,
      receiptFileName: storedReceipt?.fileName || null,
      receiptMimeType: storedReceipt?.mimeType || null,
    });

    return {
      ...result,
      receiptFilePath: storedReceipt?.filePath || null,
    };
  });

  return await transaction();
}

export async function findInvoiceById(invoiceId: number, tenantId: number) {
  return await db.prepare("SELECT id, folio, pdf_content, xml_content FROM invoices WHERE id = ? AND tenant_id = ?").get(invoiceId, tenantId) as {
    id: number;
    folio: number;
    pdf_content: string | null;
    xml_content: string | null;
  } | undefined;
}

export async function recordSiiDownloadEventInDb(invoiceId: number, staffId: number | null, format: "pdf" | "xml", tenantId: number) {
  await db.prepare(`
    INSERT INTO sii_events (invoice_id, staff_id, provider, event_type, status, response_json, tenant_id)
    VALUES (?, ?, 'local_mock', 'downloaded', 'accepted', ?, ?)
  `).run(invoiceId, staffId, JSON.stringify({ format }), tenantId);
}

export async function listInvoicesFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status: string;
  pagination: PaginationParams;
}) {
  const { tenantId, branchId, status, pagination } = params;
  const sqlParams: any[] = [tenantId];
  let where = "WHERE i.tenant_id = ?";
  if (branchId) {
    where += " AND COALESCE(p.branch_id, co.branch_id) = ?";
    sqlParams.push(branchId);
  }
  if (status && status !== "all") {
    where += " AND i.status_sii = ?";
    sqlParams.push(status);
  }
  const fromSql = `
    FROM invoices i
    JOIN clients c ON i.client_id = c.id
    LEFT JOIN payments p ON p.id = i.payment_id
    LEFT JOIN contracts co ON co.id = COALESCE(i.contract_id, p.contract_id)
    ${where}
  `;
  const total = Number((await db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...sqlParams) as { count: number }).count || 0);
  let listQuery = `
    SELECT i.*, c.name as client_name, c.rut as client_rut, c.billing_contact_email
    ${fromSql}
    ORDER BY i.date DESC
  `;
  const listParams = [...sqlParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const invoices = await db.prepare(listQuery).all(...listParams);
  return { invoices, total };
}
