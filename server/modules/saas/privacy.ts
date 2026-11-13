import type { Express } from "express";
import { privacyConsentCreateSchema, privacyTitularDeleteSchema } from "../../../shared/schemas/privacy";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { getTenantContextFromRequest } from "../../platform/tenant/service";
import { parseBody } from "../../validation";

function normalizeRut(value?: string | null): string {
  return String(value || "")
    .replace(/[^0-9kK]/g, "")
    .toUpperCase();
}

function normalizePlate(value?: string | null): string {
  return String(value || "")
    .replace(/[^0-9a-zA-Z]/g, "")
    .toUpperCase();
}

function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function getDefaultRetentionDays(): number {
  const raw = Number(process.env.PARKIA_PRIVACY_TICKET_RETENTION_DAYS || 90);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
}

export interface TitularQuery {
  rut?: string;
  plate?: string;
  email?: string;
}

async function findMatchingClients(tenantId: number, query: TitularQuery) {
  const rutNorm = normalizeRut(query.rut);
  const emailNorm = normalizeEmail(query.email);
  const plateNorm = normalizePlate(query.plate);

  const allClients = await db
    .prepare(
      `SELECT id, tenant_id, name, email, phone, rut, type, status, address, commune, city,
              business_activity, legal_representative_name, legal_representative_rut,
              billing_contact_name, billing_contact_email, billing_contact_phone,
              anonymized_at, created_at
       FROM clients
       WHERE tenant_id = ?`,
    )
    .all<Record<string, unknown>>(tenantId);

  const clientIdsFromVehicles = new Set<number>();
  if (plateNorm) {
    const vehicles = await db
      .prepare("SELECT id, client_id, plate FROM vehicles WHERE tenant_id = ?")
      .all<{ id: number; client_id: number; plate: string }>(tenantId);
    for (const v of vehicles) {
      if (normalizePlate(v.plate) === plateNorm) {
        clientIdsFromVehicles.add(Number(v.client_id));
      }
    }
  }

  return allClients.filter((c) => {
    const id = Number(c.id);
    if (rutNorm && normalizeRut(String(c.rut || "")) === rutNorm) return true;
    if (emailNorm && normalizeEmail(String(c.email || "")) === emailNorm) return true;
    if (clientIdsFromVehicles.has(id)) return true;
    return false;
  });
}

export async function exportTitularData(tenantId: number, query: TitularQuery) {
  return await runWithTenant(tenantId, async () => {
    const matchedClients = await findMatchingClients(tenantId, query);
    const clientIds = matchedClients.map((c) => Number(c.id));
    const plateNorm = normalizePlate(query.plate);
    const rutNorm = normalizeRut(query.rut);
    const emailNorm = normalizeEmail(query.email);

    const allVehicles = await db
      .prepare("SELECT id, client_id, plate, brand, model, color, status FROM vehicles WHERE tenant_id = ?")
      .all<Record<string, unknown>>(tenantId);
    const matchedVehicles = allVehicles.filter(
      (v) => clientIds.includes(Number(v.client_id)) || (plateNorm && normalizePlate(String(v.plate || "")) === plateNorm),
    );

    const contracts =
      clientIds.length > 0
        ? await db
            .prepare(
              `SELECT id, client_id, space_id, monthly_fee, start_date, end_date, status
               FROM contracts
               WHERE tenant_id = ? AND client_id IN (${clientIds.map(() => "?").join(", ")})`,
            )
            .all<Record<string, unknown>>(tenantId, ...clientIds)
        : [];

    const allTickets = await db
      .prepare(
        `SELECT id, branch_id, plate, entry_time, exit_time, paid_at, amount, status, payment_method, anonymized_at
         FROM visitor_tickets
         WHERE tenant_id = ?`,
      )
      .all<Record<string, unknown>>(tenantId);
    const matchedPlates = new Set<string>(
      [plateNorm, ...matchedVehicles.map((v) => normalizePlate(String(v.plate || "")))].filter(Boolean),
    );
    const matchedTickets = allTickets.filter((t) => matchedPlates.has(normalizePlate(String(t.plate || ""))));

    const contractIds = contracts.map((c) => Number(c.id));
    const payments =
      contractIds.length > 0
        ? await db
            .prepare(
              `SELECT id, contract_id, amount, due_date, payment_date, status, method
               FROM payments
               WHERE tenant_id = ? AND contract_id IN (${contractIds.map(() => "?").join(", ")})`,
            )
            .all<Record<string, unknown>>(tenantId, ...contractIds)
        : [];

    const invoices =
      clientIds.length > 0
        ? await db
            .prepare(
              `SELECT id, client_id, payment_id, folio, type, amount, status_sii, date
               FROM invoices
               WHERE tenant_id = ? AND client_id IN (${clientIds.map(() => "?").join(", ")})`,
            )
            .all<Record<string, unknown>>(tenantId, ...clientIds)
        : [];

    const allConsents = await db
      .prepare(
        `SELECT id, subject_type, subject_id, subject_identifier, purpose, policy_version, granted, created_at
         FROM privacy_consents
         WHERE tenant_id = ?
         ORDER BY id DESC`,
      )
      .all<Record<string, unknown>>(tenantId);
    const matchedConsents = allConsents.filter((row) => {
      const ident = String(row.subject_identifier || "");
      if (emailNorm && normalizeEmail(ident) === emailNorm) return true;
      if (rutNorm && normalizeRut(ident) === rutNorm) return true;
      if (plateNorm && normalizePlate(ident) === plateNorm) return true;
      return row.subject_type === "client" && clientIds.includes(Number(row.subject_id));
    });

    return {
      exported_at: new Date().toISOString(),
      query: {
        rut: query.rut || null,
        plate: query.plate || null,
        email: query.email || null,
      },
      clients: matchedClients,
      vehicles: matchedVehicles,
      contracts,
      visitor_tickets: matchedTickets,
      payments,
      tax_documents: invoices,
      consents: matchedConsents,
    };
  });
}

export async function anonymizeTitularData(
  tenantId: number,
  actorStaffId: number,
  input: TitularQuery & { reason: string },
) {
  return await runWithTenant(tenantId, async () => {
    const matchedClients = await findMatchingClients(tenantId, input);
    const clientIds = matchedClients.map((c) => Number(c.id));
    const plateNorm = normalizePlate(input.plate);

    const tx = db.transaction(async () => {
      let clientsAnonymized = 0;
      for (const client of matchedClients) {
        if (client.anonymized_at) continue;
        const clientId = Number(client.id);
        await db
          .prepare(
            `UPDATE clients
             SET name = ?,
                 rut = NULL,
                 email = NULL,
                 phone = NULL,
                 address = NULL,
                 commune = NULL,
                 city = NULL,
                 business_activity = NULL,
                 legal_representative_name = NULL,
                 legal_representative_rut = NULL,
                 billing_contact_name = NULL,
                 billing_contact_email = NULL,
                 billing_contact_phone = NULL,
                 notes = NULL,
                 status = 'archived',
                 anonymized_at = datetime('now')
             WHERE tenant_id = ? AND id = ?`,
          )
          .run(`Titular Anonimizado #${clientId}`, tenantId, clientId);
        clientsAnonymized += 1;
      }

      const allVehicles = await db
        .prepare("SELECT id, client_id, plate FROM vehicles WHERE tenant_id = ?")
        .all<{ id: number; client_id: number; plate: string }>(tenantId);
      const matchedVehicles = allVehicles.filter(
        (v) =>
          clientIds.includes(Number(v.client_id)) ||
          (plateNorm && normalizePlate(v.plate) === plateNorm),
      );
      const matchedPlates = new Set<string>(
        [plateNorm, ...matchedVehicles.map((v) => normalizePlate(v.plate))].filter(Boolean),
      );

      let vehiclesAnonymized = 0;
      for (const vehicle of matchedVehicles) {
        const vehicleId = Number(vehicle.id);
        if (String(vehicle.plate).startsWith("ANON-")) continue;
        await db
          .prepare(
            `UPDATE vehicles
             SET plate = ?, brand = NULL, model = NULL, color = NULL, notes = NULL, status = 'inactive'
             WHERE tenant_id = ? AND id = ?`,
          )
          .run(`ANON-${vehicleId}`, tenantId, vehicleId);
        vehiclesAnonymized += 1;
      }

      const allTickets = await db
        .prepare("SELECT id, plate, anonymized_at FROM visitor_tickets WHERE tenant_id = ? AND anonymized_at IS NULL")
        .all<{ id: number; plate: string | null; anonymized_at: string | null }>(tenantId);

      let ticketsAnonymized = 0;
      for (const ticket of allTickets) {
        if (!ticket.plate || !matchedPlates.has(normalizePlate(ticket.plate))) continue;
        const ticketId = Number(ticket.id);
        await db
          .prepare(
            `UPDATE visitor_tickets
             SET plate = ?, anonymized_at = datetime('now')
             WHERE tenant_id = ? AND id = ?`,
          )
          .run(`ANON-${ticketId}`, tenantId, ticketId);
        ticketsAnonymized += 1;
      }

      await db
        .prepare(
          `INSERT INTO audit_events (tenant_id, staff_id, action, entity_type, entity_id, metadata)
           VALUES (?, ?, 'privacy.titular_anonymized', 'privacy', ?, ?)`,
        )
        .run(
          tenantId,
          actorStaffId,
          input.rut || input.plate || input.email || "titular",
          JSON.stringify({
            reason: input.reason,
            clients_anonymized: clientsAnonymized,
            vehicles_anonymized: vehiclesAnonymized,
            tickets_anonymized: ticketsAnonymized,
            tax_documents_preserved: true,
          }),
        );

      return {
        clients_anonymized: clientsAnonymized,
        vehicles_anonymized: vehiclesAnonymized,
        tickets_anonymized: ticketsAnonymized,
        tax_documents_preserved: true,
      };
    });

    return await tx();
  });
}

export async function runPrivacyRetentionJob(retentionDays = getDefaultRetentionDays()): Promise<{
  ticketsAnonymized: number;
  verificationsPurged: number;
}> {
  return await runWithoutTenant(async () => {
    const ticketCutoffIso = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const expiredTickets = await db
      .prepare(
        `SELECT id
         FROM visitor_tickets
         WHERE status IN ('completed', 'paid')
           AND anonymized_at IS NULL
           AND COALESCE(exit_time, entry_time) < ?`,
      )
      .all<{ id: number }>(ticketCutoffIso);

    let ticketsAnonymized = 0;
    for (const row of expiredTickets) {
      const id = Number(row.id);
      await db
        .prepare(
          `UPDATE visitor_tickets
           SET plate = ?, anonymized_at = datetime('now')
           WHERE id = ? AND anonymized_at IS NULL`,
        )
        .run(`ANON-${id}`, id);
      ticketsAnonymized += 1;
    }

    const authCutoffIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const purgedRes = await db
      .prepare("DELETE FROM auth_email_verifications WHERE expires_at < ?")
      .run(authCutoffIso);

    return {
      ticketsAnonymized,
      verificationsPurged: Number(purgedRes.changes || 0),
    };
  });
}

export function registerPrivacyRoutes(app: Express) {
  app.get("/api/privacy/titular/export", requireAnyRole(["admin"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const rut = typeof req.query.rut === "string" ? req.query.rut.trim() : undefined;
    const plate = typeof req.query.plate === "string" ? req.query.plate.trim() : undefined;
    const email = typeof req.query.email === "string" ? req.query.email.trim() : undefined;
    if (!rut && !plate && !email) {
      res.status(400).json({ error: "Debes indicar rut, plate o email para exportar datos del titular" });
      return;
    }
    res.json(await exportTitularData(ctx.tenant.id, { rut, plate, email }));
  });

  app.post("/api/privacy/titular/delete", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(privacyTitularDeleteSchema, req.body, res);
    if (!body) return;
    const [ctx, user] = await Promise.all([getTenantContextFromRequest(req), getCurrentUser(req)]);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const result = await anonymizeTitularData(ctx.tenant.id, user.id, body);
    res.json({ success: true, ...result });
  });

  app.get("/api/privacy/consents", requireAnyRole(["admin"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    const rows = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT id, subject_type, subject_id, subject_identifier, purpose, policy_version, granted, ip_address, created_at
           FROM privacy_consents
           WHERE tenant_id = ?
           ORDER BY id DESC
           LIMIT 100`,
        )
        .all<Record<string, unknown>>(ctx.tenant.id),
    );
    res.json({ consents: rows });
  });

  app.post("/api/privacy/consents", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(privacyConsentCreateSchema, req.body, res);
    if (!body) return;
    const ctx = await getTenantContextFromRequest(req);
    const result = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `INSERT INTO privacy_consents (
             tenant_id, subject_type, subject_id, subject_identifier,
             purpose, policy_version, granted, ip_address, user_agent
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ctx.tenant.id,
          body.subject_type,
          body.subject_id ?? null,
          body.subject_identifier.trim(),
          body.purpose.trim(),
          body.policy_version.trim(),
          body.granted ? 1 : 0,
          String(req.ip || req.socket?.remoteAddress || ""),
          req.get("user-agent") || null,
        ),
    );
    res.status(201).json({ id: Number(result.lastInsertRowid), success: true });
  });
}

