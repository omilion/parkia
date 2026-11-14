import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";
import { addOneMonth, daysBetween, isPeriodDue, isUfUsable, nextBillingPeriod } from "../../server/modules/saas/billingPeriod";
import { addCalendarDays, todayLocal } from "../../shared/dates";

/**
 * El cobro de la suscripción lo hace Parkia (plataforma) a sus clientes: nunca el cliente a sí mismo.
 * En estas pruebas `admin@parkia.local` es administrador de plataforma; para actuar como "solo administrador de una
 * empresa cliente" se le quita temporalmente de PARKIA_PLATFORM_ADMINS.
 */
let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let billing: typeof import("../../server/modules/saas/billing");
let oneclick: typeof import("../../server/modules/saas/oneclick");
let uf: typeof import("../../server/modules/saas/uf");
let cookie = "";

const TENANT = 1;
const today = todayLocal();
const json = { "Content-Type": "application/json" };
const post = (path: string, body: unknown = {}) => fetch(`${harness.baseUrl}${path}`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify(body) });
const asClientAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.PARKIA_PLATFORM_ADMINS;
  process.env.PARKIA_PLATFORM_ADMINS = "dueno@parkia.cl";
  try { return await fn(); } finally { process.env.PARKIA_PLATFORM_ADMINS = previous; }
};
const subscription = async () => await db.prepare("SELECT status, current_period_start, current_period_end FROM subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1").get(TENANT) as { status: string; current_period_start: string; current_period_end: string };
const invoices = async () => await db.prepare("SELECT status, amount_clp, period_start, period_end, buy_order, authorization_code FROM subscription_invoices WHERE tenant_id = ? ORDER BY id ASC").all(TENANT) as Array<{ status: string; amount_clp: number; period_start: string; period_end: string; buy_order: string; authorization_code: string | null }>;
const setPeriodEnd = async (date: string, status = "active") => { await db.prepare("UPDATE subscriptions SET current_period_end = ?, status = ?, grace_until = NULL, suspended_at = NULL WHERE tenant_id = ?").run(date, status, TENANT); };
const day = (value: unknown) => String(value).slice(0, 10);

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  billing = await import("../../server/modules/saas/billing");
  oneclick = await import("../../server/modules/saas/oneclick");
  uf = await import("../../server/modules/saas/uf");
  cookie = await harness.loginAs("admin@parkia.local", "admin123");
  // Plan de 2,00 UF: con UF a $38.500 son $77.000.
  await db.prepare("UPDATE plans SET price_uf_centis = 200 WHERE id = (SELECT plan_id FROM subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1)").run(TENANT);
});
after(async () => { await harness.close(); });

test("reglas del período: continuidad, gracia, fin de mes y UF utilizable", () => {
  assert.equal(addOneMonth("2026-11-13"), "2026-12-13");
  assert.equal(addOneMonth("2026-01-31"), "2026-02-28", "enero 31 -> último día de febrero, no 3 de marzo");
  assert.equal(addOneMonth("2028-01-31"), "2028-02-29");
  assert.equal(addOneMonth("2026-12-15"), "2027-01-15");
  assert.equal(daysBetween("2026-11-10", "2026-11-13"), 3);

  // Se paga el último día o unos días tarde: el período nuevo empieza donde terminó el anterior.
  assert.deepEqual(nextBillingPeriod("2026-11-13", "2026-11-13"), { start: "2026-11-13", end: "2026-12-13" });
  assert.deepEqual(nextBillingPeriod("2026-11-13", "2026-11-18"), { start: "2026-11-13", end: "2026-12-13" });
  // Se paga por adelantado: no se pierden los días ya pagados.
  assert.deepEqual(nextBillingPeriod("2026-11-20", "2026-11-13"), { start: "2026-11-20", end: "2026-12-20" });
  // Estuvo semanas sin pagar (suspendida): el período nuevo empieza hoy.
  assert.deepEqual(nextBillingPeriod("2026-10-01", "2026-11-13"), { start: "2026-11-13", end: "2026-12-13" });
  assert.deepEqual(nextBillingPeriod(null, "2026-11-13"), { start: "2026-11-13", end: "2026-12-13" });

  assert.equal(isPeriodDue("2026-11-13", "2026-11-13"), true, "el último día ya corresponde cobrar");
  assert.equal(isPeriodDue("2026-11-14", "2026-11-13"), false);
  assert.equal(isPeriodDue("2026-11-18", "2026-11-13", 7), true, "a mano se puede cobrar unos días antes");
  assert.equal(isPeriodDue("2026-12-13", "2026-11-13", 7), false);

  assert.equal(isUfUsable({ rate_date: "2026-11-13", source: "mindicador.cl" }, "2026-11-13"), true);
  assert.equal(isUfUsable({ rate_date: "2026-11-13", source: "fallback_env" }, "2026-11-13"), false, "una UF inventada no sirve para cobrar");
  assert.equal(isUfUsable({ rate_date: "2026-10-20", source: "mindicador.cl" }, "2026-11-13"), false, "ni una de hace semanas");
});

test("la UF diaria se sincroniza y usa el último valor conocido", async () => {
  const synced = await uf.syncUfFromProvider(async () => new Response(JSON.stringify({ serie: [{ fecha: "2026-11-10T03:00:00.000Z", valor: 38250.5 }] }), { status: 200, headers: json }));
  assert.deepEqual([synced.rate_date, synced.value_clp], ["2026-11-10", 38250.5]);
  const prior = await uf.getUfRate("2026-11-12");
  assert.deepEqual([prior.rate_date, prior.value_clp, prior.exact], ["2026-11-10", 38250.5, false]);
});

test("el cliente no puede cobrarse, registrar pagos ni fijar la UF; eso es de Parkia", async () => {
  // Las rutas antiguas del cliente ya no existen.
  assert.equal((await post("/api/billing/charge-subscription", {})).status, 404);
  assert.equal((await post("/api/billing/uf", { rate_date: today, value_clp: 1, source: "x" })).status, 404);

  await asClientAdmin(async () => {
    for (const [path, body] of [
      ["/api/platform/uf", { rate_date: today, value_clp: 30000, source: "cliente" }],
      [`/api/platform/tenants/${TENANT}/charge`, {}],
      [`/api/platform/tenants/${TENANT}/manual-payment`, { reference: "TRF-FALSA" }],
    ] as const) {
      const res = await post(path, body);
      assert.equal(res.status, 403, path);
      assert.equal(((await res.json()) as { code: string }).code, "PLATFORM_ADMIN_REQUIRED");
    }
    assert.equal((await fetch(`${harness.baseUrl}/api/platform/billing/status`, { headers: { cookie } })).status, 403);
    // Su propia suscripción sí la puede ver.
    assert.equal((await fetch(`${harness.baseUrl}/api/billing/subscription`, { headers: { cookie } })).status, 200);
  });
  assert.equal(await db.prepare("SELECT 1 AS x FROM uf_rates WHERE source = 'cliente'").get(), undefined);
  assert.deepEqual(await invoices(), []);
});

test("Parkia fija la UF (con un rango razonable) y el cliente inscribe su tarjeta", async () => {
  assert.equal((await post("/api/platform/uf", { rate_date: today, value_clp: 5, source: "manual" })).status, 400, "una UF de $5 es un error de digitación");
  assert.equal((await post("/api/platform/uf", { rate_date: today, value_clp: 38500, source: "manual" })).status, 201);

  const enroll = await post("/api/billing/oneclick/enroll", { email: "finanzas@parkia.local", response_url: "https://sitio-ajeno.example/volver" });
  assert.equal(enroll.status, 201);
  const started = (await enroll.json()) as { token: string; url_webpay: string };
  assert.ok(!started.url_webpay.includes("sitio-ajeno.example"), "la vuelta desde la pasarela siempre es a Parkia");
  const finish = await post("/api/billing/oneclick/finish", { token: started.token });
  assert.equal(finish.status, 200);
  assert.equal(((await finish.json()) as { card_last4: string }).card_last4, "6623");

  const summary = (await (await fetch(`${harness.baseUrl}/api/billing/subscription`, { headers: { cookie } })).json()) as any;
  assert.equal(summary.oneclick.card_last4, "6623");
  assert.equal(summary.estimated_amount_clp, 77000);
  assert.equal(summary.uf_rate.usable, true);
  assert.equal(summary.oneclick_available, true);
  assert.equal(summary.oneclick_simulated, true);
  assert.ok(summary.next_charge.date);
});

test("el administrador de plataforma cobra un período que ya corresponde, una sola vez, y queda auditado", async () => {
  await setPeriodEnd(today);
  const res = await post(`/api/platform/tenants/${TENANT}/charge`);
  assert.equal(res.status, 200);
  const charged = (await res.json()) as any;
  assert.equal(charged.approved, true);
  assert.equal(charged.amount_clp, 77000);
  assert.equal(charged.amount_uf_centis, 200);
  assert.deepEqual([charged.period_start, charged.period_end], [today, addOneMonth(today)]);
  assert.match(charged.buy_order, new RegExp(`^SUB-${TENANT}-${today.replace(/-/g, "")}-1$`));

  const sub = await subscription();
  assert.deepEqual([sub.status, day(sub.current_period_start), day(sub.current_period_end)], ["active", today, addOneMonth(today)]);

  // Un segundo clic no cobra otro mes: el período vigente recién empezó.
  const again = await post(`/api/platform/tenants/${TENANT}/charge`);
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { code: string }).code, "NOT_DUE");
  assert.deepEqual((await invoices()).map(row => row.status), ["paid"]);

  const audit = await db.prepare("SELECT metadata FROM audit_events WHERE tenant_id = ? AND action = 'platform.subscription_charge' ORDER BY id ASC").all(TENANT) as Array<{ metadata: string }>;
  assert.equal(audit.length, 2, "los dos intentos quedan en la bitácora de la empresa");
  assert.equal(JSON.parse(String(audit[0].metadata)).amount_clp, 77000);
});

test("cobro automático: cobra a quien se le terminó el período, sin perder ni regalar días", async () => {
  const end = day((await subscription()).current_period_end);
  await uf.upsertUfRate(end, 39000, "prueba");
  // Un día antes no toca.
  const early = await billing.runSubscriptionChargeJob(new Date(`${addCalendarDays(end, -1)}T15:00:00Z`));
  assert.deepEqual([early.due, early.charged], [0, 0]);

  const run = await billing.runSubscriptionChargeJob(new Date(`${end}T15:00:00Z`));
  assert.deepEqual([run.due, run.charged, run.rejected, run.skipped], [1, 1, 0, 0]);
  const sub = await subscription();
  assert.deepEqual([day(sub.current_period_start), day(sub.current_period_end)], [end, addOneMonth(end)], "el nuevo período empieza donde terminó el anterior");
  const rows = await invoices();
  assert.equal(rows.at(-1)!.amount_clp, 78000, "2,00 UF con la UF de ese día ($39.000)");

  // Repetir el job el mismo día no cobra de nuevo.
  const repeat = await billing.runSubscriptionChargeJob(new Date(`${end}T20:00:00Z`));
  assert.deepEqual([repeat.due, repeat.charged], [0, 0]);
  assert.equal((await invoices()).filter(row => row.status === "paid").length, 2);
});

test("un rechazo no renueva; el job reintenta al día siguiente y el pago atrasado mantiene la continuidad", async () => {
  const end = day((await subscription()).current_period_end);
  const at = (offset: number, hour = 15) => new Date(`${addCalendarDays(end, offset)}T${String(hour).padStart(2, "0")}:00:00Z`);
  for (const offset of [0, 1, 2]) await uf.upsertUfRate(addCalendarDays(end, offset), 39000, "prueba");

  const rejected = await billing.chargeTenantSubscription(TENANT, { trigger: "job", simulateRejected: true, now: at(0) });
  assert.equal(rejected.approved, false);
  assert.equal((rejected as { code: string }).code, "REJECTED");
  assert.equal(day((await subscription()).current_period_end), end, "no se renovó");
  assert.equal((await invoices()).at(-1)!.status, "failed");

  // Mismo día: el job no insiste (y el intento fallido no bloquea un cobro manual de la plataforma).
  // parkia_local_date(created_at) usa la hora real de creación; por eso el "mismo día" aquí es hoy.
  const sameDay = await billing.chargeTenantSubscription(TENANT, { trigger: "job", now: new Date() });
  if (end === today) assert.equal((sameDay as { code: string }).code, "ALREADY_ATTEMPTED_TODAY");

  // Dos días después paga: el período corre desde donde terminó, no desde el día del pago.
  const late = await billing.chargeTenantSubscription(TENANT, { trigger: "job", now: at(2) });
  assert.equal(late.approved, true);
  const sub = await subscription();
  assert.deepEqual([sub.status, day(sub.current_period_start), day(sub.current_period_end)], ["active", end, addOneMonth(end)]);
  const last = (await invoices()).at(-1)!;
  assert.match(last.buy_order, /-2$/, "segundo intento del mismo período");
});

test("sin una UF real no se cobra a nadie", async () => {
  const end = day((await subscription()).current_period_end);
  const saved = await db.prepare("SELECT rate_date, value_clp, source FROM uf_rates").all() as Array<{ rate_date: string; value_clp: number; source: string }>;
  await db.prepare("DELETE FROM uf_rates").run();
  try {
    const before = (await invoices()).length;
    const result = await billing.chargeTenantSubscription(TENANT, { trigger: "job", now: new Date(`${end}T15:00:00Z`) });
    assert.equal((result as { code: string }).code, "UF_UNAVAILABLE");
    assert.equal((await invoices()).length, before, "ni siquiera se registra un intento");
    const run = await billing.runSubscriptionChargeJob(new Date(`${end}T15:00:00Z`));
    assert.deepEqual([run.due, run.charged, run.reasons.UF_UNAVAILABLE], [1, 0, 1]);
  } finally {
    for (const row of saved) await uf.upsertUfRate(day(row.rate_date), Number(row.value_clp), row.source);
  }
});

test("en producción la pasarela simulada no aprueba nada: ni inscripción, ni cobro, ni job", async () => {
  const end = day((await subscription()).current_period_end);
  await uf.upsertUfRate(end, 39000, "prueba");
  const previousEnv = process.env.NODE_ENV;
  const previousFlag = process.env.PARKIA_ALLOW_MOCK_PAYMENTS;
  process.env.NODE_ENV = "production";
  delete process.env.PARKIA_ALLOW_MOCK_PAYMENTS;
  try {
    assert.deepEqual(oneclick.oneclickAvailability(), { available: false, simulated: true });
    await assert.rejects(() => oneclick.enrollOneclickForTenant(TENANT, "x@empresa.cl", "https://app.parkia.cl/suscripcion"), (error: any) => error.code === "ONECLICK_NOT_AVAILABLE" && error.status === 503);
    const before = (await invoices()).length;
    const result = await billing.chargeTenantSubscription(TENANT, { trigger: "platform", now: new Date(`${end}T15:00:00Z`) });
    assert.equal((result as { code: string }).code, "ONECLICK_NOT_AVAILABLE");
    const run = await billing.runSubscriptionChargeJob(new Date(`${end}T15:00:00Z`));
    assert.deepEqual([run.due, run.charged, run.skipped, run.reasons.ONECLICK_NOT_AVAILABLE], [1, 0, 1, 1]);
    assert.equal((await invoices()).length, before);
    assert.equal(day((await subscription()).current_period_end), end, "nadie quedó renovado gratis");

    // Con la llave explícita (ambiente de demostración) sí.
    process.env.PARKIA_ALLOW_MOCK_PAYMENTS = "true";
    assert.equal(oneclick.oneclickAvailability().available, true);
  } finally {
    process.env.NODE_ENV = previousEnv;
    if (previousFlag === undefined) delete process.env.PARKIA_ALLOW_MOCK_PAYMENTS; else process.env.PARKIA_ALLOW_MOCK_PAYMENTS = previousFlag;
  }
});

test("pago por transferencia: lo registra Parkia, renueva el período y la referencia no se repite", async () => {
  const before = await subscription();
  const end = day(before.current_period_end);
  const res = await post(`/api/platform/tenants/${TENANT}/manual-payment`, { reference: "TRF 99-123", amount_clp: 80000, note: "Transferencia BancoEstado" });
  assert.equal(res.status, 201);
  const paid = (await res.json()) as any;
  assert.equal(paid.amount_clp, 80000);
  // El período vigente termina en el futuro: el pago lo extiende desde ahí.
  assert.deepEqual([paid.period_start, paid.period_end], [end, addOneMonth(end)]);
  assert.equal(day((await subscription()).current_period_end), addOneMonth(end));
  const last = (await invoices()).at(-1)!;
  assert.deepEqual([last.status, last.authorization_code], ["paid", "MANUAL:TRF 99-123"]);

  const duplicate = await post(`/api/platform/tenants/${TENANT}/manual-payment`, { reference: "TRF 99-123" });
  assert.equal(duplicate.status, 409);
  assert.equal(((await duplicate.json()) as { code: string }).code, "DUPLICATE_REFERENCE");
  assert.equal(day((await subscription()).current_period_end), addOneMonth(end), "no se renovó dos veces");

  assert.equal((await post(`/api/platform/tenants/${TENANT}/manual-payment`, { reference: "x" })).status, 400);
  assert.equal((await post("/api/platform/tenants/999999/manual-payment", { reference: "TRF-000" })).status, 404);
  const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ? AND action = 'platform.subscription_manual_payment'").get(TENANT) as { n: number | string };
  assert.equal(Number(audit.n), 1);
});

test("dos cobros simultáneos del mismo período cobran una sola vez", async () => {
  const end = day((await subscription()).current_period_end);
  await uf.upsertUfRate(end, 39000, "prueba");
  const now = new Date(`${end}T15:00:00Z`);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => billing.chargeTenantSubscription(TENANT, { trigger: "platform", now })));
  const paidForPeriod = (await invoices()).filter(row => row.status === "paid" && day(row.period_start) === end);
  assert.equal(paidForPeriod.length, 1, JSON.stringify(results.map(item => (item.status === "fulfilled" ? (item.value.approved ? "ok" : (item.value as any).code) : "error"))));
  assert.equal(day((await subscription()).current_period_end), addOneMonth(end));
});

test("el panel de plataforma muestra lo necesario para cobrar a cada empresa", async () => {
  const res = await fetch(`${harness.baseUrl}/api/platform/tenants`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const tenant = ((await res.json()) as { tenants: any[] }).tenants.find(item => item.id === TENANT);
  assert.equal(tenant.billing.card.last4, "6623");
  assert.equal(tenant.billing.last_invoice.status, "paid");
  assert.ok(tenant.billing.next_charge_date);
  const status = (await (await fetch(`${harness.baseUrl}/api/platform/billing/status`, { headers: { cookie } })).json()) as any;
  assert.deepEqual(status.oneclick, { available: true, simulated: true });
});
