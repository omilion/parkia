import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let admin = "";

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  admin = await harness.loginAs("admin@parkia.local", "admin123");
});
after(async () => { await harness.close(); });

const putIpc = (period: string, variation_pct: number) =>
  fetch(`${harness.baseUrl}/api/contracts/reajuste/ipc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ period, variation_pct, source: "prueba" }),
  });

test("el IPC es un dato de la plataforma: el administrador de una empresa no puede cargarlo, pero si leerlo", async () => {
  const previous = process.env.PARKIA_PLATFORM_ADMINS;
  try {
    // El mismo usuario deja de ser administrador de plataforma: es "solo" admin de su empresa.
    process.env.PARKIA_PLATFORM_ADMINS = "otra.persona@parkia.cl";
    const denied = await putIpc("2026-10", 40);
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { code: string }).code, "PLATFORM_ADMIN_REQUIRED");
    assert.equal(await db.prepare("SELECT 1 AS x FROM ipc_rates WHERE period = '2026-10'").get(), undefined, "no se guardo nada");
    assert.equal((await fetch(`${harness.baseUrl}/api/contracts/reajuste/ipc`, { headers: { cookie: admin } })).status, 200, "leer si puede");
  } finally {
    process.env.PARKIA_PLATFORM_ADMINS = previous;
  }
  assert.equal((await putIpc("2026-10", 0.4)).status, 201, "el administrador de plataforma si");
});

test("una variacion mensual absurda se rechaza (error de digitacion)", async () => {
  for (const value of [50, 11, -6, 1000]) assert.equal((await putIpc("2026-09", value)).status, 400, String(value));
  assert.equal((await putIpc("2026-09", -0.3)).status, 201);
  assert.equal((await putIpc("2026-09", 1.5)).status, 201);
});
