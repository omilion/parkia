/**
 * Motor tarifario puro (sin base de datos): dada una tarifa y los instantes de entrada y salida
 * devuelve el desglose del cobro. Lo usan la cotizacion de tickets, el simulador de tarifas y
 * las pruebas de tabla.
 *
 * Reglas:
 *  - Solo se cobran minutos COMPLETOS transcurridos (Ley 20.967: sin redondeo al alza).
 *  - Los minutos de gracia se descuentan del inicio: el tiempo cobrable parte en entrada + gracia.
 *  - Todo se evalua en hora local de la sucursal: ventanas horarias, dia de la semana, tope
 *    diario y cambios de hora (verano) se resuelven por instante, no por reloj de pared.
 *  - Modo `per_minute`: precio por minuto segun la regla vigente en ese minuto.
 *  - Modo `elapsed_blocks`: tramos VENCIDOS. Solo se cobra un tramo cuando se cumplio completo;
 *    el primero dura minimo 30 min y los siguientes minimo 10 min (se validan al guardar la tarifa).
 *    VERIFICAR-LEGAL: confirmar con asesoria legal la lectura de "tramo vencido" de la Ley 20.967.
 *  - Tope diario: por dia calendario local; nunca se cobra mas que el tope en un mismo dia.
 */

export type PricingMode = "per_minute" | "elapsed_blocks";

export type PricingRule = {
  /** Dias ISO (1 = lunes ... 7 = domingo). null = todos los dias. */
  weekdays: number[] | null;
  /** "HH:MM" local, inicio inclusivo. */
  from: string;
  /** "HH:MM" local, fin exclusivo. "24:00" = medianoche. Si es menor que `from`, la ventana cruza medianoche. */
  to: string;
  /** Mayor prioridad gana cuando varias reglas coinciden. */
  priority: number;
  pricePerMinute?: number | null;
  firstBlockPrice?: number | null;
  blockPrice?: number | null;
};

export type PricingPlan = {
  mode: PricingMode;
  graceMins: number;
  dailyCap?: number | null;
  firstBlockMinutes?: number | null;
  blockMinutes?: number | null;
  timeZone?: string;
  rules: PricingRule[];
};

export type QuoteLine = {
  kind: "minutes" | "block";
  /** ISO 8601 UTC. */
  from: string;
  to: string;
  localDate: string;
  minutes: number;
  unitPrice: number;
  amount: number;
  ruleIndex: number | null;
};

export type QuoteDay = { date: string; amount: number; cap: number | null; capped: boolean };

export type QuoteResult = {
  mode: PricingMode;
  timeZone: string;
  durationMins: number;
  graceMins: number;
  /** Minutos gratis adicionales (convenios) descontados del inicio, ademas de la gracia. */
  extraFreeMins: number;
  billableMins: number;
  /** Suma de lineas, antes del tope diario. */
  uncappedSubtotal: number;
  /** Cobro total tras el tope diario. */
  subtotal: number;
  lines: QuoteLine[];
  days: QuoteDay[];
  /** Minutos cobrables sin regla vigente (la tarifa debe cubrir todo el dia; no deberia ocurrir). */
  uncoveredMins: number;
  /** Tramos cumplidos y minutos del tramo en curso (solo `elapsed_blocks`). */
  blocksCharged?: number;
  minutesIntoCurrentBlock?: number;
};

export const DEFAULT_TIME_ZONE = "America/Santiago";
export const MIN_FIRST_BLOCK_MINUTES = 30;
export const MIN_NEXT_BLOCK_MINUTES = 10;
const MINUTE_MS = 60_000;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// ------------------------------------------------------------------ hora local

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export type LocalParts = { date: string; minutes: number; isoWeekday: number; year: number; month: number; day: number };

export function localParts(ms: number, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const value = (type: string) => parts.find(part => part.type === type)?.value || "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  const hour = Number(value("hour")) % 24;
  return {
    year, month, day,
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: hour * 60 + Number(value("minute")),
    isoWeekday: WEEKDAYS[value("weekday")] || 1,
  };
}

/** Desfase de la zona respecto a UTC en el instante dado (ms). */
function offsetMs(ms: number, timeZone: string) {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value || 0);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour") % 24, value("minute"), value("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC de una fecha local y minuto del dia. Una hora inexistente (salto de verano) se corre hacia adelante. */
export function localToInstant(date: string, minutesOfDay: number, timeZone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}

// ------------------------------------------------------------------ reglas

function ruleMatches(rule: PricingRule, isoWeekday: number, minutes: number): boolean {
  const from = parseTime(rule.from) ?? 0;
  const to = parseTime(rule.to) ?? 1440;
  const on = (day: number) => !rule.weekdays || rule.weekdays.includes(day);
  if (from < to) return on(isoWeekday) && minutes >= from && minutes < to;
  // Ventana que cruza medianoche: la parte posterior pertenece al dia en que la ventana empezo.
  const previous = isoWeekday === 1 ? 7 : isoWeekday - 1;
  return (on(isoWeekday) && minutes >= from) || (on(previous) && minutes < to);
}

function pickRule(rules: PricingRule[], parts: LocalParts): number | null {
  let best: number | null = null;
  rules.forEach((rule, index) => {
    if (!ruleMatches(rule, parts.isoWeekday, parts.minutes)) return;
    if (best === null || rule.priority > rules[best].priority) best = index;
  });
  return best;
}

/** Errores de una tarifa antes de guardarla. Lista vacia = valida. */
export function validatePlan(plan: PricingPlan): string[] {
  const errors: string[] = [];
  const isInt = (value: unknown, min = 0) => typeof value === "number" && Number.isInteger(value) && value >= min;

  if (plan.timeZone) {
    try { formatterFor(plan.timeZone); } catch { errors.push(`Zona horaria invalida: ${plan.timeZone}`); }
  }
  if (!isInt(plan.graceMins)) errors.push("Los minutos de gracia deben ser un entero igual o mayor que 0");
  if (plan.dailyCap != null && !isInt(plan.dailyCap, 1)) errors.push("El tope diario debe ser un monto entero mayor que 0");

  if (plan.mode === "elapsed_blocks") {
    if (!isInt(plan.firstBlockMinutes, MIN_FIRST_BLOCK_MINUTES)) errors.push(`Por ley (20.967) el primer tramo dura al menos ${MIN_FIRST_BLOCK_MINUTES} minutos`);
    if (!isInt(plan.blockMinutes, MIN_NEXT_BLOCK_MINUTES)) errors.push(`Por ley (20.967) los tramos siguientes duran al menos ${MIN_NEXT_BLOCK_MINUTES} minutos`);
  } else if (plan.mode !== "per_minute") {
    errors.push("El modo de cobro debe ser por minuto o por tramos vencidos");
  }

  if (!plan.rules.length) errors.push("La tarifa necesita al menos una regla de precio");
  plan.rules.forEach((rule, index) => {
    const label = `Regla ${index + 1}`;
    const from = parseTime(rule.from);
    const to = parseTime(rule.to);
    if (from === null || from >= 1440) errors.push(`${label}: hora de inicio invalida (use HH:MM)`);
    if (to === null) errors.push(`${label}: hora de termino invalida (use HH:MM)`);
    if (from !== null && to !== null && from === to) errors.push(`${label}: el inicio y el termino no pueden ser iguales`);
    if (rule.weekdays && (!rule.weekdays.length || rule.weekdays.some(day => !isInt(day, 1) || day > 7))) errors.push(`${label}: los dias deben ir de 1 (lunes) a 7 (domingo)`);
    if (!isInt(rule.priority)) errors.push(`${label}: la prioridad debe ser un entero igual o mayor que 0`);
    if (plan.mode === "per_minute") {
      if (!isInt(rule.pricePerMinute)) errors.push(`${label}: indique el precio por minuto (entero, en pesos)`);
    } else {
      if (!isInt(rule.blockPrice)) errors.push(`${label}: indique el precio del tramo (entero, en pesos)`);
      if (rule.firstBlockPrice != null && !isInt(rule.firstBlockPrice)) errors.push(`${label}: el precio del primer tramo debe ser un entero igual o mayor que 0`);
    }
  });

  if (!errors.length) {
    // Cobertura: cada minuto de cada dia de la semana debe tener una regla.
    const uncovered: string[] = [];
    const names = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
    for (let day = 1; day <= 7; day += 1) {
      let gapStart = -1;
      for (let minute = 0; minute <= 1440; minute += 1) {
        const covered = minute < 1440 && plan.rules.some(rule => ruleMatches(rule, day, minute));
        if (!covered && gapStart < 0 && minute < 1440) gapStart = minute;
        if ((covered || minute === 1440) && gapStart >= 0) {
          const hhmm = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
          uncovered.push(`${names[day - 1]} ${hhmm(gapStart)}-${hhmm(minute)}`);
          gapStart = -1;
        }
      }
    }
    if (uncovered.length) errors.push(`Hay horarios sin precio: ${uncovered.slice(0, 4).join(", ")}${uncovered.length > 4 ? "..." : ""}. Agregue una regla que los cubra.`);
  }
  return errors;
}

// ------------------------------------------------------------------ cotizacion

function breakpoints(plan: PricingPlan, startMs: number, endMs: number, timeZone: string): number[] {
  const points = new Set<number>([startMs, endMs]);
  const firstDate = localParts(startMs, timeZone).date;
  const lastDate = localParts(endMs, timeZone).date;
  const times = new Set<number>([0]);
  for (const rule of plan.rules) {
    const from = parseTime(rule.from);
    const to = parseTime(rule.to);
    if (from !== null) times.add(from);
    if (to !== null) times.add(to);
  }
  for (let date = addDays(firstDate, -1); date <= addDays(lastDate, 1); date = addDays(date, 1)) {
    for (const minute of times) {
      const instant = minute >= 1440 ? localToInstant(addDays(date, 1), 0, timeZone) : localToInstant(date, minute, timeZone);
      if (instant > startMs && instant < endMs) points.add(instant);
    }
  }
  return [...points].sort((a, b) => a - b);
}

export function quote(
  plan: PricingPlan,
  entryAt: Date,
  exitAt: Date,
  options: { extraFreeMins?: number } = {},
): QuoteResult {
  const timeZone = plan.timeZone || DEFAULT_TIME_ZONE;
  const extraFreeMins = Math.max(0, Math.floor(options.extraFreeMins || 0));
  const graceMins = Math.max(0, Math.floor(plan.graceMins || 0));
  const durationMins = Math.max(0, Math.floor((exitAt.getTime() - entryAt.getTime()) / MINUTE_MS));
  const billableMins = Math.max(0, durationMins - graceMins - extraFreeMins);
  const result: QuoteResult = {
    mode: plan.mode, timeZone, durationMins, graceMins, extraFreeMins, billableMins,
    uncappedSubtotal: 0, subtotal: 0, lines: [], days: [], uncoveredMins: 0,
  };
  if (billableMins === 0) return result;

  // El tiempo cobrable parte despues de la gracia y se cuenta en minutos completos desde ahi.
  const billableStart = entryAt.getTime() + (graceMins + extraFreeMins) * MINUTE_MS;
  const billableEnd = billableStart + billableMins * MINUTE_MS;
  const iso = (ms: number) => new Date(ms).toISOString();

  if (plan.mode === "per_minute") {
    const points = breakpoints(plan, billableStart, billableEnd, timeZone);
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      // Un minuto pertenece al tramo donde empieza.
      const firstMinute = Math.ceil((a - billableStart) / MINUTE_MS);
      const lastMinute = Math.min(billableMins, Math.ceil((b - billableStart) / MINUTE_MS));
      const minutes = Math.max(0, lastMinute - firstMinute);
      if (minutes === 0) continue;
      const startOfSegment = billableStart + firstMinute * MINUTE_MS;
      const parts = localParts(startOfSegment, timeZone);
      const ruleIndex = pickRule(plan.rules, parts);
      if (ruleIndex === null) { result.uncoveredMins += minutes; continue; }
      const unitPrice = plan.rules[ruleIndex].pricePerMinute || 0;
      result.lines.push({
        kind: "minutes", from: iso(startOfSegment), to: iso(startOfSegment + minutes * MINUTE_MS),
        localDate: parts.date, minutes, unitPrice, amount: minutes * unitPrice, ruleIndex,
      });
    }
  } else {
    const firstBlock = plan.firstBlockMinutes || MIN_FIRST_BLOCK_MINUTES;
    const nextBlock = plan.blockMinutes || MIN_NEXT_BLOCK_MINUTES;
    let blockStartMin = 0;
    let blockIndex = 0;
    for (;;) {
      const length = blockIndex === 0 ? firstBlock : nextBlock;
      if (blockStartMin + length > billableMins) {
        result.blocksCharged = blockIndex;
        result.minutesIntoCurrentBlock = billableMins - blockStartMin;
        break;
      }
      const startMs = billableStart + blockStartMin * MINUTE_MS;
      const parts = localParts(startMs, timeZone);
      const ruleIndex = pickRule(plan.rules, parts);
      if (ruleIndex === null) {
        result.uncoveredMins += length;
      } else {
        const rule = plan.rules[ruleIndex];
        const unitPrice = blockIndex === 0 ? (rule.firstBlockPrice ?? rule.blockPrice ?? 0) : (rule.blockPrice || 0);
        result.lines.push({
          kind: "block", from: iso(startMs), to: iso(startMs + length * MINUTE_MS),
          localDate: parts.date, minutes: length, unitPrice, amount: unitPrice, ruleIndex,
        });
      }
      blockStartMin += length;
      blockIndex += 1;
    }
  }

  // Tope diario por dia calendario local.
  const perDay = new Map<string, number>();
  for (const line of result.lines) perDay.set(line.localDate, (perDay.get(line.localDate) || 0) + line.amount);
  const cap = plan.dailyCap && plan.dailyCap > 0 ? plan.dailyCap : null;
  for (const [date, amount] of [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const capped = cap !== null && amount > cap;
    result.days.push({ date, amount: capped ? cap! : amount, cap, capped });
    result.uncappedSubtotal += amount;
    result.subtotal += capped ? cap! : amount;
  }
  return result;
}
