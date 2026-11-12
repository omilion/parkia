import { db } from "../../db";
import { DEFAULT_TIME_ZONE, validatePlan, type PricingPlan, type PricingRule } from "./pricing-engine";
import type { RatePlanValues } from "../../../shared/schemas/pricing";

/**
 * Tarifas por empresa, con versiones. Editar una tarifa NO modifica la fila existente: crea una
 * version nueva y archiva la anterior. Cada ticket guarda el id de la version con que entro,
 * asi un cambio de precios nunca altera lo que ya esta dentro del recinto.
 */

export type RatePlanRow = {
  id: number;
  tenant_id: number;
  branch_id: number | null;
  group_id: number;
  version: number;
  name: string;
  vehicle_type: string;
  mode: "per_minute" | "elapsed_blocks";
  grace_mins: number;
  daily_cap: number | null;
  first_block_minutes: number | null;
  block_minutes: number | null;
  valid_from: string | null;
  valid_to: string | null;
  status: "active" | "archived";
  change_note: string | null;
  created_by_staff_id: number | null;
  created_at: string;
};

export type RateRuleRow = {
  id: number;
  plan_id: number;
  sort_order: number;
  weekdays: string | null;
  from_time: string;
  to_time: string;
  priority: number;
  price_per_minute: number | null;
  first_block_price: number | null;
  block_price: number | null;
};

export type RatePlanRecord = RatePlanRow & { rules: RateRuleRow[] };

export class RatePlanError extends Error {
  constructor(message: string, readonly details: string[] = [], readonly status = 400) {
    super(message);
    this.name = "RatePlanError";
  }
}

function parseWeekdays(value: string | null): number[] | null {
  if (!value) return null;
  const days = value.split(",").map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
  return days.length ? days : null;
}

export function toPricingPlan(record: RatePlanRecord, timeZone = DEFAULT_TIME_ZONE): PricingPlan {
  return {
    mode: record.mode,
    graceMins: record.grace_mins,
    dailyCap: record.daily_cap,
    firstBlockMinutes: record.first_block_minutes,
    blockMinutes: record.block_minutes,
    timeZone,
    rules: record.rules.map((rule): PricingRule => ({
      weekdays: parseWeekdays(rule.weekdays),
      from: rule.from_time,
      to: rule.to_time,
      priority: rule.priority,
      pricePerMinute: rule.price_per_minute,
      firstBlockPrice: rule.first_block_price,
      blockPrice: rule.block_price,
    })),
  };
}

/** Convierte lo que envia el editor al modelo del motor, para validarlo antes de guardar. */
function valuesToPricingPlan(values: RatePlanValues): PricingPlan {
  return {
    mode: values.mode,
    graceMins: values.grace_mins,
    dailyCap: values.daily_cap,
    firstBlockMinutes: values.first_block_minutes,
    blockMinutes: values.block_minutes,
    rules: values.rules.map(rule => ({
      weekdays: rule.weekdays,
      from: rule.from,
      to: rule.to,
      priority: rule.priority,
      pricePerMinute: rule.price_per_minute,
      firstBlockPrice: rule.first_block_price,
      blockPrice: rule.block_price,
    })),
  };
}

async function attachRules(plans: RatePlanRow[]): Promise<RatePlanRecord[]> {
  if (!plans.length) return [];
  const ids = plans.map(plan => plan.id);
  const rules = await db.prepare(`
    SELECT * FROM rate_rules WHERE plan_id IN (${ids.map(() => "?").join(", ")}) ORDER BY plan_id, sort_order, id
  `).all(...ids) as RateRuleRow[];
  return plans.map(plan => ({ ...plan, rules: rules.filter(rule => rule.plan_id === plan.id) }));
}

export async function loadRatePlan(planId: number, tenantId: number): Promise<RatePlanRecord | undefined> {
  const plan = await db.prepare("SELECT * FROM rate_plans WHERE id = ? AND tenant_id = ?").get(planId, tenantId) as RatePlanRow | undefined;
  return plan ? (await attachRules([plan]))[0] : undefined;
}

/** Version vigente de cada tarifa (una por grupo). */
export async function listRatePlans(tenantId: number, options: { includeArchived?: boolean } = {}): Promise<RatePlanRecord[]> {
  await ensureDefaultRatePlan(tenantId);
  const plans = await db.prepare(`
    SELECT p.* FROM rate_plans p
    WHERE p.tenant_id = ? ${options.includeArchived ? "" : "AND p.status = 'active'"}
    ORDER BY p.group_id, p.version DESC
  `).all(tenantId) as RatePlanRow[];
  // Una fila por grupo: la version mas reciente.
  const latest = new Map<number, RatePlanRow>();
  for (const plan of plans) if (!latest.has(plan.group_id)) latest.set(plan.group_id, plan);
  return attachRules([...latest.values()]);
}

export async function listRatePlanVersions(tenantId: number, groupId: number): Promise<RatePlanRow[]> {
  return await db.prepare("SELECT * FROM rate_plans WHERE tenant_id = ? AND group_id = ? ORDER BY version DESC").all(tenantId, groupId) as RatePlanRow[];
}

function assertValid(values: RatePlanValues) {
  const errors = validatePlan(valuesToPricingPlan(values));
  if (values.valid_from && values.valid_to && values.valid_to < values.valid_from) errors.push("La vigencia termina antes de empezar");
  if (errors.length) throw new RatePlanError("La tarifa no cumple las reglas", errors);
}

async function insertPlanVersion(tenantId: number, values: RatePlanValues, version: number, groupId: number, staffId: number | null) {
  const inserted = await db.prepare(`
    INSERT INTO rate_plans (tenant_id, branch_id, group_id, version, name, vehicle_type, mode, grace_mins, daily_cap,
      first_block_minutes, block_minutes, valid_from, valid_to, status, change_note, created_by_staff_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    tenantId, values.branch_id ?? null, groupId, version, values.name, values.vehicle_type, values.mode, values.grace_mins,
    values.daily_cap ?? null, values.mode === "elapsed_blocks" ? values.first_block_minutes ?? null : null,
    values.mode === "elapsed_blocks" ? values.block_minutes ?? null : null,
    values.valid_from ?? null, values.valid_to ?? null, values.change_note ?? null, staffId,
  );
  const planId = Number(inserted.lastInsertRowid);
  if (!groupId) await db.prepare("UPDATE rate_plans SET group_id = ? WHERE id = ?").run(planId, planId);
  let order = 0;
  for (const rule of values.rules) {
    await db.prepare(`
      INSERT INTO rate_rules (tenant_id, plan_id, sort_order, weekdays, from_time, to_time, priority, price_per_minute, first_block_price, block_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId, planId, order++, rule.weekdays?.length ? rule.weekdays.join(",") : null, rule.from, rule.to, rule.priority,
      values.mode === "per_minute" ? rule.price_per_minute ?? 0 : null,
      values.mode === "elapsed_blocks" ? rule.first_block_price ?? null : null,
      values.mode === "elapsed_blocks" ? rule.block_price ?? 0 : null,
    );
  }
  return planId;
}

export async function createRatePlan(tenantId: number, values: RatePlanValues, staffId: number | null): Promise<RatePlanRecord> {
  assertValid(values);
  const planId = await db.transaction(() => insertPlanVersion(tenantId, values, 1, 0, staffId))();
  return (await loadRatePlan(planId, tenantId))!;
}

/** Guarda una version nueva de la tarifa y archiva la anterior. Los tickets abiertos conservan la version con que entraron. */
export async function updateRatePlan(tenantId: number, groupId: number, values: RatePlanValues, staffId: number | null): Promise<RatePlanRecord> {
  assertValid(values);
  const planId = await db.transaction(async () => {
    const current = await db.prepare("SELECT * FROM rate_plans WHERE tenant_id = ? AND group_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
      .get(tenantId, groupId) as RatePlanRow | undefined;
    if (!current) throw new RatePlanError("Tarifa no encontrada", [], 404);
    await db.prepare("UPDATE rate_plans SET status = 'archived' WHERE tenant_id = ? AND group_id = ? AND status = 'active'").run(tenantId, groupId);
    return await insertPlanVersion(tenantId, values, current.version + 1, groupId, staffId);
  })();
  return (await loadRatePlan(planId, tenantId))!;
}

export async function archiveRatePlan(tenantId: number, groupId: number) {
  const active = await db.prepare("SELECT COUNT(DISTINCT group_id) AS n FROM rate_plans WHERE tenant_id = ? AND status = 'active'").get(tenantId) as { n: number };
  if (Number(active.n) <= 1) throw new RatePlanError("Debe quedar al menos una tarifa activa", [], 409);
  const result = await db.prepare("UPDATE rate_plans SET status = 'archived' WHERE tenant_id = ? AND group_id = ? AND status = 'active'").run(tenantId, groupId);
  if (!result.changes) throw new RatePlanError("Tarifa no encontrada", [], 404);
}

/**
 * Tarifa que corresponde a un ticket nuevo: la mas especifica gana (sucursal > todas; tipo de
 * vehiculo > cualquiera), dentro de su vigencia.
 */
export async function resolveRatePlan(tenantId: number, options: { branchId?: number | null; vehicleType?: string | null; at?: Date; timeZone?: string } = {}): Promise<RatePlanRecord | undefined> {
  const day = (options.at || new Date()).toISOString().slice(0, 10);
  const plan = await db.prepare(`
    SELECT * FROM rate_plans
    WHERE tenant_id = ? AND status = 'active'
      AND (branch_id IS NULL OR branch_id = ?)
      AND (vehicle_type = 'all' OR vehicle_type = ?)
      AND (valid_from IS NULL OR valid_from <= ?)
      AND (valid_to IS NULL OR valid_to >= ?)
    ORDER BY CASE WHEN branch_id IS NOT NULL THEN 1 ELSE 0 END DESC,
             CASE WHEN vehicle_type <> 'all' THEN 1 ELSE 0 END DESC,
             id DESC
    LIMIT 1
  `).get(tenantId, options.branchId ?? 0, options.vehicleType || "car", day, day) as RatePlanRow | undefined;
  return plan ? (await attachRules([plan]))[0] : undefined;
}

/** Id de la version vigente para un ticket nuevo (null si la empresa aun no tiene tarifas). */
export async function ratePlanIdForNewTicket(tenantId: number, branchId: number | null, vehicleType = "car"): Promise<number | null> {
  await ensureDefaultRatePlan(tenantId);
  return (await resolveRatePlan(tenantId, { branchId, vehicleType }))?.id ?? null;
}

/**
 * Toda empresa tiene al menos una tarifa. La primera se crea desde la tarifa "Publico General"
 * historica (access_rates), o con valores razonables si no existe.
 */
export async function ensureDefaultRatePlan(tenantId: number) {
  const existing = await db.prepare("SELECT id FROM rate_plans WHERE tenant_id = ? LIMIT 1").get(tenantId);
  if (existing) return;
  const legacy = await db.prepare(`
    SELECT * FROM access_rates
    WHERE tenant_id = ? AND lower(type) LIKE '%general%'
    ORDER BY id ASC LIMIT 1
  `).get(tenantId) as { rate_per_hour?: number; rate_per_minute?: number | null; grace_period_mins?: number } | undefined;
  const perMinute = Number(legacy?.rate_per_minute || 0) > 0 ? Number(legacy!.rate_per_minute) : Math.floor(Number(legacy?.rate_per_hour ?? 2500) / 60);
  const values: RatePlanValues = {
    name: "Público General", branch_id: null, vehicle_type: "all", mode: "per_minute",
    grace_mins: Number(legacy?.grace_period_mins ?? 15), daily_cap: null, first_block_minutes: null, block_minutes: null,
    valid_from: null, valid_to: null, change_note: "Tarifa inicial",
    rules: [{ weekdays: null, from: "00:00", to: "24:00", priority: 0, price_per_minute: perMinute, first_block_price: null, block_price: null }],
  };
  try {
    await db.transaction(() => insertPlanVersion(tenantId, values, 1, 0, null))();
  } catch (error) {
    // Dos peticiones simultaneas: la segunda ve la tarifa creada por la primera.
    const created = await db.prepare("SELECT id FROM rate_plans WHERE tenant_id = ? LIMIT 1").get(tenantId);
    if (!created) throw error;
  }
}

/**
 * La pantalla historica de Accesos edita la tarifa "Publico General" en access_rates. Se refleja
 * en la tarifa por defecto como una version nueva, para que ambas pantallas nunca discrepen.
 */
export async function syncDefaultPlanFromLegacyRate(tenantId: number, rate: { rate_per_minute: number; grace_period_mins: number }, staffId: number | null) {
  await ensureDefaultRatePlan(tenantId);
  const current = await db.prepare(`
    SELECT * FROM rate_plans WHERE tenant_id = ? AND status = 'active' AND branch_id IS NULL AND vehicle_type = 'all' AND mode = 'per_minute'
    ORDER BY group_id ASC, version DESC LIMIT 1
  `).get(tenantId) as RatePlanRow | undefined;
  if (!current) return;
  const record = (await loadRatePlan(current.id, tenantId))!;
  const values: RatePlanValues = {
    name: record.name, branch_id: null, vehicle_type: "all", mode: "per_minute", grace_mins: Number(rate.grace_period_mins),
    daily_cap: record.daily_cap, first_block_minutes: null, block_minutes: null, valid_from: record.valid_from, valid_to: record.valid_to,
    change_note: "Actualizada desde Accesos > Tarifas",
    rules: record.rules.map(rule => ({
      weekdays: parseWeekdays(rule.weekdays), from: rule.from_time, to: rule.to_time, priority: rule.priority,
      price_per_minute: rule.priority === Math.min(...record.rules.map(r => r.priority)) && record.rules.length === 1 ? Number(rate.rate_per_minute) : rule.price_per_minute,
      first_block_price: null, block_price: null,
    })),
  };
  // Solo se sincroniza cuando la tarifa por defecto es de una sola regla; las tarifas con horarios se editan en Configuracion.
  if (record.rules.length !== 1) return;
  await updateRatePlan(tenantId, record.group_id, values, staffId);
}
