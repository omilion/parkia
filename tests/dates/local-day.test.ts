import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import { startTestServer } from "../support/apiHarness";

/**
 * El dia de negocio es el de Santiago. Entre las 21:00 y las 00:00 (verano: UTC-3; invierno: UTC-4) en UTC ya es
 * "manana": las pruebas fijan el reloj en ese tramo, que es donde vivia el desfase.
 */
const harness = await startTestServer();
const { db, call } = harness;
const dates = await import("../../shared/dates");
const finance = await import("../../server/modules/finance/shared");
const tenantService = await import("../../server/platform/tenant/service");

// 22:30 del 13-nov-2026 en Santiago (verano, UTC-3) = 01:30 del 14 en UTC.
const NIGHT = new Date("2026-11-14T01:30:00Z");
let admin = "";
before(async () => { admin = await harness.login(); });
after(async () => { mock.timers.reset(); await harness.close(); });

const withClock = async <T>(instant: Date, fn: () => Promise<T> | T): Promise<T> => {
  mock.timers.enable({ apis: ["Date"], now: instant });
  try { return await fn(); } finally { mock.timers.reset(); }
};

test("el dia de Santiago: verano (UTC-3), invierno (UTC-4) y cambios de mes y de año", () => {
  assert.equal(dates.todayLocal(NIGHT), "2026-11-13", "22:30 locales siguen siendo el 13");
  assert.equal(dates.todayLocal(new Date("2026-11-14T03:00:00Z")), "2026-11-14", "00:00 locales ya es el 14");
  assert.equal(dates.todayLocal(new Date("2026-07-15T03:30:00Z")), "2026-07-14", "invierno: 23:30 locales");
  assert.equal(dates.todayLocal(new Date("2026-07-15T04:00:00Z")), "2026-07-15", "invierno: 00:00 locales");
  assert.equal(dates.currentMonthLocal(new Date("2026-12-01T02:30:00Z")), "2026-11", "23:30 del 30-nov sigue siendo noviembre");
  assert.equal(dates.currentMonthLocal(new Date("2027-01-01T02:00:00Z")), "2026-12", "fin de año");
  assert.equal(dates.formatLocalDate("UTC", NIGHT), "2026-11-14", "con otra zona el resultado cambia (la zona se respeta)");
});

test("localDateOfInstant: instantes en UTC, con o sin zona; lo invalido da null", () => {
  assert.equal(dates.localDateOfInstant("2026-11-14 01:30:00"), "2026-11-13");
  assert.equal(dates.localDateOfInstant("2026-11-14T01:30:00Z"), "2026-11-13");
  assert.equal(dates.localDateOfInstant("2026-11-14T01:30:00.000+00:00"), "2026-11-13");
  assert.equal(dates.localDateOfInstant("2026-11-14 03:00:00"), "2026-11-14");
  assert.equal(dates.localDateOfInstant(NIGHT), "2026-11-13");
  assert.equal(dates.localDateOfInstant(null), null);
  assert.equal(dates.localDateOfInstant("no es una fecha"), null);
});

test("addCalendarDays no depende de la zona horaria", () => {
  assert.equal(dates.addCalendarDays("2026-11-30", 1), "2026-12-01");
  assert.equal(dates.addCalendarDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dates.addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(dates.addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("SQL: parkia_local_date convierte un instante UTC al dia de Santiago (SQLite y PostgreSQL)", async () => {
  const day = async (value: string | null) => (await db.prepare("SELECT parkia_local_date(?) AS d").get(value) as { d: string | null }).d;
  assert.equal(await day("2026-11-14 01:30:00"), "2026-11-13");
  assert.equal(await day("2026-11-14 02:59:59"), "2026-11-13");
  assert.equal(await day("2026-11-14 03:00:00"), "2026-11-14");
  assert.equal(await day("2026-07-15 03:59:59"), "2026-07-14");
  assert.equal(await day("2026-07-15 04:00:00"), "2026-07-15");
  assert.equal(await day(null), null);
});

test("SQL: date('now') y strftime(f, 'now') son el dia y el mes de Santiago", async (t) => {
  // Sin reloj falso: ambos motores coinciden con el helper de JS.
  const row = await db.prepare("SELECT date('now') AS d, strftime('%Y-%m', 'now') AS m, date('now', '+1 day') AS next").get() as { d: string; m: string; next: string };
  const before = dates.todayLocal();
  assert.ok([before, dates.todayLocal()].includes(row.d), `${row.d} vs ${before}`);
  assert.equal(row.m, row.d.slice(0, 7));
  assert.equal(row.next, dates.addCalendarDays(row.d, 1));

  // Con el reloj en la noche solo se puede comprobar en SQLite: PostgreSQL usa su propio now(). Su traduccion se prueba aparte.
  if (db.dialect !== "sqlite") { t.diagnostic("reloj falso solo en SQLite"); return; }
  await withClock(NIGHT, async () => {
    const night = await db.prepare("SELECT date('now') AS d, strftime('%Y-%m', 'now') AS m, date('now', '+30 days') AS soon").get() as { d: string; m: string; soon: string };
    assert.equal(night.d, "2026-11-13", "en UTC seria 2026-11-14");
    assert.equal(night.soon, "2026-12-13");
  });
  await withClock(new Date("2026-12-01T02:30:00Z"), async () => {
    const monthEnd = await db.prepare("SELECT strftime('%Y-%m', 'now') AS m, date('now', 'start of month') AS first FROM (SELECT 1)").get() as { m: string; first: string };
    assert.equal(monthEnd.m, "2026-11", "23:30 del 30-nov: sigue siendo el mes de noviembre");
    assert.equal(monthEnd.first, "2026-11-01");
  });
});

test("el traductor a PostgreSQL usa el calendario de Santiago para 'hoy' y para el mes", async () => {
  const { translateSqliteToPostgres } = await import("../../server/db/engine/translate");
  const today = translateSqliteToPostgres("SELECT 1 FROM t WHERE due_date < date('now')");
  assert.match(today, /AT TIME ZONE 'America\/Santiago'/);
  assert.doesNotMatch(today, /AT TIME ZONE 'UTC'/);
  assert.match(translateSqliteToPostgres("SELECT strftime('%Y-%m', 'now')"), /America\/Santiago/);
  assert.match(translateSqliteToPostgres("SELECT date('now', '+30 days')"), /America\/Santiago/);
  // Los instantes guardados (datetime('now')) siguen en UTC: es lo que se almacena.
  assert.match(translateSqliteToPostgres("SELECT datetime('now')"), /AT TIME ZONE 'UTC'/);
  assert.match(translateSqliteToPostgres("SELECT parkia_local_date(paid_at)"), /::timestamptz AT TIME ZONE 'America\/Santiago'\)::date/);
});

test("el rango del mes por defecto sigue en noviembre a las 23:30 del 30 de noviembre", async () => {
  await withClock(new Date("2026-12-01T02:30:00Z"), () => {
    const range = finance.getMonthRange();
    assert.deepEqual(range, { month: "2026-11", start: "2026-11-01", end: "2026-12-01" });
  });
  await withClock(NIGHT, () => assert.equal(finance.reportMeta({ formulas: {} }).cutOffDate, "2026-11-13"));
});

test("la suscripcion no se bloquea 3 horas antes de su ultimo dia", async () => {
  const context = (subscription: Record<string, unknown>) => ({ tenant: { id: 1, name: "T", rut: null, status: "active" }, subscription }) as unknown as Parameters<typeof tenantService.isTenantSubscriptionUsable>[0];
  await withClock(NIGHT, () => {
    // El periodo termina hoy (13): a las 22:30 todavia se puede operar. Con el dia en UTC (14) se bloqueaba.
    assert.equal(tenantService.isTenantSubscriptionUsable(context({ status: "active", current_period_end: "2026-11-13" })), true);
    assert.equal(tenantService.isTenantSubscriptionUsable(context({ status: "past_due", grace_until: "2026-11-13" })), true);
    // Un dia vencido si bloquea.
    assert.equal(tenantService.isTenantSubscriptionUsable(context({ status: "active", current_period_end: "2026-11-12" })), false);
    assert.equal(tenantService.isTenantSubscriptionUsable(context({ status: "past_due", grace_until: "2026-11-12" })), false);
  });
  await withClock(new Date("2026-11-14T03:30:00Z"), () => {
    // Pasada la medianoche de Santiago el periodo del 13 ya vencio.
    assert.equal(tenantService.isTenantSubscriptionUsable(context({ status: "active", current_period_end: "2026-11-13" })), false);
  });
});

test("un pago de las 22:30 aparece en el dia que el cajero vivio, no en el siguiente", async () => {
  const space = await db.prepare("INSERT INTO spaces (name, type, status, price, tenant_id) VALUES ('TZ-1', 'parking', 'available', 1000, 1)").run();
  await db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time, paid_at, amount, payment_method, tenant_id)
    VALUES ('TZNOCHE', ?, 'paid', '2026-11-13 23:00:00', '2026-11-14 01:30:00', 1500, 'cash', 1)
  `).run(space.lastInsertRowid);

  const list = async (date: string) => {
    const res = await call(admin, `/api/visitors/payments?plate=TZNOCHE&date=${date}`);
    assert.equal(res.status, 200);
    return (await res.json()) as Array<{ plate: string }>;
  };
  assert.equal((await list("2026-11-13")).length, 1, "se pago el 13 a las 22:30 de Santiago");
  assert.equal((await list("2026-11-14")).length, 0, "no es del 14");
});
