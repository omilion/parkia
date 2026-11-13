import { randomBytes } from "node:crypto";
import type { Express } from "express";
import {
  chargeSubscriptionSchema,
  oneclickEnrollSchema,
  oneclickFinishSchema,
  ufRateUpsertSchema,
} from "../../../shared/schemas/billing";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { publicBaseUrl } from "../../platform/http/baseUrl";
import { getTenantContextFromRequest } from "../../platform/tenant/service";
import { DEFAULT_TIMEZONE, localDate } from "../../platform/timezone";
import { parseBody } from "../../validation";
import { dteService } from "../dte/instance";
import { getUfRate, ufCentisToClp, upsertUfRate } from "./uf";

export interface OneclickStartResult {
  token: string;
  urlWebpay: string;
}

export interface OneclickFinishResult {
  approved: boolean;
  tbkUser?: string;
  authorizationCode?: string;
  cardType?: string;
  cardLast4?: string;
  errorMessage?: string;
}

export interface OneclickChargeResult {
  approved: boolean;
  authorizationCode?: string;
  errorMessage?: string;
}

export interface OneclickGateway {
  startInscription(input: {
    username: string;
    email: string;
    responseUrl: string;
  }): Promise<OneclickStartResult>;
  finishInscription(input: { token: string; simulateRejected?: boolean }): Promise<OneclickFinishResult>;
  authorizeCharge(input: {
    username: string;
    tbkUser: string;
    buyOrder: string;
    amountClp: number;
    simulateRejected?: boolean;
  }): Promise<OneclickChargeResult>;
}

export class SimulatedOneclickGateway implements OneclickGateway {
  async startInscription(input: {
    username: string;
    email: string;
    responseUrl: string;
  }): Promise<OneclickStartResult> {
    const token = `sim-oc-${randomBytes(12).toString("hex")}`;
    const sep = input.responseUrl.includes("?") ? "&" : "?";
    return {
      token,
      urlWebpay: `${input.responseUrl}${sep}TBK_TOKEN=${encodeURIComponent(token)}`,
    };
  }

  async finishInscription(input: { token: string; simulateRejected?: boolean }): Promise<OneclickFinishResult> {
    if (input.simulateRejected) {
      return {
        approved: false,
        errorMessage: "Inscripción Oneclick rechazada por el emisor (simulado)",
      };
    }
    return {
      approved: true,
      tbkUser: `tbk-user-${randomBytes(8).toString("hex")}`,
      authorizationCode: "121314",
      cardType: "Visa",
      cardLast4: "6623",
    };
  }

  async authorizeCharge(input: {
    username: string;
    tbkUser: string;
    buyOrder: string;
    amountClp: number;
    simulateRejected?: boolean;
  }): Promise<OneclickChargeResult> {
    if (input.simulateRejected || input.amountClp <= 0) {
      return {
        approved: false,
        errorMessage: "Cargo Oneclick rechazado (simulado)",
      };
    }
    return {
      approved: true,
      authorizationCode: `OC${Math.floor(100000 + Math.random() * 899999)}`,
    };
  }
}

let activeOneclickGateway: OneclickGateway = new SimulatedOneclickGateway();

export function setOneclickGateway(gateway: OneclickGateway) {
  activeOneclickGateway = gateway;
}

function addOneMonth(isoDate: string): string {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

export async function getSubscriptionBillingSummary(tenantId: number) {
  const sub = await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT s.id AS subscription_id, s.status, s.current_period_start, s.current_period_end,
                s.grace_until, s.suspended_at,
                p.id AS plan_id, p.code AS plan_code, p.name AS plan_name,
                p.price_clp, p.price_uf_centis
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = ?
         ORDER BY s.id DESC
         LIMIT 1`,
      )
      .get<Record<string, unknown>>(tenantId),
  );

  const uf = await getUfRate(localDate(DEFAULT_TIMEZONE));
  const priceUfCentis = Number(sub?.price_uf_centis || 0);
  const estimatedAmountClp =
    priceUfCentis > 0 ? ufCentisToClp(priceUfCentis, uf.value_clp) : Number(sub?.price_clp || 0);

  return await runWithTenant(tenantId, async () => {
    const inscription = await db
      .prepare(
        `SELECT id, username, email, card_type, card_last4, status, activated_at
         FROM oneclick_inscriptions
         WHERE tenant_id = ? AND status = 'active'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get<Record<string, unknown>>(tenantId);

    const invoices = await db
      .prepare(
        `SELECT id, period_start, period_end, uf_date, uf_value_clp, amount_uf_centis, amount_clp,
                status, buy_order, authorization_code, dte_document_id, dte_folio, dte_status,
                error_message, paid_at, created_at
         FROM subscription_invoices
         WHERE tenant_id = ?
         ORDER BY id DESC
         LIMIT 24`,
      )
      .all<Record<string, unknown>>(tenantId);

    return {
      subscription: sub || null,
      uf_rate: uf,
      estimated_amount_clp: estimatedAmountClp,
      oneclick: inscription || null,
      invoices,
      platform_dte_configured: Boolean(Number(process.env.PARKIA_PLATFORM_BILLING_TENANT_ID || 0) > 0),
    };
  });
}

export async function enrollOneclickForTenant(
  tenantId: number,
  email: string,
  responseUrl: string,
) {
  const username = `parkia-t${tenantId}`;
  const start = await activeOneclickGateway.startInscription({
    username,
    email,
    responseUrl,
  });

  const inscriptionId = await runWithTenant(tenantId, async () => {
    const res = await db
      .prepare(
        `INSERT INTO oneclick_inscriptions (tenant_id, username, email, status, token)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .run(tenantId, username, email, start.token);
    return Number(res.lastInsertRowid);
  });

  return {
    inscription_id: inscriptionId,
    token: start.token,
    url_webpay: start.urlWebpay,
  };
}

export async function finishOneclickForTenant(
  tenantId: number,
  token: string,
  simulateRejected = false,
) {
  const inscription = await runWithTenant(tenantId, async () =>
    db
      .prepare("SELECT id, status FROM oneclick_inscriptions WHERE tenant_id = ? AND token = ? LIMIT 1")
      .get<{ id: number; status: string }>(tenantId, token),
  );
  if (!inscription) {
    throw new Error("Inscripción Oneclick no encontrada para este token");
  }

  const result = await activeOneclickGateway.finishInscription({ token, simulateRejected });
  if (!result.approved) {
    await runWithTenant(tenantId, async () => {
      await db
        .prepare("UPDATE oneclick_inscriptions SET status = 'revoked', revoked_at = datetime('now') WHERE tenant_id = ? AND id = ?")
        .run(tenantId, inscription.id);
    });
    return { approved: false, error: result.errorMessage || "Inscripción rechazada" };
  }

  await runWithTenant(tenantId, async () => {
    await db
      .prepare(
        `UPDATE oneclick_inscriptions
         SET status = 'revoked', revoked_at = datetime('now')
         WHERE tenant_id = ? AND status = 'active' AND id != ?`,
      )
      .run(tenantId, inscription.id);

    await db
      .prepare(
        `UPDATE oneclick_inscriptions
         SET status = 'active',
             tbk_user = ?,
             authorization_code = ?,
             card_type = ?,
             card_last4 = ?,
             activated_at = datetime('now')
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(
        result.tbkUser || null,
        result.authorizationCode || null,
        result.cardType || "Tarjeta",
        result.cardLast4 || "0000",
        tenantId,
        inscription.id,
      );
  });

  return {
    approved: true,
    card_type: result.cardType || "Tarjeta",
    card_last4: result.cardLast4 || "0000",
  };
}

async function tryEmitPlatformDte(input: {
  subscriberTenantId: number;
  amountClp: number;
  buyOrder: string;
}): Promise<{ dteDocumentId: number | null; dteFolio: number | null; dteStatus: string }> {
  const platformTenantId = Number(process.env.PARKIA_PLATFORM_BILLING_TENANT_ID || 0);
  if (!Number.isInteger(platformTenantId) || platformTenantId <= 0) {
    return {
      dteDocumentId: null,
      dteFolio: null,
      dteStatus: "platform_tenant_not_configured",
    };
  }

  const subscriber = await runWithoutTenant(async () =>
    db.prepare("SELECT id, name, rut FROM tenants WHERE id = ?").get<{ id: number; name: string; rut: string | null }>(input.subscriberTenantId),
  );
  if (!subscriber) {
    return { dteDocumentId: null, dteFolio: null, dteStatus: "subscriber_not_found" };
  }

  try {
    const netAmount = Math.round(input.amountClp / 1.19);
    const issued = await runWithTenant(platformTenantId, async () =>
      dteService.issueDocument(platformTenantId, {
        dteType: 33,
        receptor: {
          rut: subscriber.rut || "66.666.666-6",
          razonSocial: subscriber.name,
          giro: "Servicios de estacionamiento",
          direccion: "Chile",
          comuna: "Santiago",
        },
        items: [
          {
            nombre: `Suscripcion Parkia (${input.buyOrder})`,
            cantidad: 1,
            precioUnitario: netAmount,
            monto: netAmount,
          },
        ],
        source: { type: "subscription", id: input.buyOrder },
      }),
    );
    return {
      dteDocumentId: Number(issued.document.id),
      dteFolio: Number(issued.document.folio),
      dteStatus: String(issued.document.status),
    };
  } catch (err) {
    return {
      dteDocumentId: null,
      dteFolio: null,
      dteStatus: `dte_error:${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
    };
  }
}

export async function chargeTenantSubscription(
  tenantId: number,
  options: { ufDate?: string; simulateRejected?: boolean } = {},
) {
  const sub = await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT s.id AS subscription_id, s.plan_id, s.status, s.current_period_start, s.current_period_end,
                p.code AS plan_code, p.name AS plan_name, p.price_clp, p.price_uf_centis
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = ?
         ORDER BY s.id DESC
         LIMIT 1`,
      )
      .get<{
        subscription_id: number;
        plan_id: number;
        status: string;
        current_period_start: string | null;
        current_period_end: string | null;
        plan_code: string;
        plan_name: string;
        price_clp: number;
        price_uf_centis: number;
      }>(tenantId),
  );
  if (!sub) {
    throw new Error("El tenant no tiene suscripción activa");
  }

  const inscription = await runWithTenant(tenantId, async () =>
    db
      .prepare(
        `SELECT id, username, tbk_user
         FROM oneclick_inscriptions
         WHERE tenant_id = ? AND status = 'active' AND tbk_user IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get<{ id: number; username: string; tbk_user: string }>(tenantId),
  );
  if (!inscription) {
    throw new Error("No hay tarjeta Oneclick inscrita para realizar el cobro");
  }

  const today = localDate(DEFAULT_TIMEZONE);
  const uf = await getUfRate(options.ufDate || today);
  const amountUfCentis = Number(sub.price_uf_centis || 0);
  const amountClp =
    amountUfCentis > 0 ? ufCentisToClp(amountUfCentis, uf.value_clp) : Number(sub.price_clp || 0);
  const buyOrder = `SUB-${tenantId}-${Date.now()}-${randomBytes(2).toString("hex")}`;

  const charge = await activeOneclickGateway.authorizeCharge({
    username: inscription.username,
    tbkUser: inscription.tbk_user,
    buyOrder,
    amountClp,
    simulateRejected: options.simulateRejected,
  });

  const periodStart = today;
  const periodEnd = addOneMonth(today);

  if (!charge.approved) {
    const failedId = await runWithTenant(tenantId, async () => {
      const res = await db
        .prepare(
          `INSERT INTO subscription_invoices (
             tenant_id, subscription_id, plan_id, period_start, period_end,
             uf_date, uf_value_clp, amount_uf_centis, amount_clp,
             status, buy_order, error_message
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)`,
        )
        .run(
          tenantId,
          sub.subscription_id,
          sub.plan_id,
          periodStart,
          periodEnd,
          uf.rate_date,
          uf.value_clp,
          amountUfCentis,
          amountClp,
          buyOrder,
          charge.errorMessage || "Cargo rechazado",
        );
      return Number(res.lastInsertRowid);
    });
    return {
      approved: false,
      invoice_id: failedId,
      buy_order: buyOrder,
      amount_clp: amountClp,
      uf_rate: uf,
      error: charge.errorMessage || "Cargo rechazado",
    };
  }

  const dte = await tryEmitPlatformDte({
    subscriberTenantId: tenantId,
    amountClp,
    buyOrder,
  });

  const invoiceId = await runWithTenant(tenantId, async () => {
    const res = await db
      .prepare(
        `INSERT INTO subscription_invoices (
           tenant_id, subscription_id, plan_id, period_start, period_end,
           uf_date, uf_value_clp, amount_uf_centis, amount_clp,
           status, buy_order, authorization_code,
           dte_document_id, dte_folio, dte_status, paid_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        tenantId,
        sub.subscription_id,
        sub.plan_id,
        periodStart,
        periodEnd,
        uf.rate_date,
        uf.value_clp,
        amountUfCentis,
        amountClp,
        buyOrder,
        charge.authorizationCode || null,
        dte.dteDocumentId,
        dte.dteFolio,
        dte.dteStatus,
      );
    return Number(res.lastInsertRowid);
  });

  await runWithoutTenant(async () => {
    await db
      .prepare(
        `UPDATE subscriptions
         SET status = 'active',
             current_period_start = ?,
             current_period_end = ?,
             grace_until = NULL,
             suspended_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(periodStart, periodEnd, sub.subscription_id);
  });

  return {
    approved: true,
    invoice_id: invoiceId,
    buy_order: buyOrder,
    authorization_code: charge.authorizationCode,
    amount_uf_centis: amountUfCentis,
    amount_clp: amountClp,
    uf_rate: uf,
    dte,
    period_start: periodStart,
    period_end: periodEnd,
  };
}

export function registerSubscriptionBillingRoutes(app: Express) {
  app.get("/api/billing/subscription", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const ctx = await getTenantContextFromRequest(req);
    res.json(await getSubscriptionBillingSummary(ctx.tenant.id));
  });

  app.post("/api/billing/uf", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(ufRateUpsertSchema, req.body, res);
    if (!body) return;
    await upsertUfRate(body.rate_date, body.value_clp, body.source);
    res.status(201).json({ success: true, rate_date: body.rate_date, value_clp: body.value_clp });
  });

  app.post("/api/billing/oneclick/enroll", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(oneclickEnrollSchema, req.body || {}, res);
    if (!body) return;
    const [ctx, user] = await Promise.all([getTenantContextFromRequest(req), getCurrentUser(req)]);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const email = body.email || user.email;
    const responseUrl = body.response_url || `${publicBaseUrl(req)}/suscripcion`;
    const started = await enrollOneclickForTenant(ctx.tenant.id, email, responseUrl);
    res.status(201).json(started);
  });

  app.post("/api/billing/oneclick/finish", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(oneclickFinishSchema, req.body, res);
    if (!body) return;
    const ctx = await getTenantContextFromRequest(req);
    const result = await finishOneclickForTenant(ctx.tenant.id, body.token, body.simulate_rejected);
    res.status(result.approved ? 200 : 402).json(result);
  });

  app.post("/api/billing/charge-subscription", requireAnyRole(["admin"]), async (req, res) => {
    const body = parseBody(chargeSubscriptionSchema, req.body || {}, res);
    if (!body) return;
    const ctx = await getTenantContextFromRequest(req);
    const result = await chargeTenantSubscription(ctx.tenant.id, {
      ufDate: body.uf_date,
      simulateRejected: body.simulate_rejected,
    });
    res.status(result.approved ? 200 : 402).json(result);
  });
}
