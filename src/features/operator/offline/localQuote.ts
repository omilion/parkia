import { quoteForDevice, resolvePlanFromCatalog, type PlanCatalogEntry } from '../../../../shared/offline-pricing';
import type { ProjectedTicket } from './types';

export class NoLocalPlanError extends Error {
  constructor() {
    super('Este dispositivo no tiene las tarifas descargadas. Conéctate una vez a internet para poder cobrar sin conexión.');
    this.name = 'NoLocalPlanError';
  }
}

export type LocalQuote = {
  id: number;
  total: number;
  subtotal: number;
  discount_amount: number;
  duration_minutes: number;
  grace_period_mins: number;
  rate_label: string;
  offline: true;
};

const parseSql = (value: string) => new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));

/**
 * Cotización en el dispositivo, con el mismo motor que el servidor y los datos descargados.
 * Usa la tarifa con que entró el ticket; si el ticket se creó sin conexión, la vigente a su hora de entrada.
 */
export function quoteTicketLocally(ticket: ProjectedTicket, plans: PlanCatalogEntry[], branchId: number, at: Date = new Date()): LocalQuote {
  const entryAt = parseSql(ticket.entry_time);
  const plan = (ticket.rate_plan_id ? plans.find(item => item.id === ticket.rate_plan_id) : undefined)
    ?? resolvePlanFromCatalog(plans, { branchId, vehicleType: ticket.vehicle_type, at: entryAt });
  if (!plan) throw new NoLocalPlanError();
  const result = quoteForDevice(plan.pricing, entryAt, at < entryAt ? entryAt : at, ticket.validations);
  return {
    id: 0, total: result.total, subtotal: result.subtotal, discount_amount: result.discount, duration_minutes: result.durationMins,
    grace_period_mins: plan.pricing.graceMins, rate_label: plan.version > 1 ? `${plan.name} (v${plan.version})` : plan.name, offline: true,
  };
}
