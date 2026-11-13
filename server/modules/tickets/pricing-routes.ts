import type { Express, Request, Response } from "express";
import { z } from "zod";
import { agreementSchema, lostTicketSchema, merchantValidationSchema, quoteSimulationSchema, ratePlanSchema } from "../../../shared/schemas/pricing";
import { recordAuditEvent } from "../../audit";
import { allowPublicAttempt, resetPublicAttemptsForTesting } from "../../middleware/publicAttempts";
import { getCurrentUser, requireAnyRole } from "../../auth/sessions";
import { getBranchTimezone } from "../../platform/timezone";
import { getTenantIdFromRequest } from "../../tenant";
import { parseBody } from "../../validation";
import {
  AgreementError, createAgreement, listAgreements, listTicketValidationsForStaff, registerLostTicket,
  resolveLostTicketEvidence, updateAgreement, validateFromMerchant, validateTicketWithAgreement,
} from "./agreements";
import { localToInstant, parseTime, quote, validatePlan, type PricingPlan } from "./pricing-engine";
import {
  archiveRatePlan, createRatePlan, listRatePlans, listRatePlanVersions, RatePlanError, updateRatePlan,
  type RatePlanRecord, type RatePlanRow,
} from "./rate-plans";

/**
 * Tarifas, convenios, validaciones y ticket perdido.
 *  - Configuracion (planes, convenios): solo administrador.
 *  - Validar un ticket o registrarlo como perdido: administrador, caja y guardia.
 *  - Validacion del comercio: publica (sin sesion), solo con el codigo del convenio, con limite de intentos.
 */

function fail(res: Response, error: unknown) {
  if (error instanceof RatePlanError) return res.status(error.status).json({ error: error.message, details: error.details });
  if (error instanceof AgreementError) return res.status(error.status).json({ error: error.message, code: error.code });
  const message = error instanceof Error ? error.message : "Error inesperado";
  return res.status(500).json({ error: message });
}

function planToJson(plan: RatePlanRecord) {
  return {
    id: plan.id, group_id: plan.group_id, version: plan.version, name: plan.name, branch_id: plan.branch_id,
    vehicle_type: plan.vehicle_type, mode: plan.mode, grace_mins: plan.grace_mins, daily_cap: plan.daily_cap,
    first_block_minutes: plan.first_block_minutes, block_minutes: plan.block_minutes, valid_from: plan.valid_from,
    valid_to: plan.valid_to, status: plan.status, change_note: plan.change_note, created_at: plan.created_at,
    rules: plan.rules.map(rule => ({
      weekdays: rule.weekdays ? rule.weekdays.split(",").map(Number) : null,
      from: rule.from_time, to: rule.to_time, priority: rule.priority,
      price_per_minute: rule.price_per_minute, first_block_price: rule.first_block_price, block_price: rule.block_price,
    })),
  };
}

function draftToPricingPlan(values: z.output<typeof ratePlanSchema>, timeZone: string): PricingPlan {
  return {
    mode: values.mode, graceMins: values.grace_mins, dailyCap: values.daily_cap,
    firstBlockMinutes: values.first_block_minutes, blockMinutes: values.block_minutes, timeZone,
    rules: values.rules.map(rule => ({
      weekdays: rule.weekdays, from: rule.from, to: rule.to, priority: rule.priority,
      pricePerMinute: rule.price_per_minute, firstBlockPrice: rule.first_block_price, blockPrice: rule.block_price,
    })),
  };
}

/** "2026-06-10T14:30" (hora local de la sucursal) -> instante. */
function localDateTime(value: string, timeZone: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value.trim());
  const minutes = match ? parseTime(match[2]) : null;
  if (!match || minutes === null) return null;
  return new Date(localToInstant(match[1], minutes, timeZone));
}

export { resetPublicAttemptsForTesting };

/** Rutas sin sesion. Se registran ANTES de exigir autenticacion. */
export function registerPublicPricingRoutes(app: Express) {
  app.post("/api/public/validar", async (req: Request, res: Response) => {
    const body = parseBody(merchantValidationSchema, req.body, res);
    if (!body) return;
    if (!allowPublicAttempt(`validar:${req.ip}`) || !allowPublicAttempt(`validar-code:${body.code}`)) {
      return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
    }
    try {
      const result = await validateFromMerchant(body.code, body.plate);
      res.json({ ok: true, merchant: result.merchant, benefit: result.benefit, plate: result.plate });
    } catch (error) {
      if (error instanceof AgreementError) return res.status(error.status).json({ error: error.message, code: error.code });
      fail(res, error);
    }
  });
}

export function registerPricingRoutes(app: Express) {
  const admin = requireAnyRole(["admin"]);
  const operators = requireAnyRole(["admin", "cashier", "guard"]);

  // ------------------------------------------------------------ tarifas
  app.get("/api/rate-plans", admin, async (req, res) => {
    try {
      const plans = await listRatePlans(await getTenantIdFromRequest(req));
      res.json({ plans: plans.map(planToJson) });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/rate-plans/:groupId/versions", admin, async (req, res) => {
    try {
      const versions = await listRatePlanVersions(await getTenantIdFromRequest(req), Number(req.params.groupId));
      res.json({ versions: versions.map((row: RatePlanRow) => ({ id: row.id, version: row.version, status: row.status, change_note: row.change_note, created_at: row.created_at, name: row.name })) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/rate-plans", admin, async (req, res) => {
    const body = parseBody(ratePlanSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const plan = await createRatePlan(tenantId, body, (await getCurrentUser(req))?.id ?? null);
      await recordAuditEvent(req, { action: "rate_plan.created", entityType: "rate_plan", entityId: plan.id, metadata: { name: plan.name, mode: plan.mode } });
      res.status(201).json({ plan: planToJson(plan) });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/rate-plans/:groupId", admin, async (req, res) => {
    const body = parseBody(ratePlanSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const plan = await updateRatePlan(tenantId, Number(req.params.groupId), body, (await getCurrentUser(req))?.id ?? null);
      await recordAuditEvent(req, { action: "rate_plan.versioned", entityType: "rate_plan", entityId: plan.id, metadata: { group_id: plan.group_id, version: plan.version, note: plan.change_note } });
      res.json({ plan: planToJson(plan) });
    } catch (error) { fail(res, error); }
  });

  app.delete("/api/rate-plans/:groupId", admin, async (req, res) => {
    try {
      const tenantId = await getTenantIdFromRequest(req);
      await archiveRatePlan(tenantId, Number(req.params.groupId));
      await recordAuditEvent(req, { action: "rate_plan.archived", entityType: "rate_plan", entityId: req.params.groupId });
      res.json({ ok: true });
    } catch (error) { fail(res, error); }
  });

  /** Simulador: cotiza una tarifa (guardada o borrador) entre dos horas locales, sin guardar nada. */
  app.post("/api/rate-plans/simulate", admin, async (req, res) => {
    const body = parseBody(z.object({ plan: ratePlanSchema, simulation: quoteSimulationSchema }), req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const timeZone = await getBranchTimezone(body.plan.branch_id ?? null, tenantId);
      const pricing = draftToPricingPlan(body.plan, timeZone);
      const errors = validatePlan(pricing);
      if (errors.length) return res.status(400).json({ error: "La tarifa no cumple las reglas", details: errors });
      const entry = localDateTime(body.simulation.entry_at, timeZone);
      const exit = localDateTime(body.simulation.exit_at, timeZone);
      if (!entry || !exit) return res.status(400).json({ error: "Fechas de entrada o salida invalidas" });
      if (exit.getTime() < entry.getTime()) return res.status(400).json({ error: "La salida es anterior a la entrada" });
      if (exit.getTime() - entry.getTime() > 366 * 86_400_000) return res.status(400).json({ error: "La simulacion admite hasta un año de estadia" });
      res.json({ result: quote(pricing, entry, exit, { extraFreeMins: body.simulation.extra_free_mins }), timeZone });
    } catch (error) { fail(res, error); }
  });

  // ------------------------------------------------------------ convenios
  app.get("/api/agreements", requireAnyRole(["admin", "finance", "cashier", "guard"]), async (req, res) => {
    try {
      const agreements = await listAgreements(await getTenantIdFromRequest(req));
      const user = await getCurrentUser(req);
      // Caja y guardia solo necesitan nombre y beneficio para validar; el codigo es del comercio.
      res.json({ agreements: user?.role === "admin" || user?.role === "finance" ? agreements : agreements.filter(a => a.status === "active").map(({ code: _code, ...rest }) => rest) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/agreements", admin, async (req, res) => {
    const body = parseBody(agreementSchema, req.body, res);
    if (!body) return;
    try {
      const agreement = await createAgreement(await getTenantIdFromRequest(req), body);
      await recordAuditEvent(req, { action: "agreement.created", entityType: "agreement", entityId: agreement.id, metadata: { name: agreement.name, kind: agreement.kind } });
      res.status(201).json({ agreement });
    } catch (error) { fail(res, error); }
  });

  app.put("/api/agreements/:id", admin, async (req, res) => {
    const body = parseBody(agreementSchema, req.body, res);
    if (!body) return;
    try {
      const agreement = await updateAgreement(await getTenantIdFromRequest(req), Number(req.params.id), body);
      await recordAuditEvent(req, { action: "agreement.updated", entityType: "agreement", entityId: agreement.id });
      res.json({ agreement });
    } catch (error) { fail(res, error); }
  });

  // ------------------------------------------------------------ validar / ticket perdido
  app.get("/api/visitors/:id/validations", operators, async (req, res) => {
    try {
      res.json({ validations: await listTicketValidationsForStaff(await getTenantIdFromRequest(req), Number(req.params.id)) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/visitors/:id/validations", operators, async (req, res) => {
    const body = parseBody(z.object({ agreement_id: z.coerce.number().int().positive() }), req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const user = await getCurrentUser(req);
      const result = await validateTicketWithAgreement({ tenantId, ticketId: Number(req.params.id), agreementId: body.agreement_id, validatedBy: "staff", staffId: user?.id ?? null });
      await recordAuditEvent(req, { action: "visitor_ticket.validated", entityType: "visitor_ticket", entityId: result.ticket.id, metadata: { agreement: result.agreement.name, kind: result.agreement.kind, value: result.agreement.value } });
      res.status(201).json({ ok: true, agreement: result.agreement.name });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/visitors/:id/lost-ticket", operators, async (req, res) => {
    const body = parseBody(lostTicketSchema, req.body, res);
    if (!body) return;
    try {
      const tenantId = await getTenantIdFromRequest(req);
      const user = await getCurrentUser(req);
      const result = await registerLostTicket({ tenantId, ticketId: Number(req.params.id), staffId: user?.id ?? null, values: body });
      await recordAuditEvent(req, { action: "visitor_ticket.lost_ticket_registered", entityType: "visitor_ticket", entityId: result.ticketId, metadata: { has_evidence: Boolean(result.evidence), note: body.note } });
      res.status(201).json({ ok: true, evidence: result.evidence });
    } catch (error) { fail(res, error); }
  });

  app.get("/api/visitors/:id/lost-ticket/evidence", requireAnyRole(["admin"]), async (req, res) => {
    try {
      const evidence = await resolveLostTicketEvidence(await getTenantIdFromRequest(req), Number(req.params.id));
      if (!evidence) return res.status(404).json({ error: "Este ticket no tiene evidencia" });
      res.download(evidence.absolutePath, evidence.fileName);
    } catch (error) { fail(res, error); }
  });
}
