/**
 * Fechas "de negocio". Un estacionamiento chileno cierra caja, vence cobros y abre turnos segun el dia de
 * Santiago, no el de UTC: a las 21:30 de Santiago ya es "manana" en UTC, y calcular el dia con
 * `new Date().toISOString().slice(0, 10)` adelanta todo ese tramo de la noche.
 *
 * Regla: para "hoy", "este mes" o el dia de un instante, usar estas funciones. `toISOString()` solo sirve para
 * guardar instantes (siempre en UTC) o para aritmetica de calendario sobre fechas ya calculadas.
 * Lo comparten el servidor y el navegador.
 */

export const DEFAULT_TIMEZONE = "America/Santiago";

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(timeZone: string, now: Date) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  const found = formatter.formatToParts(now);
  const value = (type: string) => found.find(part => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

/** Fecha (AAAA-MM-DD) que marca el calendario de `timeZone` en el instante `now`. */
export function formatLocalDate(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const { year, month, day } = parts(timeZone, now);
  return `${year}-${month}-${day}`;
}

/** Mes (AAAA-MM) que marca el calendario de `timeZone` en el instante `now`. */
export function formatLocalMonth(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const { year, month } = parts(timeZone, now);
  return `${year}-${month}`;
}

/** Fecha de hoy en Santiago. */
export function todayLocal(now: Date = new Date()): string {
  return formatLocalDate(DEFAULT_TIMEZONE, now);
}

/** Mes actual en Santiago. */
export function currentMonthLocal(now: Date = new Date()): string {
  return formatLocalMonth(DEFAULT_TIMEZONE, now);
}

/** Suma dias de calendario a una fecha AAAA-MM-DD (sin zona horaria de por medio: no hay desfase posible). */
export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Dia de calendario (en `timeZone`) de un instante guardado como texto. Los instantes se guardan en UTC
 * ('AAAA-MM-DD HH:MM:SS' o ISO con zona). Solo para instantes: una columna que ya es una fecha no necesita esto.
 * Es lo mismo que hace parkia_local_date() en SQL, tanto en SQLite como en PostgreSQL. null si no es una fecha.
 */
export function localDateOfInstant(value: unknown, timeZone: string = DEFAULT_TIMEZONE): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : formatLocalDate(timeZone, value);
  const text = String(value).trim();
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  const instant = new Date(hasZone ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(instant.getTime()) ? null : formatLocalDate(timeZone, instant);
}
