import type { Express, Request, Response } from "express";
import { platformChargeSchema, platformManualPaymentSchema, ufRateUpsertSchema } from "../../../shared/schemas/billing";
import { platformImpersonateSchema, platformTenantStatusSchema } from "../../../shared/schemas/saas";
import { getCurrentUser, getSessionTokenHash } from "../../auth/sessions";
import { db } from "../../db";
import { runWithoutTenant, runWithTenant } from "../../db/engine/context";
import { getTenantUsage, isPlatformAdmin, requirePlatformAdmin } from "../../tenant";
import { parseBody } from "../../validation";
import { chargeTenantSubscription, recordManualSubscriptionPayment } from "./billing";
import { getSubscriptionBillingSummary, oneclickAvailability } from "./oneclick";
import { upsertUfRate } from "./uf";

async function logPlatformAudit(req: Request, tenantId: number, staffId: number, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  const ipAddress = req.ip || req.socket?.remoteAddress || null;
  await runWithTenant(tenantId, async () => {
    await db
      .prepare(
        `INSERT INTO audit_events (tenant_id, staff_id, action, entity_type, entity_id, metadata, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(tenantId, staffId, action, entityType, entityId, JSON.stringify(metadata), ipAddress);
  });
}

/** Lo que el administrador de plataforma necesita ver para cobrar: tarjeta, proximo cobro y ultimo intento. */
async function tenantBillingBrief(tenantId: number) {
  const summary = await getSubscriptionBillingSummary(tenantId);
  const last = (summary.invoices[0] ?? null) as Record<string, unknown> | null;
  return {
    card: summary.oneclick ? { type: summary.oneclick.card_type ?? null, last4: summary.oneclick.card_last4 ?? null } : null,
    estimated_amount_clp: summary.estimated_amount_clp,
    next_charge_date: summary.next_charge?.date ?? null,
    last_invoice: last
      ? { status: last.status, amount_clp: last.amount_clp, period_start: last.period_start, created_at: last.created_at, error_message: last.error_message ?? null }
      : null,
  };
}

function tenantIdParam(req: Request, res: Response): number | null {
  const tenantId = Number(req.params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    res.status(400).json({ error: "Empresa inválida" });
    return null;
  }
  return tenantId;
}

/**
 * Cobro de la suscripcion: acciones de PARKIA sobre sus clientes. Solo administradores de plataforma; todo queda auditado
 * en la empresa cobrada.
 */
function registerPlatformBillingRoutes(app: Express) {
  // Estado de la facturacion de la plataforma (pasarela disponible, UF vigente).
  app.get("/api/platform/billing/status", requirePlatformAdmin, async (_req: Request, res: Response) => {
    const { getUfRate } = await import("./uf");
    const { todayLocal } = await import("../../../shared/dates");
    const { isUfUsable } = await import("./billingPeriod");
    const today = todayLocal();
    const uf = await getUfRate(today);
    res.json({ oneclick: oneclickAvailability(), uf: { ...uf, usable: isUfUsable(uf, today) } });
  });

  // La UF es un dato de la plataforma: decide cuanto paga cada cliente. Normalmente la trae el job uf.sync.
  app.post("/api/platform/uf", requirePlatformAdmin, async (req: Request, res: Response) => {
    const body = parseBody(ufRateUpsertSchema, req.body, res);
    if (!body) return;
    await upsertUfRate(body.rate_date, body.value_clp, body.source);
    res.status(201).json({ success: true, rate_date: body.rate_date, value_clp: body.value_clp });
  });

  app.post("/api/platform/tenants/:id/charge", requirePlatformAdmin, async (req: Request, res: Response) => {
    const tenantId = tenantIdParam(req, res);
    if (!tenantId) return;
    const body = parseBody(platformChargeSchema, req.body || {}, res);
    if (!body) return;
    const user = await getCurrentUser(req);
    const result = await chargeTenantSubscription(tenantId, { trigger: "platform", simulateRejected: body.simulate_rejected });
    await logPlatformAudit(req, tenantId, user!.id, "platform.subscription_charge", "subscription", String(tenantId), {
      approved: result.approved,
      ...(result.approved === true
        ? { amount_clp: result.amount_clp, buy_order: result.buy_order, period_start: result.period_start, already_paid: Boolean(result.already_paid) }
        : { code: (result as { code: string }).code }),
    });
    if (result.approved === true) return res.json(result);
    const failure = result as { code: string };
    const status = failure.code === "REJECTED" ? 402 : failure.code === "ONECLICK_NOT_AVAILABLE" ? 503 : failure.code === "NO_SUBSCRIPTION" ? 404 : 409;
    res.status(status).json(result);
  });

  app.post("/api/platform/tenants/:id/manual-payment", requirePlatformAdmin, async (req: Request, res: Response) => {
    const tenantId = tenantIdParam(req, res);
    if (!tenantId) return;
    const body = parseBody(platformManualPaymentSchema, req.body, res);
    if (!body) return;
    const user = await getCurrentUser(req);
    const result = await recordManualSubscriptionPayment(tenantId, { reference: body.reference, amountClp: body.amount_clp });
    if (result.ok === true) {
      await logPlatformAudit(req, tenantId, user!.id, "platform.subscription_manual_payment", "subscription", String(tenantId), {
        reference: body.reference, amount_clp: result.amount_clp, period_start: result.period_start, period_end: result.period_end, note: body.note ?? null,
      });
      return res.status(201).json(result);
    }
    const failure = result as { code: string };
    res.status(failure.code === "NO_SUBSCRIPTION" ? 404 : 409).json(result);
  });
}

export function registerPlatformRoutes(app: Express) {
  registerPlatformBillingRoutes(app);

  app.get("/api/platform/tenants", requirePlatformAdmin, async (_req: Request, res: Response) => {
    const rows = await runWithoutTenant(async () => {
      return (await db
        .prepare(
          `SELECT t.id,
                  t.name,
                  t.rut,
                  t.status AS tenant_status,
                  t.created_at,
                  p.code AS plan_code,
                  p.name AS plan_name,
                  p.max_branches,
                  p.max_spaces,
                  p.max_users,
                  p.monthly_ticket_limit,
                  s.id AS subscription_id,
                  s.status AS subscription_status,
                  s.current_period_end,
                  s.grace_until,
                  s.suspended_at,
                  ds.environment AS sii_environment,
                  ds.status AS sii_certification_status
           FROM tenants t
           LEFT JOIN subscriptions s ON s.id = (
             SELECT s2.id FROM subscriptions s2 WHERE s2.tenant_id = t.id ORDER BY s2.id DESC LIMIT 1
           )
           LEFT JOIN plans p ON p.id = s.plan_id
           LEFT JOIN dte_settings ds ON ds.tenant_id = t.id
           ORDER BY t.id ASC`,
        )
        .all()) as Array<Record<string, any>>;
    });

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const tenantId = Number(row.id);
        const usage = await getTenantUsage(tenantId);
        return {
          id: tenantId,
          name: String(row.name),
          rut: row.rut || null,
          status: String(row.tenant_status),
          created_at: row.created_at || null,
          plan: {
            code: row.plan_code || "starter",
            name: row.plan_name || "Starter",
            max_branches: row.max_branches === null || row.max_branches === undefined ? null : Number(row.max_branches),
            max_spaces: row.max_spaces === null || row.max_spaces === undefined ? null : Number(row.max_spaces),
            max_users: row.max_users === null || row.max_users === undefined ? null : Number(row.max_users),
            monthly_ticket_limit:
              row.monthly_ticket_limit === null || row.monthly_ticket_limit === undefined
                ? null
                : Number(row.monthly_ticket_limit),
          },
          subscription: {
            id: row.subscription_id ? Number(row.subscription_id) : null,
            status: row.subscription_status || "trialing",
            current_period_end: row.current_period_end ? String(row.current_period_end).slice(0, 10) : null,
            grace_until: row.grace_until ? String(row.grace_until).slice(0, 10) : null,
            suspended_at: row.suspended_at || null,
          },
          sii: {
            environment: row.sii_environment || "demo",
            certification_status: row.sii_certification_status || "pending",
          },
          usage,
          billing: await tenantBillingBrief(tenantId),
        };
      }),
    );

    res.json({ tenants: enriched });
  });

  app.patch("/api/platform/tenants/:id/status", requirePlatformAdmin, async (req: Request, res: Response) => {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: "Empresa inválida" });
    }
    const body = parseBody(platformTenantStatusSchema, req.body, res);
    if (!body) return;

    const actor = await getCurrentUser(req);
    if (!actor) return res.status(401).json({ error: "Authentication required" });

    const existing = (await runWithoutTenant(async () =>
      db.prepare("SELECT id, status FROM tenants WHERE id = ?").get(tenantId),
    )) as { id: number; status: string } | undefined;

    if (!existing) return res.status(404).json({ error: "Empresa no encontrada" });

    await runWithoutTenant(async () => {
      await db
        .prepare("UPDATE tenants SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(body.status, tenantId);

      if (body.status === "suspended") {
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = 'suspended',
                 suspended_at = COALESCE(suspended_at, CURRENT_TIMESTAMP),
                 updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = ?`,
          )
          .run(tenantId);
      } else {
        await db
          .prepare(
            `UPDATE subscriptions
             SET status = CASE WHEN status = 'suspended' THEN 'active' ELSE status END,
                 suspended_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE tenant_id = ?`,
          )
          .run(tenantId);
      }
    });

    await logPlatformAudit(req, tenantId, actor.id, "platform.tenant_status_updated", "tenant", String(tenantId), {
      previous_status: existing.status,
      new_status: body.status,
      reason: body.reason || null,
      by_email: actor.email,
    });

    res.json({ success: true, id: tenantId, status: body.status });
  });

  app.post("/api/platform/impersonate", requirePlatformAdmin, async (req: Request, res: Response) => {
    const body = parseBody(platformImpersonateSchema, req.body, res);
    if (!body) return;

    const actor = await getCurrentUser(req);
    const tokenHash = getSessionTokenHash(req);
    if (!actor || !tokenHash) return res.status(401).json({ error: "Authentication required" });

    const target = (await runWithoutTenant(async () =>
      db.prepare("SELECT id, name, status FROM tenants WHERE id = ? AND status != 'archived'").get(body.tenant_id),
    )) as { id: number; name: string; status: string } | undefined;

    if (!target) return res.status(404).json({ error: "Empresa no encontrada" });

    const expiresAt = new Date(Date.now() + body.minutes * 60_000).toISOString();

    await db
      .prepare(
        `UPDATE auth_sessions
         SET impersonated_by_staff_id = ?,
             impersonated_tenant_id = ?,
             impersonation_expires_at = ?,
             impersonation_reason = ?
         WHERE token_hash = ?`,
      )
      .run(actor.id, target.id, expiresAt, body.reason, tokenHash);

    await logPlatformAudit(req, target.id, actor.id, "platform.impersonation_started", "tenant", String(target.id), {
      by_staff_id: actor.id,
      by_email: actor.email,
      reason: body.reason,
      expires_at: expiresAt,
    });

    res.json({
      success: true,
      impersonation: {
        by_staff_id: actor.id,
        by_email: actor.email,
        tenant_id: target.id,
        tenant_name: target.name,
        reason: body.reason,
        expires_at: expiresAt,
      },
    });
  });

  app.post("/api/platform/stop-impersonation", async (req: Request, res: Response) => {
    const user = await getCurrentUser(req);
    const tokenHash = getSessionTokenHash(req);
    if (!user || !tokenHash) return res.status(401).json({ error: "Authentication required" });
    if (!user.impersonation && !isPlatformAdmin(user)) {
      return res.status(403).json({ error: "Acceso restringido a administradores de plataforma" });
    }

    const previousImpersonation = user.impersonation;

    await db
      .prepare(
        `UPDATE auth_sessions
         SET impersonated_by_staff_id = NULL,
             impersonated_tenant_id = NULL,
             impersonation_expires_at = NULL,
             impersonation_reason = NULL
         WHERE token_hash = ?`,
      )
      .run(tokenHash);

    if (previousImpersonation) {
      await logPlatformAudit(
        req,
        previousImpersonation.tenant_id,
        previousImpersonation.by_staff_id,
        "platform.impersonation_stopped",
        "tenant",
        String(previousImpersonation.tenant_id),
        {
          by_staff_id: previousImpersonation.by_staff_id,
          by_email: previousImpersonation.by_email,
          reason: previousImpersonation.reason,
        },
      );
    }

    res.json({ success: true });
  });
}

