import { ticketEntrySchema } from '../../../shared/schemas/tickets';
import { payVisitorSchema } from '../../../shared/schemas/spaces';
import { visitorPassSchema as createVisitorPassSchema } from '../../../shared/schemas/access';
import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { sendPlanLimitError } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import { sendXlsxTable, type XlsxColumn } from "../../xlsx";
import { registerCashRoutes } from "../cash/routes";
import {
  completeVisitorTicketForRequest,
  createManualVisitorTicketForRequest,
  createVisitorPassForRequest,
  listActiveVisitorsForRequest,
  listVisitorPassesForRequest,
  listVisitorPaymentsForRequest,
  lookupVisitorTicketForRequest,
  payVisitorTicketForRequest,
  quoteVisitorTicketForRequest,
  scanVisitorPassForRequest,
} from "./service";

const createVisitorTicketSchema = ticketEntrySchema;

const lookupVisitorTicketSchema = z.object({
  plate: z.string().trim().min(1),
  lost_ticket: z.coerce.boolean().default(false),
});

const visitorPaymentsQuerySchema = z.object({
  plate: z.string().trim().optional(),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(["cash", "transfer", "card", "automatic", "other", "all"]).default("all"),
  branch_id: z.coerce.number().int().positive().optional(),
});

const visitorBranchFilterSchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
});

function toCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function registerVisitorsRoutes(app: Express) {
  app.use("/api/visitors", requireAnyRole(["admin", "guard", "cashier"]));

  registerCashRoutes(app);

  app.get("/api/visitors", (req, res) => {
    const query = visitorBranchFilterSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });
    res.json(listActiveVisitorsForRequest(req, query.data.branch_id));
  });

  app.get("/api/visitors/payments", (req, res) => {
    const query = visitorPaymentsQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cobros inválidos" });
    res.json(listVisitorPaymentsForRequest(req, query.data));
  });

  app.get("/api/visitors/payments/export.csv", requireAnyRole(["admin"]), (req, res) => {
    const query = visitorPaymentsQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cobros invalidos" });

    const rows = listVisitorPaymentsForRequest(req, query.data);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="cobros-visitas.csv"');
    res.send(
      toCsv([
        [
          "Comprobante",
          "Patente",
          "Cupo",
          "Pago",
          "Metodo",
          "Cajera",
          "Total",
          "Minutos cobrables",
          "Tarifa minuto",
          "Estado",
        ],
        ...rows.map((row) => [
          row.receipt_number,
          row.plate,
          row.space_name || "",
          row.paid_at,
          row.payment_method,
          row.cashier_name || "",
          row.amount,
          row.billable_mins || 0,
          row.rate_per_minute || 0,
          row.status,
        ]),
      ]),
    );
  });

  app.get("/api/visitors/payments/export.xlsx", requireAnyRole(["admin"]), async (req, res, next) => {
    try {
      const query = visitorPaymentsQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Filtros de cobros invalidos" });
      const rows = listVisitorPaymentsForRequest(req, query.data);
      const columns: XlsxColumn<any>[] = [
        { header: "Comprobante", width: 22, value: (row) => row.receipt_number },
        { header: "Patente", width: 14, value: (row) => row.plate },
        { header: "Cupo", width: 18, value: (row) => row.space_name || "" },
        { header: "Pago", width: 20, value: (row) => row.paid_at },
        { header: "Metodo", width: 14, value: (row) => row.payment_method },
        { header: "Cajera", width: 22, value: (row) => row.cashier_name || "" },
        { header: "Total", width: 14, value: (row) => row.amount },
        { header: "Minutos cobrables", width: 18, value: (row) => row.billable_mins || 0 },
        { header: "Tarifa minuto", width: 16, value: (row) => row.rate_per_minute || 0 },
        { header: "Estado", width: 14, value: (row) => row.status },
      ];
      await sendXlsxTable(res, { filename: "cobros-visitas.xlsx", sheetName: "Cobros visitas", columns, rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/visitors", (req, res) => {
    const body = parseBody(createVisitorTicketSchema, req.body, res);
    if (!body) return;

    try {
      res.json(createManualVisitorTicketForRequest(req, body));
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message || "No se pudo crear el ticket de visita" });
    }
  });

  app.get("/api/visitors/lookup", (req, res) => {
    const query = lookupVisitorTicketSchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Patente requerida" });

    const found = lookupVisitorTicketForRequest(req, query.data);
    if (!found) return res.status(404).json({ error: "No se encontró ticket activo para esa patente" });
    res.json(found);
  });

  app.get("/api/visitors/:id/quote", (req, res) => {
    try {
      res.json(quoteVisitorTicketForRequest(req, req.params.id));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo calcular el ticket" });
    }
  });

  app.post("/api/visitors/:id/pay", (req, res) => {
    const body = parseBody(payVisitorSchema, req.body, res);
    if (!body) return;

    try {
      res.json(payVisitorTicketForRequest(req, req.params.id, body));
    } catch (e: any) {
      const status = String(e.message || "").includes("no encontrado") ? 404 : 400;
      res.status(status).json({ error: e.message || "No se pudo registrar pago de visita" });
    }
  });

  app.post("/api/visitors/:id/complete", (req, res) => {
    const result = completeVisitorTicketForRequest(req, req.params.id);
    if (!result) return res.status(404).json({ error: "Ticket de visita no encontrado" });
    res.json(result);
  });

  app.get("/api/visitors/passes", (req, res) => {
    res.json(listVisitorPassesForRequest(req));
  });

  app.post("/api/visitors/passes", (req, res) => {
    const body = parseBody(createVisitorPassSchema, req.body, res);
    if (!body) return;

    const result = createVisitorPassForRequest(req, body);
    res.status(result.status).json(result.body);
  });

  app.post("/api/visitors/passes/:id/scan", (req, res) => {
    try {
      const result = scanVisitorPassForRequest(req, req.params.id);
      if (!result) return res.status(404).json({ error: "Pase de visita no encontrado" });
      res.json(result);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message || "No se pudo validar el pase QR" });
    }
  });
}

