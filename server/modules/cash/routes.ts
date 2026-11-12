import type { Express } from "express";
import { closeVisitorCashSessionSchema } from "../../../shared/schemas/spaces";
import { z } from "zod";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { getTenantIdFromRequest } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import { sendXlsxTable, type XlsxColumn } from "../../xlsx";
import {
  closeCurrentVisitorCashSessionForRequest,
  ensureOpenCashSession,
  getCashSessionOperationalSummary,
  getVisitorCashClosures,
} from "./service";

const visitorCashCurrentQuerySchema = z.object({
  branch_id: z.coerce.number().int().positive().optional(),
});

const visitorCashClosuresQuerySchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  branch_id: z.coerce.number().int().positive().optional(),
});

function toCsv(rows: unknown[][]) {
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(escape).join(",")).join("\n");
}

export function registerCashRoutes(app: Express) {
  app.get("/api/visitors/cash/current", (req, res) => {
    try {
      const query = visitorCashCurrentQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Filtro de sucursal invalido" });
      const currentUser = getCurrentUser(req);
      const tenantId = getTenantIdFromRequest(req);
      const cashSession = ensureOpenCashSession(currentUser, null, {
        tenantId,
        branchId: query.data.branch_id || null,
      });
      res.json(getCashSessionOperationalSummary(cashSession.id, { tenantId }));
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo obtener la caja actual" });
    }
  });

  app.get("/api/visitors/cash/closures", (req, res) => {
    const query = visitorCashClosuresQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });

    const closures = getVisitorCashClosures(query.data, getCurrentUser(req), getTenantIdFromRequest(req)).slice(0, 50);
    res.json(closures);
  });

  app.post("/api/visitors/cash/current/close", (req, res) => {
    const body = parseBody(closeVisitorCashSessionSchema, req.body, res);
    if (!body) return;

    try {
      const result = closeCurrentVisitorCashSessionForRequest(req, body);
      if (!result) return res.status(400).json({ error: "No hay caja abierta para cerrar" });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo cerrar la caja" });
    }
  });

  app.get("/api/visitors/cash/closures/export.csv", requireAnyRole(["admin"]), (req, res) => {
    const query = visitorCashClosuresQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });

    const rows = getVisitorCashClosures(query.data, getCurrentUser(req), getTenantIdFromRequest(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="cierres-caja-visitas.csv"');
    res.send(
      toCsv([
        [
          "Caja",
          "Apertura",
          "Cierre",
          "Responsable",
          "Tickets",
          "Efectivo esperado",
          "Efectivo contado",
          "Tarjeta contada",
          "Transferencia contada",
          "Diferencia",
          "Notas",
        ],
        ...rows.map((row) => [
          row.id,
          row.opened_at,
          row.closed_at,
          row.staff_name || row.closed_by_name || "",
          row.tickets_count,
          row.expected_cash,
          row.counted_cash,
          row.counted_card,
          row.counted_transfer,
          row.difference_cash,
          row.notes || "",
        ]),
      ]),
    );
  });

  app.get("/api/visitors/cash/closures/export.xlsx", requireAnyRole(["admin"]), async (req, res, next) => {
    try {
      const query = visitorCashClosuresQuerySchema.safeParse(req.query);
      if (!query.success) return res.status(400).json({ error: "Filtros de cierre invalidos" });
      const rows = getVisitorCashClosures(query.data, getCurrentUser(req), getTenantIdFromRequest(req));
      const columns: XlsxColumn<any>[] = [
        { header: "Caja", width: 10, value: (row) => row.id },
        { header: "Apertura", width: 20, value: (row) => row.opened_at },
        { header: "Cierre", width: 20, value: (row) => row.closed_at },
        { header: "Responsable", width: 22, value: (row) => row.staff_name || row.closed_by_name || "" },
        { header: "Tickets", width: 10, value: (row) => row.tickets_count },
        { header: "Efectivo esperado", width: 18, value: (row) => row.expected_cash },
        { header: "Efectivo contado", width: 18, value: (row) => row.counted_cash },
        { header: "Tarjeta contada", width: 18, value: (row) => row.counted_card },
        { header: "Transferencia contada", width: 22, value: (row) => row.counted_transfer },
        { header: "Diferencia", width: 14, value: (row) => row.difference_cash },
        { header: "Notas", width: 28, value: (row) => row.notes || "" },
      ];
      await sendXlsxTable(res, { filename: "cierres-caja-visitas.xlsx", sheetName: "Cierres caja", columns, rows });
    } catch (error) {
      next(error);
    }
  });
}

