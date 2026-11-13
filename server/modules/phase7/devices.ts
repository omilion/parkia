import { createHash, randomBytes } from "node:crypto";
import { assertSafeRelayUrl, UnsafeRelayUrlError } from "./relayUrl";
import type { Express, Request, Response } from "express";
import {
  deviceCommandCreateSchema,
  deviceCreateSchema,
  deviceEventIngestSchema,
} from "../../../shared/schemas/devices";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { getTenantContextFromRequest } from "../../platform/tenant/service";
import { parseBody } from "../../validation";

export type DeviceRow = {
  id: number;
  tenant_id: number;
  branch_id: number | null;
  name: string;
  type: "lpr" | "barrier" | "totem" | "pos";
  direction: "entry" | "exit" | "both";
  vendor: "generic" | "hikvision" | "dahua" | "shelly";
  endpoint_url: string | null;
  api_key_prefix: string;
  status: "active" | "inactive";
  last_seen_at: string | null;
  created_at: string;
};

export function hashDeviceApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function normalizePlate(raw?: string | null): string | null {
  const cleaned = String(raw || "")
    .replace(/[^0-9a-zA-Z]/g, "")
    .toUpperCase();
  return cleaned.length >= 4 ? cleaned : null;
}

export function extractLprPlate(payload: Record<string, unknown>): string | null {
  const direct =
    (typeof payload.plate === "string" && payload.plate) ||
    (typeof payload.licensePlate === "string" && payload.licensePlate) ||
    (typeof payload.PlateNumber === "string" && payload.PlateNumber) ||
    "";
  if (direct) return normalizePlate(direct);

  const anpr = payload.ANPR as Record<string, unknown> | undefined;
  if (anpr && typeof anpr.licensePlate === "string") {
    return normalizePlate(anpr.licensePlate);
  }

  const picture = payload.Picture as Record<string, unknown> | undefined;
  const plateObj = picture?.Plate as Record<string, unknown> | undefined;
  if (plateObj && typeof plateObj.PlateNumber === "string") {
    return normalizePlate(plateObj.PlateNumber);
  }

  return null;
}

export interface BarrierRelayAdapter {
  trigger(device: DeviceRow, command: "open_barrier" | "close_barrier" | "ping"): Promise<{ ok: boolean; detail?: string }>;
}

let activeBarrierAdapter: BarrierRelayAdapter = {
  async trigger(device, command) {
    if (device.vendor === "shelly" && device.endpoint_url && command !== "ping") {
      const turn = command === "open_barrier" ? "on" : "off";
      const sep = device.endpoint_url.includes("?") ? "&" : "?";
      const url = `${device.endpoint_url}${sep}turn=${turn}`;
      try {
        // La URL la escribe cada empresa: se vuelve a validar en cada llamada (red interna, metadatos, localhost).
        await assertSafeRelayUrl(url);
        // Sin redirecciones (podrian llevar a una direccion interna) y con tiempo maximo: la barrera es un dispositivo fisico.
        const res = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
        return { ok: res.ok, detail: `shelly_http_${res.status}` };
      } catch (err) {
        if (err instanceof UnsafeRelayUrlError) return { ok: false, detail: "relay_url_blocked" };
        return { ok: false, detail: err instanceof Error ? err.message : "shelly_error" };
      }
    }
    return { ok: true, detail: "queued_for_poll" };
  },
};

export function setBarrierRelayAdapter(adapter: BarrierRelayAdapter) {
  activeBarrierAdapter = adapter;
}

function extractDeviceKey(req: Request): string | null {
  const headerKey = req.get("x-device-key");
  if (headerKey?.trim()) return headerKey.trim();
  const auth = req.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

async function authenticateDevice(req: Request, res: Response): Promise<DeviceRow | null> {
  const rawKey = extractDeviceKey(req);
  if (!rawKey) {
    res.status(401).json({ error: "Falta clave de dispositivo (X-Device-Key)" });
    return null;
  }
  const keyHash = hashDeviceApiKey(rawKey);
  const device = await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT id, tenant_id, branch_id, name, type, direction, vendor, endpoint_url, api_key_prefix, status, last_seen_at, created_at
         FROM devices
         WHERE api_key_hash = ?
         LIMIT 1`,
      )
      .get<DeviceRow>(keyHash),
  );
  if (!device || device.status !== "active") {
    res.status(401).json({ error: "Clave de dispositivo inválida o inactiva" });
    return null;
  }
  await runWithTenant(device.tenant_id, async () => {
    await db
      .prepare("UPDATE devices SET last_seen_at = datetime('now') WHERE tenant_id = ? AND id = ?")
      .run(device.tenant_id, device.id);
  });
  return device;
}

export function registerDevicePublicRoutes(app: Express) {
  app.post("/api/device/v1/events", async (req, res) => {
    const device = await authenticateDevice(req, res);
    if (!device) return;

    const body = parseBody(deviceEventIngestSchema, req.body, res);
    if (!body) return;

    const plate = extractLprPlate(body as Record<string, unknown>);
    const eventType = body.event_type || (plate ? "lpr_plate" : "barrier_status");

    const result = await runWithTenant(device.tenant_id, async () => {
      let decision: "allow" | "deny" | "logged" = "logged";
      let reason = "evento_registrado";
      let ticketId: number | null = null;
      let queuedCommandId: number | null = null;

      if (eventType === "lpr_plate" && plate) {
        const subscriberVehicle = await db
          .prepare(
            `SELECT v.id AS vehicle_id, c.id AS contract_id
             FROM vehicles v
             JOIN contracts c ON c.client_id = v.client_id AND c.tenant_id = v.tenant_id
             WHERE v.tenant_id = ? AND UPPER(REPLACE(v.plate, '-', '')) = ? AND c.status = 'active'
             LIMIT 1`,
          )
          .get<{ vehicle_id: number; contract_id: number }>(device.tenant_id, plate);

        if (subscriberVehicle) {
          decision = "allow";
          reason = "abonado_activo";
        } else {
          const activeTicket = await db
            .prepare(
              `SELECT id, status
               FROM visitor_tickets
               WHERE tenant_id = ? AND UPPER(REPLACE(COALESCE(plate, ''), '-', '')) = ?
               ORDER BY id DESC
               LIMIT 1`,
            )
            .get<{ id: number; status: string }>(device.tenant_id, plate);

          if (activeTicket) {
            ticketId = Number(activeTicket.id);
            if (device.direction === "exit") {
              if (activeTicket.status === "paid") {
                decision = "allow";
                reason = "ticket_pagado";
              } else if (activeTicket.status === "active") {
                decision = "deny";
                reason = "ticket_pendiente_de_pago";
              } else {
                // Un ticket ya cerrado (el auto ya salio con el) no autoriza otra salida: que lo revise una persona.
                decision = "deny";
                reason = "ticket_ya_cerrado";
              }
            }
          }
        }

        // Solo las decisiones reales van a la bitacora de accesos (que no admite "sin decision"): una placa
        // que solo se registro no fue "autorizada". El evento queda igual en device_events.
        if (decision !== "logged") {
          await db
            .prepare(
              `INSERT INTO access_logs (tenant_id, branch_id, plate, access_type, status, method, reason)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              device.tenant_id,
              device.branch_id,
              plate,
              device.direction === "exit" ? "exit" : "entry",
              decision === "deny" ? "denied" : "authorized",
              "manual",
              `${device.vendor}:${reason}`,
            );
        }

        if (decision === "allow") {
          const barrier = device.branch_id
            ? await db
                .prepare(
                  `SELECT id FROM devices
                   WHERE tenant_id = ? AND type = 'barrier' AND status = 'active' AND branch_id = ?
                   ORDER BY id ASC
                   LIMIT 1`,
                )
                .get<{ id: number }>(device.tenant_id, device.branch_id)
            : await db
                .prepare(
                  `SELECT id FROM devices
                   WHERE tenant_id = ? AND type = 'barrier' AND status = 'active'
                   ORDER BY id ASC
                   LIMIT 1`,
                )
                .get<{ id: number }>(device.tenant_id);
          if (barrier) {
            const cmdRes = await db
              .prepare(
                `INSERT INTO device_commands (tenant_id, device_id, command, payload_json, status)
                 VALUES (?, ?, 'open_barrier', ?, 'pending')`,
              )
              .run(device.tenant_id, barrier.id, JSON.stringify({ plate, source_device_id: device.id }));
            queuedCommandId = Number(cmdRes.lastInsertRowid);
          }
        }
      }

      const evRes = await db
        .prepare(
          `INSERT INTO device_events (tenant_id, device_id, event_type, plate, ticket_id, payload_json, status)
           VALUES (?, ?, ?, ?, ?, ?, 'processed')`,
        )
        .run(device.tenant_id, device.id, eventType, plate, ticketId, JSON.stringify(body));

      return {
        event_id: Number(evRes.lastInsertRowid),
        device_id: device.id,
        event_type: eventType,
        plate,
        decision,
        reason,
        queued_command_id: queuedCommandId,
      };
    });

    res.status(201).json(result);
  });

  app.get("/api/device/v1/commands/poll", async (req, res) => {
    const device = await authenticateDevice(req, res);
    if (!device) return;

    const commands = await runWithTenant(device.tenant_id, async () => {
      const pending = await db
        .prepare(
          `SELECT id, command, payload_json, created_at
           FROM device_commands
           WHERE tenant_id = ? AND device_id = ? AND status = 'pending'
           ORDER BY id ASC
           LIMIT 20`,
        )
        .all<{ id: number; command: string; payload_json: string | null; created_at: string }>(
          device.tenant_id,
          device.id,
        );

      for (const cmd of pending) {
        await db
          .prepare(
            `UPDATE device_commands
             SET status = 'delivered', delivered_at = datetime('now')
             WHERE tenant_id = ? AND id = ?`,
          )
          .run(device.tenant_id, cmd.id);
      }
      return pending.map((c) => ({
        id: Number(c.id),
        command: c.command,
        payload: c.payload_json ? JSON.parse(c.payload_json) : null,
        created_at: c.created_at,
      }));
    });

    res.json({ commands });
  });

  app.post("/api/device/v1/commands/:id/ack", async (req, res) => {
    const device = await authenticateDevice(req, res);
    if (!device) return;
    const cmdId = Number(req.params.id);
    if (!Number.isInteger(cmdId) || cmdId <= 0) {
      res.status(400).json({ error: "ID de comando inválido" });
      return;
    }

    const updated = await runWithTenant(device.tenant_id, async () => {
      const resUpdate = await db
        .prepare(
          `UPDATE device_commands
           SET status = 'acked', acked_at = datetime('now')
           WHERE tenant_id = ? AND device_id = ? AND id = ?`,
        )
        .run(device.tenant_id, device.id, cmdId);
      return Number(resUpdate.changes || 0);
    });

    if (updated === 0) {
      res.status(404).json({ error: "Comando no encontrado" });
      return;
    }
    res.json({ success: true, id: cmdId, status: "acked" });
  });
}

export function registerDeviceAdminRoutes(app: Express) {
  app.get("/api/devices", requireAnyRole(["admin", "guard"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const devices = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT id, tenant_id, branch_id, name, type, direction, vendor, endpoint_url,
                  api_key_prefix, status, last_seen_at, created_at
           FROM devices
           WHERE tenant_id = ?
           ORDER BY id DESC`,
        )
        .all<DeviceRow>(ctx.tenant.id),
    );
    res.json({ devices });
  });

  app.get("/api/devices/events", requireAnyRole(["admin", "guard"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const events = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT e.id, e.device_id, d.name AS device_name, d.type AS device_type,
                  e.event_type, e.plate, e.ticket_id, e.status, e.created_at
           FROM device_events e
           JOIN devices d ON d.id = e.device_id
           WHERE e.tenant_id = ?
           ORDER BY e.id DESC
           LIMIT 50`,
        )
        .all<Record<string, unknown>>(ctx.tenant.id),
    );
    res.json({ events });
  });

  app.post("/api/devices", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(deviceCreateSchema, req.body, res);
    if (!body) return;
    if (body.endpoint_url) {
      try {
        await assertSafeRelayUrl(body.endpoint_url);
      } catch (error) {
        if (error instanceof UnsafeRelayUrlError) return void res.status(400).json({ error: error.message, code: "RELAY_URL_NOT_ALLOWED" });
        throw error;
      }
    }
    const ctx = await getTenantContextFromRequest(req);
    const rawKey = `pk_dev_${randomBytes(18).toString("hex")}`;
    const keyHash = hashDeviceApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);

    const createdId = await runWithTenant(ctx.tenant.id, async () => {
      const insert = await db
        .prepare(
          `INSERT INTO devices (
             tenant_id, branch_id, name, type, direction, vendor, endpoint_url, api_key_hash, api_key_prefix
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ctx.tenant.id,
          body.branch_id ?? null,
          body.name,
          body.type,
          body.direction,
          body.vendor,
          body.endpoint_url ? body.endpoint_url : null,
          keyHash,
          keyPrefix,
        );
      return Number(insert.lastInsertRowid);
    });

    res.status(201).json({
      id: createdId,
      name: body.name,
      type: body.type,
      direction: body.direction,
      vendor: body.vendor,
      api_key: rawKey,
      api_key_prefix: keyPrefix,
    });
  });

  app.post("/api/devices/:id/commands", requireAnyRole(["admin", "guard"]), async (req, res) => {
    const body = parseBody(deviceCommandCreateSchema, req.body, res);
    if (!body) return;
    const deviceId = Number(req.params.id);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      res.status(400).json({ error: "ID de dispositivo inválido" });
      return;
    }

    const [ctx, user] = await Promise.all([getTenantContextFromRequest(req), getCurrentUser(req)]);
    const device = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT id, tenant_id, branch_id, name, type, direction, vendor, endpoint_url,
                  api_key_prefix, status, last_seen_at, created_at
           FROM devices
           WHERE tenant_id = ? AND id = ?
           LIMIT 1`,
        )
        .get<DeviceRow>(ctx.tenant.id, deviceId),
    );
    if (!device) {
      res.status(404).json({ error: "Dispositivo no encontrado" });
      return;
    }

    const relayResult = await activeBarrierAdapter.trigger(device, body.command);
    const cmdId = await runWithTenant(ctx.tenant.id, async () => {
      const insert = await db
        .prepare(
          `INSERT INTO device_commands (
             tenant_id, device_id, command, payload_json, status, requested_by_staff_id
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ctx.tenant.id,
          device.id,
          body.command,
          body.payload ? JSON.stringify(body.payload) : null,
          device.vendor === "shelly" && device.endpoint_url ? (relayResult.ok ? "acked" : "failed") : "pending",
          user?.id ?? null,
        );
      return Number(insert.lastInsertRowid);
    });

    res.status(201).json({
      id: cmdId,
      device_id: device.id,
      command: body.command,
      relay: relayResult,
    });
  });

  app.delete("/api/devices/:id", requireAnyRole(["admin"]), async (req, res) => {
    const deviceId = Number(req.params.id);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      res.status(400).json({ error: "ID de dispositivo inválido" });
      return;
    }
    const ctx = await getTenantContextFromRequest(req);
    await runWithTenant(ctx.tenant.id, async () => {
      await db
        .prepare("UPDATE devices SET status = 'inactive' WHERE tenant_id = ? AND id = ?")
        .run(ctx.tenant.id, deviceId);
    });
    res.json({ success: true });
  });
}

