import { quote, type PricingPlan, type QuoteResult } from './pricing-engine';

/**
 * Cotización "de dispositivo": las mismas reglas que el servidor, sobre datos que el dispositivo
 * descargó (catálogo de tarifas y convenios aplicados). El servidor usa estas funciones para sus propias
 * cotizaciones, de modo que la cifra que ve el guardia sin red y la que el servidor recalcula al
 * sincronizar salen del mismo código.
 */

export type PlanCatalogEntry = {
  id: number;
  group_id: number;
  version: number;
  name: string;
  branch_id: number | null;
  vehicle_type: string;
  valid_from: string | null;
  valid_to: string | null;
  status: 'active' | 'archived';
  pricing: PricingPlan;
};

/**
 * Elige la tarifa vigente para un ticket nuevo: sucursal propia > todas, tipo de vehículo propio >
 * todos, dentro de su vigencia; a igualdad gana la más reciente. Replica `resolveRatePlan` del servidor.
 */
export function resolvePlanFromCatalog(
  catalog: PlanCatalogEntry[],
  options: { branchId?: number | null; vehicleType?: string | null; at?: Date },
): PlanCatalogEntry | undefined {
  const day = (options.at ?? new Date()).toISOString().slice(0, 10);
  const vehicleType = options.vehicleType || 'car';
  const branchId = options.branchId ?? 0;
  return catalog
    .filter(plan =>
      plan.status === 'active'
      && (plan.branch_id === null || plan.branch_id === branchId)
      && (plan.vehicle_type === 'all' || plan.vehicle_type === vehicleType)
      && (plan.valid_from === null || plan.valid_from <= day)
      && (plan.valid_to === null || plan.valid_to >= day))
    .sort((a, b) =>
      (Number(b.branch_id !== null) - Number(a.branch_id !== null))
      || (Number(b.vehicle_type !== 'all') - Number(a.vehicle_type !== 'all'))
      || (b.id - a.id))[0];
}

export type AgreementValidation = { kind: 'free_minutes' | 'percent' | 'fixed'; value: number; cap_amount: number | null };

export function extraFreeMinutes(validations: AgreementValidation[]) {
  return validations.filter(item => item.kind === 'free_minutes').reduce((sum, item) => sum + Number(item.value), 0);
}

/** Descuento en pesos de cada convenio, en orden: porcentaje y monto fijo sobre lo que va quedando, con tope. */
export function applyAgreementDiscounts(subtotal: number, validations: AgreementValidation[]) {
  let remaining = subtotal;
  const amounts = validations.map(validation => {
    let amount = 0;
    if (validation.kind === 'percent') amount = Math.round(remaining * Number(validation.value) / 100);
    else if (validation.kind === 'fixed') amount = Number(validation.value);
    if (validation.cap_amount != null) amount = Math.min(amount, Number(validation.cap_amount));
    amount = Math.max(0, Math.min(amount, remaining));
    remaining -= amount;
    return amount;
  });
  const discount = amounts.reduce((sum, amount) => sum + amount, 0);
  return { amounts, discount, total: Math.max(subtotal - discount, 0) };
}

export type DeviceQuote = {
  subtotal: number;
  discount: number;
  total: number;
  durationMins: number;
  billableMins: number;
  priced: QuoteResult;
};

export function quoteForDevice(plan: PricingPlan, entryAt: Date, exitAt: Date, validations: AgreementValidation[] = []): DeviceQuote {
  const priced = quote(plan, entryAt, exitAt, { extraFreeMins: extraFreeMinutes(validations) });
  const { discount, total } = applyAgreementDiscounts(priced.subtotal, validations);
  return { subtotal: priced.subtotal, discount, total, durationMins: priced.durationMins, billableMins: priced.billableMins, priced };
}
