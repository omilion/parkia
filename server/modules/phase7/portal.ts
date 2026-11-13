import crypto from "node:crypto";
import type { Express, Request } from "express";
import {
  portalRequestLinkSchema,
  portalVerifyTokenSchema,
} from "../../../shared/schemas/portal";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { shouldUseSecureCookie } from "../../auth/sessions";
import { allowPublicAttempt } from "../../middleware/publicAttempts";
import { publicBaseUrl } from "../../platform/http/baseUrl";
import { createReceivableLink, PaymentError } from "../payments/service";
import { sendMail } from "../../platform/mail";
import { parseBody } from "../../validation";

const PORTAL_COOKIE_NAME = "parkia_portal_session";
const MAGIC_LINK_TTL_MS = 30 * 60 * 1000;
const PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Enlaces que se envian a una misma persona por hora: evita usar el portal para inundar una bandeja de entrada. */
const MAX_LINKS_PER_CLIENT_PER_HOUR = 3;

/** La cookie del portal sigue la misma regla que la de la sesion de personal (Secure con HTTPS). */
function portalCookie(value: string, maxAgeSeconds: number) {
  return `${PORTAL_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${shouldUseSecureCookie() ? "; Secure" : ""}`;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function todaySantiago(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function extractPortalToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return readCookieValue(req.header("cookie"), PORTAL_COOKIE_NAME);
}

async function resolvePortalSession(req: Request): Promise<{
  sessionId: number;
  tenantId: number;
  clientId: number;
} | null> {
  const rawToken = extractPortalToken(req);
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  return await runWithoutTenant(async () => {
    const row = await db
      .prepare(
        `SELECT id, tenant_id, client_id, expires_at, revoked_at
         FROM portal_sessions
         WHERE token_hash = ?
         LIMIT 1`,
      )
      .get<{
        id: number;
        tenant_id: number;
        client_id: number;
        expires_at: string | Date;
        revoked_at: string | Date | null;
      }>(tokenHash);
    if (!row || row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return { sessionId: row.id, tenantId: row.tenant_id, clientId: row.client_id };
  });
}

export function registerPortalRoutes(app: Express) {
  app.post("/api/portal/auth/request-link", async (req, res) => {
    const body = parseBody(portalRequestLinkSchema, req.body, res);
    if (!body) return;
    if (!allowPublicAttempt(`portal-link:${req.ip}`, 10)) {
      res.status(429).json({ message: "Demasiados intentos. Intenta nuevamente en unos minutos." });
      return;
    }

    const client = await runWithoutTenant(async () => {
      if (body.tenantSlug) {
        return db
          .prepare(
            `SELECT c.id, c.tenant_id, c.name, c.email
             FROM clients c
             INNER JOIN tenants t ON t.id = c.tenant_id
             WHERE LOWER(c.email) = LOWER(?) AND t.slug = ? AND c.status = 'active'
             ORDER BY c.id ASC
             LIMIT 1`,
          )
          .get<{ id: number; tenant_id: number; name: string; email: string }>(body.email, body.tenantSlug);
      }
      return db
        .prepare(
          `SELECT id, tenant_id, name, email
           FROM clients
           WHERE LOWER(email) = LOWER(?) AND status = 'active'
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get<{ id: number; tenant_id: number; name: string; email: string }>(body.email);
    });

    if (!client || !client.email) {
      res.json({
        ok: true,
        message: "Si tu correo está registrado, recibirás un enlace de acceso.",
      });
      return;
    }

    const recent = await runWithTenant(client.tenant_id, async () =>
      db
        .prepare("SELECT COUNT(*) AS n FROM portal_magic_links WHERE tenant_id = ? AND client_id = ? AND created_at > datetime('now', '-1 hour')")
        .get<{ n: number | string }>(client.tenant_id, client.id),
    );
    if (Number(recent?.n ?? 0) >= MAX_LINKS_PER_CLIENT_PER_HOUR) {
      // Misma respuesta que si el correo no existiera: no se confirma nada y no se envia otro correo.
      res.json({ ok: true, message: "Si tu correo está registrado, recibirás un enlace de acceso." });
      return;
    }

    const rawToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS).toISOString();

    await runWithTenant(client.tenant_id, async () => {
      await db
        .prepare(
          `INSERT INTO portal_magic_links (tenant_id, client_id, email, token_hash, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(client.tenant_id, client.id, client.email, tokenHash, expiresAt);
    });

    const origin = publicBaseUrl(req);

    await sendMail({
      tenantRef: client.tenant_id,
      to: client.email,
      template: "notice",
      data: {
        title: "Acceso a tu Portal de Abonado Parkia",
        paragraphs: [
          `Hola ${client.name}, usa este enlace mágico para revisar tus cuotas, boletas, documentos y vehículos.`,
          "El enlace vence en 30 minutos y es de un solo uso.",
        ],
        cta: {
          label: "Ingresar al Portal",
          url: `${origin.replace(/\/+$/, "")}/portal?token=${rawToken}`,
        },
      },
    });

    res.json({
      ok: true,
      message: "Si tu correo está registrado, recibirás un enlace de acceso.",
      ...(process.env.NODE_ENV === "test" ? { debugToken: rawToken } : {}),
    });
  });

  app.post("/api/portal/auth/verify", async (req, res) => {
    const body = parseBody(portalVerifyTokenSchema, req.body, res);
    if (!body) return;
    if (!allowPublicAttempt(`portal-verify:${req.ip}`, 20)) {
      res.status(429).json({ message: "Demasiados intentos. Intenta nuevamente en unos minutos." });
      return;
    }

    const tokenHash = sha256(body.token);
    const link = await runWithoutTenant(async () =>
      db
        .prepare(
          `SELECT id, tenant_id, client_id, expires_at, used_at
           FROM portal_magic_links
           WHERE token_hash = ?
           LIMIT 1`,
        )
        .get<{
          id: number;
          tenant_id: number;
          client_id: number;
          expires_at: string | Date;
          used_at: string | Date | null;
        }>(tokenHash),
    );

    if (!link || link.used_at || new Date(link.expires_at).getTime() <= Date.now()) {
      res.status(401).json({ message: "Enlace mágico inválido o expirado" });
      return;
    }

    const rawSessionToken = crypto.randomBytes(32).toString("hex");
    const sessionHash = sha256(rawSessionToken);
    const sessionExpiresAt = new Date(Date.now() + PORTAL_SESSION_TTL_MS).toISOString();

    // "De un solo uso" tiene que ser atomico: dos peticiones simultaneas con el mismo enlace no pueden abrir dos sesiones.
    const opened = await runWithTenant(link.tenant_id, async () => {
      const claimed = await db
        .prepare("UPDATE portal_magic_links SET used_at = datetime('now') WHERE tenant_id = ? AND id = ? AND used_at IS NULL")
        .run(link.tenant_id, link.id);
      if (!claimed.changes) return false;
      await db
        .prepare(
          `INSERT INTO portal_sessions (tenant_id, client_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(link.tenant_id, link.client_id, sessionHash, sessionExpiresAt);
      return true;
    });
    if (!opened) {
      res.status(401).json({ message: "Enlace mágico inválido o expirado" });
      return;
    }

    res.setHeader("Set-Cookie", portalCookie(rawSessionToken, Math.round(PORTAL_SESSION_TTL_MS / 1000)));
    res.json({ ok: true, sessionToken: rawSessionToken });
  });

  app.post("/api/portal/auth/logout", async (req, res) => {
    const session = await resolvePortalSession(req);
    if (session) {
      await runWithTenant(session.tenantId, async () => {
        await db
          .prepare("UPDATE portal_sessions SET revoked_at = datetime('now') WHERE tenant_id = ? AND id = ?")
          .run(session.tenantId, session.sessionId);
      });
    }
    res.setHeader("Set-Cookie", portalCookie("", 0));
    res.json({ ok: true });
  });

  app.get("/api/portal/me", async (req, res) => {
    const session = await resolvePortalSession(req);
    if (!session) {
      res.status(401).json({ message: "Sesión de portal requerida" });
      return;
    }

    const data = await runWithTenant(session.tenantId, async () => {
      const client = await db
        .prepare(
          `SELECT id, name, email, phone, rut, financial_status, status
           FROM clients
           WHERE tenant_id = ? AND id = ?
           LIMIT 1`,
        )
        .get<Record<string, unknown>>(session.tenantId, session.clientId);

      const contracts = await db
        .prepare(
          `SELECT id, branch_id, space_id, start_date, end_date, monthly_fee, billing_day, billing_document_type, status
           FROM contracts
           WHERE tenant_id = ? AND client_id = ?
           ORDER BY id DESC`,
        )
        .all<Record<string, unknown>>(session.tenantId, session.clientId);

      const payments = await db
        .prepare(
          `SELECT p.id, p.contract_id, p.amount, p.due_date, p.payment_date, p.status, p.method, p.reference
           FROM payments p
           INNER JOIN contracts c ON c.id = p.contract_id
           WHERE p.tenant_id = ? AND c.client_id = ?
           ORDER BY p.due_date DESC, p.id DESC`,
        )
        .all<Record<string, unknown>>(session.tenantId, session.clientId);

      const invoices = await db
        .prepare(
          `SELECT id, folio, type, amount, date, status_sii, payment_id, contract_id
           FROM invoices
           WHERE tenant_id = ? AND client_id = ?
           ORDER BY id DESC`,
        )
        .all<Record<string, unknown>>(session.tenantId, session.clientId);

      const documents = await db
        .prepare(
          `SELECT id, entity_type, entity_id, label, document_type, status, file_name, mime_type, expires_at, created_at
           FROM documents
           WHERE tenant_id = ? AND entity_type = 'client' AND entity_id = ?
           ORDER BY id DESC`,
        )
        .all<Record<string, unknown>>(session.tenantId, session.clientId);

      const vehicles = await db
        .prepare(
          `SELECT id, plate, brand, model, color, status
           FROM vehicles
           WHERE tenant_id = ? AND client_id = ? AND status = 'active'
           ORDER BY id DESC`,
        )
        .all<Record<string, unknown>>(session.tenantId, session.clientId);

      return { client, contracts, payments, invoices, documents, vehicles };
    });

    res.json(data);
  });

  /**
   * Pagar una cuota desde el portal: NO la marca como pagada. Entrega el enlace de pago de la cuota (`/pagar/r_...`),
   * que pasa por la pasarela; la cuota solo cambia a pagada cuando la pasarela confirma (retorno firmado o webhook),
   * igual que cualquier otro cobro en linea (docs/PAYMENTS.md).
   */
  app.post("/api/portal/payments/:paymentId/pay", async (req, res) => {
    const session = await resolvePortalSession(req);
    if (!session) {
      res.status(401).json({ message: "Sesión de portal requerida" });
      return;
    }

    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) {
      res.status(400).json({ message: "ID de cuota inválido" });
      return;
    }

    try {
      const link = await runWithTenant(session.tenantId, async () => {
        // Solo cuotas de contratos de esta persona.
        const owned = await db
          .prepare(
            `SELECT p.id
             FROM payments p
             INNER JOIN contracts c ON c.id = p.contract_id
             WHERE p.tenant_id = ? AND p.id = ? AND c.client_id = ?
             LIMIT 1`,
          )
          .get<{ id: number }>(session.tenantId, paymentId, session.clientId);
        if (!owned) return null;
        return await createReceivableLink(session.tenantId, paymentId);
      });
      if (!link) {
        res.status(404).json({ message: "Cuota no encontrada" });
        return;
      }
      res.status(201).json({ ok: true, token: link.token, path: `/pagar/${link.token}`, amount: link.amount, expires_at: link.expires_at });
    } catch (error) {
      if (error instanceof PaymentError) {
        res.status(error.status).json({ message: error.message, code: error.code });
        return;
      }
      throw error;
    }
  });
}
