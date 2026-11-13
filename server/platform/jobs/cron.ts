/**
 * Cron de 5 campos (minuto hora día-del-mes mes día-de-la-semana) evaluado en una zona horaria.
 * Soporta `*`, listas (`1,15`), rangos (`1-5`) y pasos (`*\/15`, `10-50/10`).
 * Sin dependencias: los jobs de Parkia solo necesitan esto y debe funcionar igual en SQLite, pglite y Postgres.
 */
import { DEFAULT_TIMEZONE } from "../timezone";

type Field = { any: boolean; values: Set<number> };
export type CronSpec = { minute: Field; hour: Field; dayOfMonth: Field; month: Field; dayOfWeek: Field };

const RANGES = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
} as const;

function parseField(text: string, [min, max]: readonly [number, number], label: string): Field {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [rangeText, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Cron invalido (${label}): paso "${stepText}"`);
    let from = min;
    let to = max;
    if (rangeText !== "*") {
      const [a, b] = rangeText.split("-");
      from = Number(a);
      to = b === undefined ? (stepText === undefined ? from : max) : Number(b);
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new Error(`Cron invalido (${label}): "${part}"`);
    }
    for (let value = from; value <= to; value += step) values.add(label === "dia de la semana" && value === 7 ? 0 : value);
  }
  return { any: text === "*", values };
}

export function parseCron(expression: string): CronSpec {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron invalido: se esperan 5 campos y llegaron ${parts.length} ("${expression}")`);
  return {
    minute: parseField(parts[0], RANGES.minute, "minuto"),
    hour: parseField(parts[1], RANGES.hour, "hora"),
    dayOfMonth: parseField(parts[2], RANGES.dayOfMonth, "dia del mes"),
    month: parseField(parts[3], RANGES.month, "mes"),
    dayOfWeek: parseField(parts[4], RANGES.dayOfWeek, "dia de la semana"),
  };
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return {
    minute: Number(value("minute")),
    hour: Number(value("hour")) % 24,
    day: Number(value("day")),
    month: Number(value("month")),
    weekday: WEEKDAYS[value("weekday")] ?? 0,
  };
}

/** ¿La hora `date` (en `timeZone`) cae en un minuto programado? Con día-del-mes y día-de-semana ambos fijos basta uno (como cron). */
export function cronMatches(spec: CronSpec, date: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const p = zonedParts(date, timeZone);
  if (!spec.minute.values.has(p.minute) || !spec.hour.values.has(p.hour) || !spec.month.values.has(p.month)) return false;
  const dom = spec.dayOfMonth.values.has(p.day);
  const dow = spec.dayOfWeek.values.has(p.weekday);
  if (spec.dayOfMonth.any && spec.dayOfWeek.any) return true;
  if (spec.dayOfMonth.any) return dow;
  if (spec.dayOfWeek.any) return dom;
  return dom || dow;
}

export function minuteSlot(date: Date): string {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString();
}

/**
 * Última ejecución programada que ya debió ocurrir (≤ `now`), mirando hasta `lookbackMinutes` atrás.
 * Sirve para recuperar lo que se perdió si el servidor estuvo caído a la hora programada.
 */
export function lastScheduledSlot(spec: CronSpec, now: Date, lookbackMinutes: number, timeZone: string = DEFAULT_TIMEZONE): string | null {
  const start = Math.floor(now.getTime() / 60_000) * 60_000;
  for (let i = 0; i <= lookbackMinutes; i++) {
    const candidate = new Date(start - i * 60_000);
    if (cronMatches(spec, candidate, timeZone)) return candidate.toISOString();
  }
  return null;
}
