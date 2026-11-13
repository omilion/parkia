import type { Express } from "express";
import { z } from "zod";
import { syncRequestSchema } from "../../../shared/schemas/operator";
import { requireAnyRole } from "../../auth/sessions";
import { getTenantIdFromRequest } from "../../tenant";
import { parseBody } from "../../validation";
import { buildTicketReceipt } from "./receipt";
import { buildOperatorSnapshot } from "./snapshot";
import { processOperations } from "./sync";

/** Soporte del modo sin conexión del operador (guardia, caja y administrador). */
export function registerOperatorRoutes(app: Express) {
  const operators = requireAnyRole(["admin", "guard", "cashier"]);

  /** Datos de una sucursal para operar sin red: plazas, tickets abiertos y catálogo de tarifas. */
  app.get("/api/operator/snapshot", operators, async (req, res) => {
    const query = z.object({ branch_id: z.coerce.number().int().positive() }).safeParse(req.query);
    if (!query.success) return res.status(400).json({ error: "Indica la sucursal" });
    const snapshot = await buildOperatorSnapshot(await getTenantIdFromRequest(req), query.data.branch_id);
    if (!snapshot) return res.status(404).json({ error: "Sucursal no encontrada" });
    res.json(snapshot);
  });

  /** Datos del comprobante de un ticket (con el timbre de la boleta si ya se emitió). */
  app.get("/api/operator/tickets/:id/receipt", operators, async (req, res) => {
    const id = Number(req.params.id);
    const receipt = Number.isInteger(id) && id > 0 ? await buildTicketReceipt(await getTenantIdFromRequest(req), id) : null;
    if (!receipt) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json(receipt);
  });

  /** Aplica un lote de operaciones guardadas sin conexión. Idempotente por `client_uuid`. */
  app.post("/api/operator/sync", operators, async (req, res) => {
    const body = parseBody(syncRequestSchema, req.body, res);
    if (!body) return;
    res.json({ server_time: new Date().toISOString(), results: await processOperations(req, body.operations) });
  });
}
