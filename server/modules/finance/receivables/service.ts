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

export async function listFinancePayments(params: {
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
  await refreshFinanceState();
  const branchId = params.rawBranchId ? await getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return await listFinancePaymentsFromDb({
    ...params,
    branchId,
  });
}

export async function getFinancePaymentDetail(paymentId: string, tenantId: number) {
  await refreshFinanceState();
  const detail = await getPaymentDetailFromDb(paymentId, tenantId);
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

export async function adjustFinancePayment(
  req: Request,
  paymentId: string,
  tenantId: number,
  body: { type?: "discount" | "waiver" | "fee"; amount?: number; reason?: string }
) {
  const user = await getCurrentUser(req);
  const result = await adjustPaymentInDb(paymentId, tenantId, user?.id || null, body);
  await recordAuditEvent(req, {
    action: "payment.adjusted",
    entityType: "payment",
    entityId: paymentId,
    metadata: result,
  });
  return result;
}

export async function getPaymentCollectionActions(paymentId: string, tenantId: number) {
  const payment = await findPaymentBasicInDb(paymentId, tenantId);
  if (!payment) return null;
  return await listPaymentCollectionActionsFromDb(paymentId, tenantId);
}

export async function createPaymentCollectionAction(
  req: Request,
  paymentId: string,
  tenantId: number,
  body: { channel?: string; note?: string; next_action_at?: string | null }
): Promise<{ ok: true; id: number | bigint } | { ok: false; status: number; error: string }> {
  const payment = await findPaymentBasicInDb(paymentId, tenantId);
  if (!payment) return { ok: false, status: 404, error: "Pago no encontrado" };
  if (payment.status === "paid" || payment.status === "cancelled") {
    return { ok: false, status: 400, error: "Solo se puede gestionar cobranza de pagos pendientes o atrasados" };
  }

  const user = await getCurrentUser(req);
  const id = await insertCollectionActionInDb(payment.id, user?.id || null, tenantId, body);
  await recordAuditEvent(req, {
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

export async function listCollectionQueue(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  due: string;
}) {
  const branchId = params.rawBranchId ? await getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return await listCollectionQueueFromDb({
    tenantId: params.tenantId,
    branchId,
    status: params.status,
    due: params.due,
  });
}

export async function completeCollectionAction(
  req: Request,
  actionId: string,
  tenantId: number,
  note?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const action = await findCollectionActionById(actionId, tenantId);
  if (!action) return { ok: false, status: 404, error: "Gestión de cobranza no encontrada" };
  if (action.status === "done") return { ok: false, status: 400, error: "La gestión ya está cerrada" };

  await completeCollectionActionInDb(actionId, tenantId, note || null);
  await recordAuditEvent(req, {
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

export async function listPaymentAllocations(params: {
  tenantId: number;
  paymentId?: number;
  bankMovementId?: number;
}) {
  return await listPaymentAllocationsFromDb(params);
}

export async function reversePaymentAllocation(req: Request, allocationId: string, tenantId: number, note: string) {
  const result = await reversePaymentAllocationInDb(allocationId, tenantId, note);
  await recordAuditEvent(req, {
    action: "payment_allocation.reversed",
    entityType: "payment_allocation",
    entityId: allocationId,
    metadata: result,
  });
  return result;
}

export async function resolvePaymentReceiptDownload(
  paymentId: string,
  tenantId: number
): Promise<{ ok: true; absolutePath: string; fileName: string; mimeType: string } | { ok: false; status: number; error: string }> {
  const payment = await getPaymentReceiptMetadataFromDb(paymentId, tenantId);
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

export async function registerManualPayment(
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
  const result = await registerPaymentInDb(paymentId, body);
  await recordAuditEvent(req, {
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

export async function getInvoicesReadiness(tenantId: number) {
  return await getSiiReadiness(tenantId);
}

export async function issueFinanceInvoice(
  req: Request,
  invoiceId: number,
  tenantId: number
): Promise<{ ok: true; result: any } | { ok: false; status: number; error: string }> {
  const invoice = await findInvoiceById(invoiceId, tenantId);
  if (!invoice) return { ok: false, status: 404, error: "Documento tributario no encontrado" };
  const user = await getCurrentUser(req);
  const result = await issueInvoiceWithConfiguredProvider(invoiceId, user?.id);
  await recordAuditEvent(req, {
    action: "sii.invoice_issued",
    entityType: "invoice",
    entityId: String(invoiceId),
    metadata: result,
  });
  return { ok: true, result };
}

export async function syncFinanceInvoice(
  req: Request,
  invoiceId: number,
  tenantId: number
): Promise<{ ok: true; result: any } | { ok: false; status: number; error: string }> {
  const invoice = await findInvoiceById(invoiceId, tenantId);
  if (!invoice) return { ok: false, status: 404, error: "Documento tributario no encontrado" };
  const user = await getCurrentUser(req);
  const result = await syncInvoiceWithConfiguredProvider(invoiceId, user?.id);
  await recordAuditEvent(req, {
    action: "sii.invoice_synced",
    entityType: "invoice",
    entityId: String(invoiceId),
    metadata: result,
  });
  return { ok: true, result };
}

export async function downloadFinanceInvoiceDocument(
  req: Request,
  invoiceId: number,
  format: "pdf" | "xml",
  tenantId: number
): Promise<{ ok: true; folio: number; content: Buffer | string } | { ok: false; status: number; error: string }> {
  const invoice = await findInvoiceById(invoiceId, tenantId);
  if (format === "pdf") {
    if (!invoice?.pdf_content) return { ok: false, status: 404, error: "PDF no disponible. Emite el documento primero." };
    const user = await getCurrentUser(req);
    await recordSiiDownloadEventInDb(invoiceId, user?.id || null, "pdf", tenantId);
    return { ok: true, folio: invoice.folio, content: Buffer.from(invoice.pdf_content, "base64") };
  }
  if (!invoice?.xml_content) return { ok: false, status: 404, error: "XML no disponible. Emite el documento primero." };
  const user = await getCurrentUser(req);
  await recordSiiDownloadEventInDb(invoiceId, user?.id || null, "xml", tenantId);
  return { ok: true, folio: invoice.folio, content: invoice.xml_content };
}

export async function listFinanceInvoices(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  pagination: PaginationParams;
}) {
  const branchId = params.rawBranchId ? await getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return await listInvoicesFromDb({
    tenantId: params.tenantId,
    branchId,
    status: params.status,
    pagination: params.pagination,
  });
}

