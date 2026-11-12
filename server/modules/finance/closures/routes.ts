import type { Express } from "express";
import { z } from "zod";
import { getCurrentUser } from "../../../auth/sessions";
import { getTenantIdFromRequest } from "../../../tenant";
import { optionalTextSchema, parseBody } from "../../../validation";
import { monthQuerySchema } from "../shared";
import {
  closeFinanceMonth,
  getMonthlyClosure,
  listMonthlyClosures,
  reopenFinanceMonth,
} from "./service";

const closeMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  accepted_pending_note: optionalTextSchema,
});

const reopenMonthSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export function registerClosuresRoutes(app: Express) {
  app.get("/api/finance/monthly-closures", async (req, res) => {
    const query = monthQuerySchema.safeParse({ month: req.query.month || undefined });
    if (!query.success) return res.status(400).json({ error: "Mes inválido" });

    const tenantId = await getTenantIdFromRequest(req);

    if (query.data.month) {
      return res.json({ closure: await getMonthlyClosure(query.data.month, tenantId) });
    }

    res.json({ closures: await listMonthlyClosures(tenantId) });
  });

  app.post("/api/finance/monthly-closures", async (req, res) => {
    const user = await getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede cerrar meses financieros" });

    const body = parseBody(closeMonthSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await closeFinanceMonth(req, user.id, tenantId, body);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.json({ success: true, closure: result.closure, notificationTaskId: result.notificationTaskId });
  });

  app.post("/api/finance/monthly-closures/:month/reopen", async (req, res) => {
    const user = await getCurrentUser(req);
    if (user?.role !== "admin") return res.status(403).json({ error: "Solo administración puede reabrir meses financieros" });

    const month = z.string().regex(/^\d{4}-\d{2}$/).safeParse(req.params.month);
    if (!month.success) return res.status(400).json({ error: "Mes inválido" });
    const body = parseBody(reopenMonthSchema, req.body, res);
    if (!body) return;

    const tenantId = await getTenantIdFromRequest(req);
    const result = await reopenFinanceMonth(req, month.data, user.id, body.reason, tenantId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });

    res.json({ success: true, closure: result.closure, notificationTaskId: result.notificationTaskId });
  });
}

