import assert from "node:assert/strict";
import { after, test } from "node:test";
import { startTestServer } from "../support/apiHarness";

const harness = await startTestServer();
const { db } = harness;
const { cronMatches, lastScheduledSlot, parseCron } = await import("../../server/platform/jobs/cron");
const jobs = await import("../../server/platform/jobs");
after(async () => { await harness.close(); });

const TZ = "America/Santiago";

test("cron: reconoce horas en America/Santiago (verano UTC-3, invierno UTC-4)", () => {
  const daily3 = parseCron("0 3 * * *");
  assert.equal(cronMatches(daily3, new Date("2026-11-13T06:00:00Z"), TZ), true, "03:00 de verano = 06:00Z");
  assert.equal(cronMatches(daily3, new Date("2026-11-13T03:00:00Z"), TZ), false);
  assert.equal(cronMatches(daily3, new Date("2026-07-15T07:00:00Z"), TZ), true, "03:00 de invierno = 07:00Z");
  assert.equal(cronMatches(daily3, new Date("2026-07-15T06:00:00Z"), TZ), false);
  assert.equal(cronMatches(daily3, new Date("2026-11-13T06:01:00Z"), TZ), false);
});

test("cron: pasos, listas, rangos y día de la semana", () => {
  const every15 = parseCron("*/15 * * * *");
  for (const minute of [0, 15, 30, 45]) assert.equal(cronMatches(every15, new Date(Date.UTC(2026, 10, 13, 12, minute)), TZ), true);
  assert.equal(cronMatches(every15, new Date(Date.UTC(2026, 10, 13, 12, 14)), TZ), false);

  const list = parseCron("5,35 8-10 * * *");
  assert.equal(cronMatches(list, new Date("2026-11-13T12:35:00Z"), TZ), true, "09:35 local");
  assert.equal(cronMatches(list, new Date("2026-11-13T12:20:00Z"), TZ), false);
  assert.equal(cronMatches(list, new Date("2026-11-13T14:05:00Z"), TZ), false, "11:05 local queda fuera del rango");

  // 2026-11-13 es viernes (5); 7 también significa domingo.
  assert.equal(cronMatches(parseCron("0 12 * * 5"), new Date("2026-11-13T15:00:00Z"), TZ), true);
  assert.equal(cronMatches(parseCron("0 12 * * 1-4"), new Date("2026-11-13T15:00:00Z"), TZ), false);
  assert.equal(cronMatches(parseCron("0 12 * * 7"), new Date("2026-11-15T15:00:00Z"), TZ), true);
  // Con día del mes y de la semana fijos basta que se cumpla uno (como cron).
  assert.equal(cronMatches(parseCron("0 12 13 * 1"), new Date("2026-11-13T15:00:00Z"), TZ), true);
});

test("cron: expresiones inválidas se rechazan", () => {
  for (const bad of ["", "* * * *", "61 * * * *", "* 24 * * *", "*/0 * * * *", "a * * * *", "5-2 * * * *", "* * 0 * *"]) {
    assert.throws(() => parseCron(bad), /Cron invalido/, bad);
  }
});

test("lastScheduledSlot: la última ejecución que ya debió ocurrir, para recuperar lo perdido", () => {
  // 10:07 locales (13:07Z): la diaria de las 03:00 quedó atrás y la de cada 15 min fue a las 10:00.
  const now = new Date("2026-11-13T13:07:30Z");
  assert.equal(lastScheduledSlot(parseCron("0 3 * * *"), now, 26 * 60, TZ), "2026-11-13T06:00:00.000Z");
  assert.equal(lastScheduledSlot(parseCron("*/15 * * * *"), now, 26 * 60, TZ), "2026-11-13T13:00:00.000Z");
  assert.equal(lastScheduledSlot(parseCron("15 8 * * *"), now, 26 * 60, TZ), "2026-11-13T11:15:00.000Z");
  // Justo a la hora programada, esa misma es la última.
  assert.equal(lastScheduledSlot(parseCron("0 3 * * *"), new Date("2026-11-13T06:00:10Z"), 60, TZ), "2026-11-13T06:00:00.000Z");
  // Fuera de la ventana de recuperación no hay nada que recuperar.
  assert.equal(lastScheduledSlot(parseCron("0 3 * * *"), new Date("2026-11-13T20:00:00Z"), 60, TZ), null);
});

test("todos los jobs definidos tienen un cron válido", () => {
  for (const [name, definition] of Object.entries(jobs.JOB_DEFINITIONS)) {
    assert.doesNotThrow(() => parseCron(definition.cron), name);
  }
});

/** Cambia los manejadores por contadores (los reales tocan el SII, la UF por internet, etc.). */
function stubHandlers(overrides: Partial<Record<keyof typeof jobs.JOB_DEFINITIONS, () => Promise<Record<string, unknown>>>> = {}) {
  const calls: Record<string, number> = {};
  const originals = new Map<string, () => unknown>();
  for (const [name, definition] of Object.entries(jobs.JOB_DEFINITIONS)) {
    originals.set(name, definition.handler);
    definition.handler = overrides[name as keyof typeof overrides] ?? (async () => { calls[name] = (calls[name] ?? 0) + 1; return { ok: true }; });
  }
  return {
    calls,
    restore() { for (const [name, handler] of originals) (jobs.JOB_DEFINITIONS as any)[name].handler = handler; },
  };
}

test("una ejecución programada se reclama una sola vez, incluso en paralelo", async () => {
  const stub = stubHandlers();
  try {
    const slot = "2030-01-01T06:00:00.000Z";
    const outcomes = await Promise.all([
      jobs.claimAndRunJob("receivables.generate", slot),
      jobs.claimAndRunJob("receivables.generate", slot),
      jobs.claimAndRunJob("receivables.generate", slot),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.ran).length, 1);
    assert.equal(stub.calls["receivables.generate"], 1);
    const row = await db.prepare("SELECT status, duration_ms, result_json FROM job_runs WHERE job_name = ? AND slot = ?").get("receivables.generate", slot) as any;
    assert.equal(row.status, "ok");
    assert.equal(row.result_json, JSON.stringify({ ok: true }));
    // Otra hora programada del mismo job sí corre.
    assert.equal((await jobs.claimAndRunJob("receivables.generate", "2030-01-02T06:00:00.000Z")).ran, true);
  } finally { stub.restore(); }
});

test("runDueJobs corre lo que toca una vez y un job que falla no detiene a los demás", async () => {
  const stub = stubHandlers({ "uf.sync": async () => { throw new Error("mindicador caido"); } });
  try {
    const now = new Date("2031-03-05T13:07:30Z"); // 10:07 locales
    const first = await jobs.runDueJobs(now);
    const byJob = Object.fromEntries(first.map(outcome => [outcome.job, outcome]));
    assert.equal(first.length, Object.keys(jobs.JOB_DEFINITIONS).length, "al arrancar se recupera cada job pendiente");
    assert.equal(byJob["uf.sync"].status, "error");
    assert.match(byJob["uf.sync"].error ?? "", /mindicador/);
    assert.equal(byJob["sessions.cleanup"].status, "ok");
    assert.equal(stub.calls["dte.send-pending"], 1);

    // La misma vuelta otra vez (o 30 s después) no repite nada.
    assert.deepEqual(await jobs.runDueJobs(now), []);
    assert.deepEqual(await jobs.runDueJobs(new Date(now.getTime() + 30_000)), []);

    // Quince minutos después toca la siguiente de los jobs de cada 15 min, pero no las diarias.
    const later = await jobs.runDueJobs(new Date("2031-03-05T13:15:10Z"));
    const names = later.map(outcome => outcome.job).sort();
    assert.deepEqual(names, ["dte.poll-status", "dte.send-pending", "mail.send-pending", "payments.reconcile"]);

    const failed = await db.prepare("SELECT status, error FROM job_runs WHERE job_name = 'uf.sync' AND status = 'error'").get() as any;
    assert.match(failed.error, /mindicador/);
    const status = await jobs.getJobsStatus();
    assert.ok(status.find(row => row.job_name === "uf.sync" && row.status === "error"));

    const health = await jobs.getSchedulerHealth();
    assert.ok(health.minutesIdle !== null && health.minutesIdle <= 1, `minutesIdle=${health.minutesIdle}`);
    assert.deepEqual(health.failedJobs, ["uf.sync"]);
    assert.equal((await jobs.getSchedulerHealth(Date.now() + 3 * 3600_000)).minutesIdle! >= 180, true);
  } finally { stub.restore(); }
});

test("una tarea colgada se da por fallida al agotar su tiempo y no bloquea a las demás", async () => {
  const never = () => new Promise<Record<string, unknown>>(() => undefined); // p. ej. una API externa que no responde
  const stub = stubHandlers({ "uf.sync": never });
  const definition = jobs.JOB_DEFINITIONS["uf.sync"];
  definition.timeoutMs = 50;
  try {
    const startedAt = Date.now();
    const outcomes = await jobs.runDueJobs(new Date("2032-03-05T13:07:30Z"));
    assert.ok(Date.now() - startedAt < 3000, "la vuelta termina aunque una tarea no responda");
    const byJob = Object.fromEntries(outcomes.map(outcome => [outcome.job, outcome]));
    assert.equal(byJob["uf.sync"].status, "error");
    assert.match(byJob["uf.sync"].error ?? "", /Tiempo agotado/);
    assert.equal(byJob["mail.send-pending"].status, "ok", "las demás sí corrieron");
    assert.equal(byJob["dte.send-pending"].status, "ok");
    const row = await db.prepare("SELECT status, error FROM job_runs WHERE job_name = 'uf.sync' AND slot = ?").get(byJob["uf.sync"].slot) as any;
    assert.equal(row.status, "error");
    assert.match(row.error, /Tiempo agotado/);
  } finally { delete definition.timeoutMs; stub.restore(); }
});

test("una ejecución que quedó 'running' tras una caída se marca como fallida; las recientes no se tocan", async () => {
  await db.prepare("INSERT INTO job_runs (job_name, slot, status, started_at) VALUES ('huerfana.job', 'h1', 'running', datetime('now', '-2 hours'))").run();
  await db.prepare("INSERT INTO job_runs (job_name, slot, status, started_at) VALUES ('reciente.job', 'h2', 'running', datetime('now', '-1 minutes'))").run();
  assert.ok(await jobs.failStaleJobRuns() >= 1);
  const stale = await db.prepare("SELECT status, error FROM job_runs WHERE job_name = 'huerfana.job'").get() as any;
  assert.equal(stale.status, "error");
  assert.match(stale.error, /Interrumpida/);
  assert.equal((await db.prepare("SELECT status FROM job_runs WHERE job_name = 'reciente.job'").get() as any).status, "running");
});

test("el historial de ejecuciones se poda a los 30 días", async () => {
  await db.prepare("INSERT INTO job_runs (job_name, slot, status, started_at) VALUES ('old.job', 'a', 'ok', datetime('now', '-45 days'))").run();
  await db.prepare("INSERT INTO job_runs (job_name, slot, status, started_at) VALUES ('new.job', 'b', 'ok', datetime('now', '-2 days'))").run();
  assert.ok(await jobs.pruneJobRuns() >= 1);
  assert.equal(await db.prepare("SELECT 1 AS x FROM job_runs WHERE job_name = 'old.job'").get(), undefined);
  assert.ok(await db.prepare("SELECT 1 AS x FROM job_runs WHERE job_name = 'new.job'").get());
});
