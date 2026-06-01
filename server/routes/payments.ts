import type { Express } from "express";
import { requireAnyRole } from "../auth/sessions";
import { db } from "../db";

export function registerPaymentsRoutes(app: Express) {
  app.use("/api/payments", requireAnyRole(["admin", "finance"]));

  app.get("/api/payments", (req, res) => {
    const payments = db.prepare(`
      SELECT p.*, cl.name as client_name 
      FROM payments p 
      JOIN contracts c ON p.contract_id = c.id 
      JOIN clients cl ON c.client_id = cl.id
    `).all();
    res.json(payments);
  });
}
