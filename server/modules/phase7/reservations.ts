import crypto from "node:crypto";
import type { Express } from "express";
import { reservationCreateSchema } from "../../../shared/schemas/phase7";
import { requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant } from "../../db/engine/context";
import { getTenantContextFromRequest } from "../../platform/tenant/service";
import { parseBody } from "../../validation";

export function registerReservationRoutes(app: Express) {
  app.get("/api/reservations", requireAnyRole(["admin", "finance", "guard", "cashier"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const rows = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT r.*, s.name AS space_code, c.name AS client_name
           FROM reservations r
           LEFT JOIN spaces s ON s.id = r.space_id AND s.tenant_id = r.tenant_id
           LEFT JOIN clients c ON c.id = r.client_id AND c.tenant_id = r.tenant_id
           WHERE r.tenant_id = ?
           ORDER BY r.starts_at DESC, r.id DESC
           LIMIT 100`,
        )
        .all<Record<string, unknown>>(ctx.tenant.id),
    );
    res.json({ reservations: rows });
  });

  app.post("/api/reservations", requireAnyRole(["admin", "finance", "guard", "cashier"]), async (req, res) => {
    const body = parseBody(reservationCreateSchema, req.body, res);
    if (!body) return;

    const startsMs = Date.parse(body.starts_at);
    const endsMs = Date.parse(body.ends_at);
    if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs) || startsMs >= endsMs) {
      res.status(400).json({ message: "Rango horario inválido (starts_at debe ser anterior a ends_at)" });
      return;
    }

    const ctx = await getTenantContextFromRequest(req);
    const startsIso = new Date(startsMs).toISOString();
    const endsIso = new Date(endsMs).toISOString();
    const plate = body.plate.trim().toUpperCase();
    const qrToken = `RES-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

    const result = await runWithTenant(ctx.tenant.id, async () => {
      if (body.space_id) {
        const conflict = await db
          .prepare(
            `SELECT id, plate, starts_at, ends_at
             FROM reservations
             WHERE tenant_id = ? AND space_id = ? AND status IN ('confirmed', 'checked_in')
               AND starts_at < ? AND ends_at > ?
             LIMIT 1`,
          )
          .get<{ id: number }>(ctx.tenant.id, body.space_id, endsIso, startsIso);
        if (conflict) {
          return { conflictId: conflict.id };
        }
      }

      let branchId: number | null = body.branch_id ?? null;
      if (!branchId) {
        const defaultBranch = await db
          .prepare("SELECT id FROM branches WHERE tenant_id = ? ORDER BY id ASC LIMIT 1")
          .get<{ id: number }>(ctx.tenant.id);
        branchId = defaultBranch?.id ?? null;
      }
      const inserted = await db
        .prepare(
          `INSERT INTO reservations
             (tenant_id, branch_id, space_id, client_id, plate, visitor_name, starts_at, ends_at, status, qr_token, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
        )
        .run(
          ctx.tenant.id,
          branchId,
          body.space_id ?? null,
          body.client_id ?? null,
          plate,
          body.visitor_name ?? null,
          startsIso,
          endsIso,
          qrToken,
          body.notes ?? null,
        );

      const created = await db
        .prepare("SELECT * FROM reservations WHERE tenant_id = ? AND id = ?")
        .get<Record<string, unknown>>(ctx.tenant.id, Number(inserted.lastInsertRowid));
      return { created };
    });

    if ("conflictId" in result) {
      res.status(409).json({
        message: `El espacio ya tiene una reserva superpuesta (#${result.conflictId})`,
      });
      return;
    }

    res.status(201).json({ reservation: result.created });
  });

  app.post("/api/reservations/:id/cancel", requireAnyRole(["admin", "finance", "guard", "cashier"]), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "ID de reserva inválido" });
      return;
    }
    const ctx = await getTenantContextFromRequest(req);
    const outcome = await runWithTenant(ctx.tenant.id, async () => {
      const existing = await db
        .prepare("SELECT id, status FROM reservations WHERE tenant_id = ? AND id = ?")
        .get<{ id: number; status: string }>(ctx.tenant.id, id);
      if (!existing) return { error: "not_found" as const };
      if (existing.status === "cancelled" || existing.status === "completed") {
        return { error: "invalid_state" as const };
      }
      await db
        .prepare("UPDATE reservations SET status = 'cancelled' WHERE tenant_id = ? AND id = ?")
        .run(ctx.tenant.id, id);
      const updated = await db
        .prepare("SELECT * FROM reservations WHERE tenant_id = ? AND id = ?")
        .get<Record<string, unknown>>(ctx.tenant.id, id);
      return { reservation: updated };
    });

    if ("error" in outcome) {
      res.status(outcome.error === "not_found" ? 404 : 409).json({ message: `No se pudo cancelar (${outcome.error})` });
      return;
    }
    res.json({ reservation: outcome.reservation });
  });

  app.post("/api/reservations/:id/check-in", requireAnyRole(["admin", "finance", "guard", "cashier"]), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: "ID de reserva inválido" });
      return;
    }
    const ctx = await getTenantContextFromRequest(req);
    const outcome = await runWithTenant(ctx.tenant.id, async () => {
      const existing = await db
        .prepare("SELECT id, branch_id, plate, status, qr_token FROM reservations WHERE tenant_id = ? AND id = ?")
        .get<{ id: number; branch_id: number | null; plate: string; status: string; qr_token: string }>(
          ctx.tenant.id,
          id,
        );
      if (!existing) return { error: "not_found" as const };
      if (existing.status !== "confirmed") {
        return { error: "invalid_state" as const };
      }

      await db
        .prepare("UPDATE reservations SET status = 'checked_in' WHERE tenant_id = ? AND id = ?")
        .run(ctx.tenant.id, id);

      await db
        .prepare(
          `INSERT INTO access_logs (tenant_id, branch_id, plate, access_type, status, method, reason)
           VALUES (?, ?, ?, 'entry', 'authorized', 'qr', ?)`,
        )
        .run(ctx.tenant.id, existing.branch_id, existing.plate, `Reserva ${existing.qr_token}`);

      const updated = await db
        .prepare("SELECT * FROM reservations WHERE tenant_id = ? AND id = ?")
        .get<Record<string, unknown>>(ctx.tenant.id, id);
      return { reservation: updated };
    });

    if ("error" in outcome) {
      res.status(outcome.error === "not_found" ? 404 : 409).json({ message: `No se pudo registrar ingreso (${outcome.error})` });
      return;
    }
    res.json({ reservation: outcome.reservation });
  });
}
