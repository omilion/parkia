import { db } from "../../db";
import { getBranchTimezone } from "../../platform/timezone";
import type { AgreementValidation, PlanCatalogEntry } from "../../../shared/offline-pricing";
import { listRatePlans, loadRatePlan, toPricingPlan, type RatePlanRecord } from "../tickets/rate-plans";

/**
 * Lo que un dispositivo descarga para operar sin conexión en una sucursal:
 * plazas, tickets abiertos con su tarifa y convenios, y el catálogo de tarifas vigentes.
 * Con esto el dispositivo cotiza con el mismo motor que el servidor (`shared/offline-pricing.ts`).
 */

export type SnapshotTicket = {
  id: number;
  plate: string;
  status: "active" | "paid";
  entry_time: string;
  vehicle_type: string;
  rate_plan_id: number | null;
  space_id: number | null;
  space_name: string | null;
  public_token: string | null;
  amount: number;
  paid_at: string | null;
  exit_deadline: string | null;
  validations: AgreementValidation[];
};

function toCatalogEntry(plan: RatePlanRecord, timeZone: string): PlanCatalogEntry {
  return {
    id: plan.id, group_id: plan.group_id, version: plan.version, name: plan.name, branch_id: plan.branch_id, vehicle_type: plan.vehicle_type,
    valid_from: plan.valid_from, valid_to: plan.valid_to, status: plan.status, pricing: toPricingPlan(plan, timeZone),
  };
}

export async function buildOperatorSnapshot(tenantId: number, branchId: number) {
  const branch = await db.prepare("SELECT id, name FROM branches WHERE id = ? AND tenant_id = ?").get(branchId, tenantId) as { id: number; name: string } | undefined;
  if (!branch) return null;
  const timeZone = await getBranchTimezone(branchId, tenantId);

  const spaces = await db.prepare("SELECT id, name, status FROM spaces WHERE type = 'parking' AND branch_id = ? AND tenant_id = ? ORDER BY id").all(branchId, tenantId);

  const rows = await db.prepare(`
    SELECT vt.id, vt.plate, vt.status, vt.entry_time, vt.vehicle_type, vt.rate_plan_id, vt.space_id, s.name AS space_name,
           vt.public_token, vt.amount, vt.paid_at, vt.exit_deadline
    FROM visitor_tickets vt LEFT JOIN spaces s ON s.id = vt.space_id
    WHERE vt.tenant_id = ? AND vt.branch_id = ? AND vt.status IN ('active', 'paid')
    ORDER BY vt.entry_time DESC
  `).all(tenantId, branchId) as Array<Omit<SnapshotTicket, "validations">>;

  const validations = rows.length ? await db.prepare(`
    SELECT v.ticket_id, a.kind, a.value, a.cap_amount
    FROM ticket_validations v JOIN agreements a ON a.id = v.agreement_id
    WHERE v.tenant_id = ? AND v.ticket_id IN (${rows.map(() => "?").join(",")}) ORDER BY v.id
  `).all(tenantId, ...rows.map(row => row.id)) as Array<{ ticket_id: number } & AgreementValidation> : [];
  const byTicket = new Map<number, AgreementValidation[]>();
  for (const item of validations) byTicket.set(item.ticket_id, [...(byTicket.get(item.ticket_id) ?? []), { kind: item.kind, value: Number(item.value), cap_amount: item.cap_amount == null ? null : Number(item.cap_amount) }]);

  // Tarifas vigentes + las versiones (aunque esten archivadas) con las que entraron los tickets abiertos.
  const catalog = new Map<number, PlanCatalogEntry>();
  for (const plan of await listRatePlans(tenantId)) catalog.set(plan.id, toCatalogEntry(plan, timeZone));
  for (const id of new Set(rows.map(row => row.rate_plan_id).filter((value): value is number => Boolean(value)))) {
    if (catalog.has(id)) continue;
    const plan = await loadRatePlan(id, tenantId);
    if (plan) catalog.set(plan.id, toCatalogEntry(plan, timeZone));
  }

  return {
    server_time: new Date().toISOString(),
    branch: { id: branch.id, name: branch.name, time_zone: timeZone },
    spaces,
    tickets: rows.map(row => ({ ...row, amount: Number(row.amount || 0), validations: byTicket.get(row.id) ?? [] })) satisfies SnapshotTicket[],
    plans: [...catalog.values()],
  };
}
