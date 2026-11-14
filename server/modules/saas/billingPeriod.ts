/**
 * Reglas del período de cobro de la suscripción (puras: sin base de datos ni reloj).
 * Las fechas son días de calendario de Santiago en formato AAAA-MM-DD.
 */

/** Días que un cliente puede atrasarse sin perder continuidad: su nuevo período empieza donde terminó el anterior. */
export const BILLING_GRACE_DAYS = 7;
/** Con cuánta anticipación puede cobrarse a mano un período que aún no vence. */
export const MANUAL_CHARGE_ADVANCE_DAYS = 7;
/** Antigüedad máxima de la UF con que se acepta calcular un cobro. */
export const UF_MAX_AGE_DAYS = 10;

function toUtc(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Días de calendario desde `from` hasta `to` (negativo si `to` es anterior). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Mismo día del mes siguiente; si ese mes no lo tiene (31 de enero), el último día del mes. */
export function addOneMonth(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfNextMonth))).toISOString().slice(0, 10);
}

/**
 * Período que corresponde cobrar ahora.
 * - Si el período vigente aún no termina, o terminó hace poco (gracia), el nuevo empieza donde terminó el anterior:
 *   el cliente no pierde días pagados ni gana días gratis por pagar unos días tarde.
 * - Si lleva más tiempo sin pagar (suspendido), el nuevo período empieza hoy.
 */
export function nextBillingPeriod(currentPeriodEnd: string | null | undefined, today: string): { start: string; end: string } {
  const end = currentPeriodEnd ? String(currentPeriodEnd).slice(0, 10) : null;
  const start = end && daysBetween(end, today) <= BILLING_GRACE_DAYS ? end : today;
  return { start, end: addOneMonth(start) };
}

/** ¿Toca cobrar? El cobro automático espera al último día del período; el manual admite unos días de anticipación. */
export function isPeriodDue(currentPeriodEnd: string | null | undefined, today: string, advanceDays = 0): boolean {
  if (!currentPeriodEnd) return true;
  return daysBetween(today, String(currentPeriodEnd).slice(0, 10)) <= advanceDays;
}

/** Una UF de respaldo (inventada) o muy antigua no sirve para cobrarle a nadie. */
export function isUfUsable(uf: { rate_date: string; source: string }, today: string): boolean {
  if (uf.source === "fallback_env") return false;
  return daysBetween(String(uf.rate_date).slice(0, 10), today) <= UF_MAX_AGE_DAYS;
}
