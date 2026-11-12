import { manualPaymentFieldsSchema } from '../../../../shared/schemas/payments';
import { collectionActionSchema, paymentAdjustmentSchema, reverseAllocationSchema } from '../../../../shared/schemas/finance';
import type { Express } from "express";
import { z } from "zod";
import { getCurrentUser, requireAnyRole } from "../../../auth/sessions";
import { paginatedResponse, parsePagination, queryText } from "../../../pagination";
import { getTenantIdFromRequest } from "../../../tenant";
import { dateStringSchema, optionalTextSchema, parseBody } from "../../../validation";
import { parseBranchIdQuery } from "../shared";
import {
  adjustFinancePayment,
  completeCollectionAction,
  createPaymentCollectionAction,
  downloadFinanceInvoiceDocument,
  getFinancePaymentDetail,
  getInvoicesReadiness,
  getPaymentCollectionActions,
  issueFinanceInvoice,
  listAllPaymentsWithClientName,
  listCollectionQueue,
  listFinanceInvoices,
  listFinancePayments,
  listPaymentAllocations,
  registerManualPayment,
  resolvePaymentReceiptDownload,
  reversePaymentAllocation,
  syncFinanceInvoice,
} from "./service";

const registerPaymentSchema = z.object({
  method: manualPaymentFieldsSchema.shape.method,
  payment_date: dateStringSchema.optional(),
  reference: optionalTextSchema,
  note: manualPaymentFieldsSchema.shape.note,
  receipt: z.object({
    fileName: z.string().trim().min(1).max(160),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    dataBase64: z.string().trim().min(1),
  }).optional(),
});


const allocationHistoryQuerySchema = z.object({
  payment_id: z.coerce.number().int().positive().optional(),
  bank_movement_id: z.coerce.number().int().positive().optional(),
});

const createCollectionActionSchema = collectionActionSchema;

const completeCollectionActionSchema = z.object({
  note: optionalTextSchema,
});

const collectionQueueQuerySchema = z.object({
  status: z.enum(["open", "done", "all"]).optional(),
  due: z.enum(["overdue", "today", "upcoming", "actionable", "all"]).optional(),
});

export function registerPaymentsRoutes(app: Express) {
  app.use("/api/payments", requireAnyRole(["admin", "finance"]));

  app.get("/api/payments", (_req, res) => {
    res.json(listAllPaymentsWithClientName());
  });
}

export function registerReceivablesRoutes(app: Express) {
  app.get("/api/finance/payments", (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const month = queryText(req.query.month);
    const monthField = queryText(req.query.monthField) || "any";
    const review = queryText(req.query.review);
    const cutOffDate = queryText(req.query.cutOffDate) || new Date().toISOString().slice(0, 10);
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);

    const { payments, total } = listFinancePayments({
      tenantId,
      rawBranchId,
      status,
      search,
      month,
      monthField,
      review,
      cutOffDate,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(payments, total, pagination) : payments);
  });

  app.get("/api/finance/payments/:id/detail", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const detail = getFinancePaymentDetail(req.params.id, tenantId);
    if (!detail) return res.status(404).json({ error: "Cuenta por cobrar no encontrada" });
    res.json(detail);
  });

  app.post("/api/finance/payments/:id/adjustments", (req, res) => {
    const body = parseBody(paymentAdjustmentSchema, req.body, res);
    if (!body) return;
    const user = getCurrentUser(req);
    if (user?.role !== "admin") {
      return res.status(403).json({ error: "Solo administracion puede ajustar montos de cuentas por cobrar" });
    }

    const tenantId = getTenantIdFromRequest(req);
    try {
      const result = adjustFinancePayment(req, req.params.id, tenantId, body);
      res.json({ success: true, adjustment: result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/payments/:id/collection-actions", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const actions = getPaymentCollectionActions(req.params.id, tenantId);
    if (!actions) return res.status(404).json({ error: "Pago no encontrado" });
    res.json(actions);
  });

  app.post("/api/finance/payments/:id/collection-actions", (req, res) => {
    const body = parseBody(createCollectionActionSchema, req.body, res);
    if (!body) return;

    const tenantId = getTenantIdFromRequest(req);
    const result = createPaymentCollectionAction(req, req.params.id, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true, id: result.id });
  });

  app.get("/api/finance/collection-actions", (req, res) => {
    const query = collectionQueueQuerySchema.safeParse({
      status: req.query.status || undefined,
      due: req.query.due || undefined,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de cobranza inválidos" });

    const status = query.data.status || "open";
    const due = query.data.due || "all";
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);

    res.json(listCollectionQueue({ tenantId, rawBranchId, status, due }));
  });

  app.post("/api/finance/collection-actions/:id/complete", (req, res) => {
    const body = parseBody(completeCollectionActionSchema, req.body, res);
    if (!body) return;

    const tenantId = getTenantIdFromRequest(req);
    const result = completeCollectionAction(req, req.params.id, tenantId, body.note);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    res.json({ success: true });
  });

  app.get("/api/finance/payment-allocations", (req, res) => {
    const query = allocationHistoryQuerySchema.safeParse({
      payment_id: req.query.payment_id,
      bank_movement_id: req.query.bank_movement_id,
    });
    if (!query.success) return res.status(400).json({ error: "Filtros de historial inválidos" });

    const tenantId = getTenantIdFromRequest(req);
    res.json(listPaymentAllocations({
      tenantId,
      paymentId: query.data.payment_id,
      bankMovementId: query.data.bank_movement_id,
    }));
  });

  app.post("/api/finance/payment-allocations/:id/reverse", (req, res) => {
    const user = getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede reversar abonos" });

    const body = parseBody(reverseAllocationSchema, req.body, res);
    if (!body) return;

    try {
      const tenantId = getTenantIdFromRequest(req);
      const result = reversePaymentAllocation(req, req.params.id, tenantId, body.note);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/payments/:id/receipt", (req, res) => {
    const tenantId = getTenantIdFromRequest(req);
    const result = resolvePaymentReceiptDownload(req.params.id, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.type(result.mimeType);
    res.download(result.absolutePath, result.fileName);
  });

  app.post("/api/finance/payments/:id/register", (req, res) => {
    const body = parseBody(registerPaymentSchema, req.body, res);
    if (!body) return;

    try {
      const result = registerManualPayment(req, req.params.id, body);
      res.json({
        success: true,
        folio: result.folio,
        paidAmount: result.paidAmount,
        allocatedAmount: result.allocatedAmount,
        amount: result.amount,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/finance/invoices/readiness", (req, res) => {
    res.json(getInvoicesReadiness(getTenantIdFromRequest(req)));
  });

  app.post("/api/finance/invoices/:id/issue", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    try {
      const tenantId = getTenantIdFromRequest(req);
      const outcome = issueFinanceInvoice(req, invoiceId, tenantId);
      if (outcome.ok === false) return res.status(outcome.status).json({ error: outcome.error });
      res.json({ success: true, ...outcome.result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "No se pudo emitir el documento tributario" });
    }
  });

  app.post("/api/finance/invoices/:id/sync", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    try {
      const tenantId = getTenantIdFromRequest(req);
      const outcome = syncFinanceInvoice(req, invoiceId, tenantId);
      if (outcome.ok === false) return res.status(outcome.status).json({ error: outcome.error });
      res.json({ success: true, ...outcome.result });
    } catch (error: any) {
      res.status(400).json({ error: error.message || "No se pudo sincronizar el documento tributario" });
    }
  });

  app.get("/api/finance/invoices/:id/pdf", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    const tenantId = getTenantIdFromRequest(req);
    const outcome = downloadFinanceInvoiceDocument(req, invoiceId, "pdf", tenantId);
    if (outcome.ok === false) return res.status(outcome.status).json({ error: outcome.error });

    res.setHeader("Content-Disposition", `attachment; filename="dte-${outcome.folio}.pdf"`);
    res.type("application/pdf").send(outcome.content);
  });

  app.get("/api/finance/invoices/:id/xml", (req, res) => {
    const invoiceId = Number(req.params.id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ error: "ID de documento inválido" });

    const tenantId = getTenantIdFromRequest(req);
    const outcome = downloadFinanceInvoiceDocument(req, invoiceId, "xml", tenantId);
    if (outcome.ok === false) return res.status(outcome.status).json({ error: outcome.error });

    res.setHeader("Content-Disposition", `attachment; filename="dte-${outcome.folio}.xml"`);
    res.type("application/xml").send(outcome.content);
  });

  app.get("/api/finance/invoices", (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>, 50, 200);
    const status = queryText(req.query.status);
    const tenantId = getTenantIdFromRequest(req);
    const rawBranchId = parseBranchIdQuery(req.query.branch_id);

    const { invoices, total } = listFinanceInvoices({
      tenantId,
      rawBranchId,
      status,
      pagination,
    });
    res.json(pagination.requested ? paginatedResponse(invoices, total, pagination) : invoices);
  });
}

