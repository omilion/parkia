import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { sendPlanLimitError } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import {
  createBranchForRequest,
  listBranchesForRequest,
  updateBranchForRequest,
} from "./service";

export const branchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(30).toUpperCase(),
  address: optionalTextSchema,
  commune: optionalTextSchema,
  city: optionalTextSchema,
  phone: optionalTextSchema,
  timezone: optionalTextSchema,
  status: z.enum(["active", "inactive"]).default("active"),
});

const updateBranchSchema = branchSchema.partial().extend({
  reason: z.string().trim().min(3).max(500),
});

export function registerBranchesRoutes(app: Express) {
  app.use("/api/branches", requireAnyRole(["admin", "finance", "guard", "cashier"]));

  app.get("/api/branches", (req, res) => {
    res.json(listBranchesForRequest(req));
  });

  app.post("/api/branches", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(branchSchema, req.body, res);
    if (!body) return;

    try {
      const result = createBranchForRequest(req, body);
      res.json(result);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message || "No se pudo crear la sucursal" });
    }
  });

  app.patch("/api/branches/:id", requireAnyRole(["admin"]), (req, res) => {
    const body = parseBody(updateBranchSchema, req.body, res);
    if (!body) return;

    try {
      const result = updateBranchForRequest(req, req.params.id, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message || "No se pudo actualizar la sucursal" });
    }
  });
}
