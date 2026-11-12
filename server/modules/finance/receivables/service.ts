import type { Request } from "express";
import { existsSync } from "fs";
import { recordAuditEvent } from "../../../audit";
import { getCurrentUser } from "../../../auth/sessions";
import { getBranchOrDefault } from "../../../branches";
import type { PaginationParams } from "../../../pagination";
import { getSiiReadiness, issueInvoiceWithConfiguredProvider, syncInvoiceWithConfiguredProvider } from "../../../sii";
import { resolveStoredFile } from "../../../storage";
import { refreshFinanceState, reportMeta } from "../shared";
import {
  adjustPaymentInDb,
  completeCollectionActionInDb,
  findCollectionActionById,
  findInvoiceById,
  findPaymentBasicInDb,
  getPaymentDetailFromDb,
  getPaymentReceiptMetadataFromDb,
  insertCollectionActionInDb,
  listAllPaymentsWithClientName,
  listCollectionQueueFromDb,
  listFinancePaymentsFromDb,
  listInvoicesFromDb,
  listPaymentAllocationsFromDb,
  listPaymentCollectionActionsFromDb,
  recordSiiDownloadEventInDb,
  registerPaymentInDb,
  reversePaymentAllocationInDb,
} from "./repo";

export { listAllPaymentsWithClientName };

export function listFinancePayments(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  search: string;
  month: string;
  monthField: string;
  review: string;
  cutOffDate: string;
  pagination: PaginationParams;
}) {
  refreshFinanceState();
  const branchId = params.rawBranchId ? getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return listFinancePaymentsFromDb({
    ...params,
    branchId,
  });
}

export function getFinancePaymentDetail(paymentId: string, tenantId: number) {
  refreshFinanceState();
  const detail = getPaymentDetailFromDb(paymentId, tenantId);
  if (!detail) return null;

  return {
    ...detail,
    meta: reportMeta({
      cutOffDate: new Date().toISOString().slice(0, 10),
      formulas: {
        allocated_amount: "SUM(payment_allocations.amount) donde reversed_at IS NULL",
        remaining_amount: "0 si status paid/cancelled; si no, MAX(payment.amount - allocated_amount, 0)",
        status: "paid/cancelled manual o pendiente/vencido segun due_date y saldo",
      },
    }),
  };
}

export function adjustFinancePayment(
  req: Request,
  paymentId: string,
  tenantId: number,
  body: { type?: "discount" | "waiver" | "fee"; amount?: number; reason?: string }
) {
  const user = getCurrentUser(req);
  const result = adjustPaymentInDb(paymentId, tenantId, user?.id || null, body);
  recordAuditEvent(req, {
    action: "payment.adjusted",
    entityType: "payment",
    entityId: paymentId,
    metadata: result,
  });
  return result;
}

export function getPaymentCollectionActions(paymentId: string, tenantId: number) {
  const payment = findPaymentBasicInDb(paymentId, tenantId);
  if (!payment) return null;
  return listPaymentCollectionActionsFromDb(paymentId, tenantId);
}

export function createPaymentCollectionAction(
  req: Request,
  paymentId: string,
  tenantId: number,
  body: { channel?: string; note?: string; next_action_at?: string | null }
): { ok: true; id: number | bigint } | { ok: false; status: number; error: string } {
  const payment = findPaymentBasicInDb(paymentId, tenantId);
  if (!payment) return { ok: false, status: 404, error: "Pago no encontrado" };
  if (payment.status === "paid" || payment.status === "cancelled") {
    return { ok: false, status: 400, error: "Solo se puede gestionar cobranza de pagos pendientes o atrasados" };
  }

  const user = getCurrentUser(req);
  const id = insertCollectionActionInDb(payment.id, user?.id || null, tenantId, body);
  recordAuditEvent(req, {
    action: "collection_action.created",
    entityType: "payment",
    entityId: payment.id,
    metadata: {
      collection_action_id: id,
      channel: body.channel,
      next_action_at: body.next_action_at || null,
    },
  });
  return { ok: true, id };
}

export function listCollectionQueue(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  due: string;
}) {
  const branchId = params.rawBranchId ? getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return listCollectionQueueFromDb({
    tenantId: params.tenantId,
    branchId,
    status: params.status,
    due: params.due,
  });
}

export function completeCollectionAction(
  req: Request,
  actionId: string,
  tenantId: number,
  note?: string | null
): { ok: true } | { ok: false; status: number; error: string } {
  const action = findCollectionActionById(actionId, tenantId);
  if (!action) return { ok: false, status: 404, error: "Gestión de cobranza no encontrada" };
  if (action.status === "done") return { ok: false, status: 400, error: "La gestión ya está cerrada" };

  completeCollectionActionInDb(actionId, tenantId, note || null);
  recordAuditEvent(req, {
    action: "collection_action.completed",
    entityType: "collection_action",
    entityId: actionId,
    metadata: {
      payment_id: action.payment_id,
      note: note || null,
    },
  });
  return { ok: true };
}

export function listPaymentAllocations(params: {
  tenantId: number;
  paymentId?: number;
  bankMovementId?: number;
}) {
  return listPaymentAllocationsFromDb(params);
}

export function reversePaymentAllocation(req: Request, allocationId: string, tenantId: number, note: string) {
  const result = reversePaymentAllocationInDb(allocationId, tenantId, note);
  recordAuditEvent(req, {
    action: "payment_allocation.reversed",
    entityType: "payment_allocation",
    entityId: allocationId,
    metadata: result,
  });
  return result;
}

export function resolvePaymentReceiptDownload(
  paymentId: string,
  tenantId: number
): { ok: true; absolutePath: string; fileName: string; mimeType: string } | { ok: false; status: number; error: string } {
  const payment = getPaymentReceiptMetadataFromDb(paymentId, tenantId);
  if (!payment) return { ok: false, status: 404, error: "Pago no encontrado" };
  if (!payment.receipt_file_path) return { ok: false, status: 404, error: "Comprobante no encontrado" };

  try {
    const absolutePath = resolveStoredFile(payment.receipt_file_path);
    if (!existsSync(absolutePath)) return { ok: false, status: 404, error: "Archivo de comprobante no encontrado" };
    return {
      ok: true,
      absolutePath,
      fileName: payment.receipt_file_name || "comprobante",
      mimeType: payment.receipt_mime_type || "application/octet-stream",
    };
  } catch {
    return { ok: false, status: 400, error: "Ruta de comprobante inválida" };
  }
}

export function registerManualPayment(
  req: Request,
  paymentId: string,
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
  const result = registerPaymentInDb(paymentId, body);
  recordAuditEvent(req, {
    action: "payment.registered",
    entityType: "payment",
    entityId: paymentId,
    metadata: {
      folio: result.folio,
      method: body.method,
      reference: body.reference,
      note: body.note,
      receipt_file_path: result.receiptFilePath,
      contract_id: result.contractId,
      client_id: result.clientId,
      amount: result.amount,
      paid_amount: result.paidAmount,
      allocated_amount: result.allocatedAmount,
    },
  });
  return result;
}

export function getInvoicesReadiness(tenantId: number) {
  return getSiiReadiness(tenantId);
}

export function issueFinanceInvoice(
  req: Request,
  invoiceId: number,
  tenantId: number
): { ok: true; result: any } | { ok: false; status: number; error: string } {
  const invoice = findInvoiceById(invoiceId, tenantId);
  if (!invoice) return { ok: false, status: 404, error: "Documento tributario no encontrado" };
  const user = getCurrentUser(req);
  const result = issueInvoiceWithConfiguredProvider(invoiceId, user?.id);
  recordAuditEvent(req, {
    action: "sii.invoice_issued",
    entityType: "invoice",
    entityId: String(invoiceId),
    metadata: result,
  });
  return { ok: true, result };
}

export function syncFinanceInvoice(
  req: Request,
  invoiceId: number,
  tenantId: number
): { ok: true; result: any } | { ok: false; status: number; error: string } {
  const invoice = findInvoiceById(invoiceId, tenantId);
  if (!invoice) return { ok: false, status: 404, error: "Documento tributario no encontrado" };
  const user = getCurrentUser(req);
  const result = syncInvoiceWithConfiguredProvider(invoiceId, user?.id);
  recordAuditEvent(req, {
    action: "sii.invoice_synced",
    entityType: "invoice",
    entityId: String(invoiceId),
    metadata: result,
  });
  return { ok: true, result };
}

export function downloadFinanceInvoiceDocument(
  req: Request,
  invoiceId: number,
  format: "pdf" | "xml",
  tenantId: number
): { ok: true; folio: number; content: Buffer | string } | { ok: false; status: number; error: string } {
  const invoice = findInvoiceById(invoiceId, tenantId);
  if (format === "pdf") {
    if (!invoice?.pdf_content) return { ok: false, status: 404, error: "PDF no disponible. Emite el documento primero." };
    const user = getCurrentUser(req);
    recordSiiDownloadEventInDb(invoiceId, user?.id || null, "pdf", tenantId);
    return { ok: true, folio: invoice.folio, content: Buffer.from(invoice.pdf_content, "base64") };
  }
  if (!invoice?.xml_content) return { ok: false, status: 404, error: "XML no disponible. Emite el documento primero." };
  const user = getCurrentUser(req);
  recordSiiDownloadEventInDb(invoiceId, user?.id || null, "xml", tenantId);
  return { ok: true, folio: invoice.folio, content: invoice.xml_content };
}

export function listFinanceInvoices(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  pagination: PaginationParams;
}) {
  const branchId = params.rawBranchId ? getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return listInvoicesFromDb({
    tenantId: params.tenantId,
    branchId,
    status: params.status,
    pagination: params.pagination,
  });
}

