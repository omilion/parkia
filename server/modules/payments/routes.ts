import type { Express, Request, Response } from "express";
import { mockDecisionSchema, paymentSettingsSchema, startPaymentSchema } from "../../../shared/schemas/gateways";
import { recordAuditEvent } from "../../audit";
import { requireAnyRole } from "../../auth/sessions";
import { allowPublicAttempt } from "../../middleware/publicAttempts";
import { getTenantIdFromRequest } from "../../tenant";
import { parseBody } from "../../validation";
import { PaymentGatewayError, WebhookSignatureError } from "./gateway";
import {
  createReceivableLink, decideMockPayment, ensureTicketPayToken, getMockPaymentInfo, getPaymentSettings, getPublicPayment,
  handleGatewayReturn, listIntentsForTicket, PaymentError, processWebhook, savePaymentSettings, startPublicPayment, type ProviderId,
} from "./service";

/**
 * Pagos en linea.
 *  - Publicas (sin sesion): pagina de pago por token, retorno de la pasarela, webhooks firmados, pasarela simulada.
 *  - Personal: configuracion de pasarelas (admin) y enlaces/QR de pago.
 */

function baseUrlFor(req: Request) {
  const configured = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

function fail(res: Response, error: unknown) {
  if (error instanceof PaymentError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error instanceof WebhookSignatureError) return res.status(401).json({ error: error.message, code: "INVALID_SIGNATURE" });
  if (error instanceof PaymentGatewayError) return res.status(502).json({ error: "No pudimos comunicarnos con la pasarela de pago. Intenta nuevamente en unos minutos.", code: error.code });
  throw error;
}

const isProvider = (value: string): value is ProviderId => value === "webpay" || value === "mock";

function limited(req: Request, res: Response, scope: string, limit?: number) {
  if (allowPublicAttempt(`${scope}:${req.ip}`, limit)) return false;
  res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
  return true;
}

export function registerPublicPaymentRoutes(app: Express) {
  app.get("/api/public/pay/:token", async (req, res) => {
    if (limited(req, res, "pay-view", 120)) return;
    try { res.json(await getPublicPayment(req.params.token)); } catch (error) { fail(res, error); }
  });

  app.post("/api/public/pay/:token/start", async (req, res) => {
    if (limited(req, res, "pay-start", 30)) return;
    const body = parseBody(startPaymentSchema, req.body, res);
    if (!body) return;
    try {
      const idempotencyKey = String(req.get("idempotency-key") || "").trim().slice(0, 80) || null;
      res.json(await startPublicPayment(req.params.token, { provider: body.provider, baseUrl: baseUrlFor(req), idempotencyKey }));
    } catch (error) { fail(res, error); }
  });

  // Vuelta del cliente desde Webpay (token_ws en POST o GET). No exige sesion ni origen: la identidad es el token de la transaccion.
  const handleReturn = async (req: Request, res: Response) => {
    const provider = req.params.provider;
    if (!isProvider(provider) || limited(req, res, "pay-return", 120)) return;
    const source = { ...(req.query as Record<string, unknown>), ...((req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>) };
    const text = (value: unknown) => (typeof value === "string" && value.length <= 200 ? value : undefined);
    try {
      const { location } = await handleGatewayReturn(provider, { token_ws: text(source.token_ws), TBK_TOKEN: text(source.TBK_TOKEN) });
      res.redirect(303, location);
    } catch (error) { fail(res, error); }
  };
  app.get("/api/public/payments/return/:provider", handleReturn);
  app.post("/api/public/payments/return/:provider", handleReturn);

  // Avisos firmados de la pasarela (HMAC con marca de tiempo). Responde 401 si la firma no es valida.
  app.post("/api/public/payments/webhook/:provider", async (req, res) => {
    const provider = req.params.provider;
    if (!isProvider(provider) || limited(req, res, "pay-webhook", 600)) return;
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) return res.status(400).json({ error: "Cuerpo vacío" });
    try { res.json(await processWebhook(provider, req.headers, rawBody)); } catch (error) { fail(res, error); }
  });

  // Pasarela simulada (solo desarrollo y pruebas).
  app.get("/api/public/payments/simulated/:token", async (req, res) => {
    if (limited(req, res, "pay-mock", 120)) return;
    try { res.json(await getMockPaymentInfo(req.params.token)); } catch (error) { fail(res, error); }
  });
  app.post("/api/public/payments/simulated/:token/decision", async (req, res) => {
    if (limited(req, res, "pay-mock-decide", 60)) return;
    const body = parseBody(mockDecisionSchema, req.body, res);
    if (!body) return;
    try { res.json(await decideMockPayment(req.params.token, body.outcome)); } catch (error) { fail(res, error); }
  });
}

export function registerPaymentGatewayRoutes(app: Express) {
  const admin = requireAnyRole(["admin"]);
  const operators = requireAnyRole(["admin", "cashier", "guard"]);

  app.get("/api/payment-settings", admin, async (req, res) => {
    res.json(await getPaymentSettings(await getTenantIdFromRequest(req)));
  });

  app.put("/api/payment-settings", admin, async (req, res) => {
    const body = parseBody(paymentSettingsSchema, req.body, res);
    if (!body) return;
    try {
      const settings = await savePaymentSettings(await getTenantIdFromRequest(req), body);
      await recordAuditEvent(req, { action: "payment_settings.updated", entityType: "payment_settings", entityId: body.provider, metadata: { enabled: body.enabled, environment: body.environment, secret_changed: Boolean(body.api_secret) } });
      res.json(settings);
    } catch (error) { fail(res, error); }
  });

  /** Enlace y QR de pago de un ticket abierto. */
  app.get("/api/visitors/:id/pay-link", operators, async (req, res) => {
    try {
      const token = await ensureTicketPayToken(await getTenantIdFromRequest(req), Number(req.params.id));
      res.json({ token, path: `/pagar/${token}`, url: `${baseUrlFor(req)}/pagar/${token}` });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/visitors/:id/payment-intents", operators, async (req, res) => {
    res.json({ intents: await listIntentsForTicket(await getTenantIdFromRequest(req), Number(req.params.id)) });
  });

  /** Enlace de pago de una cuota de abonado. */
  app.post("/api/payments/:id/pay-link", requireAnyRole(["admin", "finance"]), async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const link = await createReceivableLink(tenantId, Number(req.params.id));
      await recordAuditEvent(req, { action: "payment.pay_link_created", entityType: "payment", entityId: req.params.id, metadata: { amount: link.amount } });
      res.status(201).json({ ...link, path: `/pagar/${link.token}`, url: `${baseUrlFor(req)}/pagar/${link.token}` });
    } catch (error) { fail(res, error); }
  });
}
