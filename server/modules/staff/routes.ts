import type { Express } from "express";
import { createStaffSchema, resetStaffPasswordSchema, updateStaffSchema, updateStaffStatusSchema } from "../../../shared/schemas/staff";
import { z } from "zod";
import { requireAnyRole } from "../../auth/sessions";
import { sendPlanLimitError } from "../../tenant";
import { optionalTextSchema, parseBody } from "../../validation";
import {
  createStaffForRequest,
  listStaffAccessEventsForRequest,
  listStaffForRequest,
  resetStaffPasswordForRequest,
  updateStaffForRequest,
  updateStaffStatusForRequest,
} from "./service";

export function registerStaffRoutes(app: Express) {
  app.use("/api/staff", requireAnyRole(["admin"]));

  app.get("/api/staff", (req, res) => {
    res.json(listStaffForRequest(req));
  });

  app.post("/api/staff", (req, res) => {
    const body = parseBody(createStaffSchema, req.body, res);
    if (!body) return;

    try {
      const result = createStaffForRequest(req, body);
      res.json(result);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/staff/:id/access-events", (req, res) => {
    const result = listStaffAccessEventsForRequest(req, req.params.id);
    res.status(result.status).json(result.body);
  });

  app.patch("/api/staff/:id", (req, res) => {
    const body = parseBody(updateStaffSchema, req.body, res);
    if (!body) return;

    try {
      const result = updateStaffForRequest(req, req.params.id, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/staff/:id/status", (req, res) => {
    const body = parseBody(updateStaffStatusSchema, req.body, res);
    if (!body) return;

    try {
      const result = updateStaffStatusForRequest(req, req.params.id, body);
      res.status(result.status).json(result.body);
    } catch (e: any) {
      if (sendPlanLimitError(res, e)) return;
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/staff/:id/password", (req, res) => {
    const body = parseBody(resetStaffPasswordSchema, req.body, res);
    if (!body) return;

    const result = resetStaffPasswordForRequest(req, req.params.id, body);
    res.status(result.status).json(result.body);
  });
}

