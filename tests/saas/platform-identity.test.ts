import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

/**
 * Administrador de PLATAFORMA (Parkia) y administrador de EMPRESA (cliente) son cosas distintas.
 * La identidad de plataforma es un correo de PARKIA_PLATFORM_ADMINS: un cliente no puede apropiarse de él
 * ni intervenir a quien lo tiene.
 */
let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let platform = ""; // admin@parkia.local: administrador de plataforma
let client = ""; // administrador de la empresa, sin poderes de plataforma
let platformStaffId = 0;
let clientStaffId = 0;

const json = { "Content-Type": "application/json" };
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(`${harness.baseUrl}${path}`, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const CLIENT_EMAIL = "admin.cliente@empresa.cl";
const CLIENT_PASSWORD = "ClaveCliente2026!";

before(async () => {
  harness = await createSaasTestServer({ platformAdmins: "admin@parkia.local, reservado@parkia.cl" });
  ({ db } = await import("../../server/db"));
  platform = await harness.loginAs("admin@parkia.local", "admin123");
  const created = await call(platform, "POST", "/api/staff", { name: "Admin Cliente", rut: "72.111.111-1", email: CLIENT_EMAIL, phone: "", role: "admin", password: "Cambiar123!" });
  assert.equal(created.status, 200);
  const first = await harness.loginAs(CLIENT_EMAIL, "Cambiar123!");
  assert.equal((await call(first, "POST", "/api/auth/change-password", { current_password: "Cambiar123!", new_password: CLIENT_PASSWORD })).status, 200);
  client = await harness.loginAs(CLIENT_EMAIL, CLIENT_PASSWORD);
  platformStaffId = (await db.prepare("SELECT id FROM staff WHERE email = 'admin@parkia.local'").get() as { id: number }).id;
  clientStaffId = (await db.prepare("SELECT id FROM staff WHERE email = ?").get(CLIENT_EMAIL) as { id: number }).id;
});
after(async () => { await harness.close(); });

test("el administrador de una empresa no es administrador de plataforma", async () => {
  const me = (await (await call(client, "GET", "/api/auth/me")).json()) as { is_platform_admin: boolean; user: { role: string } };
  assert.equal(me.user.role, "admin");
  assert.equal(me.is_platform_admin, false);
  assert.equal(((await (await call(platform, "GET", "/api/auth/me")).json()) as { is_platform_admin: boolean }).is_platform_admin, true);

  for (const [method, path, body] of [
    ["GET", "/api/platform/tenants", undefined],
    ["PATCH", "/api/platform/tenants/1/status", { status: "suspended" }],
    ["POST", "/api/platform/impersonate", { tenant_id: 1, reason: "quiero entrar", minutes: 30 }],
    ["POST", "/api/platform/tenants/1/charge", {}],
    ["POST", "/api/platform/uf", { rate_date: "2026-11-13", value_clp: 39000, source: "cliente" }],
    ["GET", "/api/backups/database", undefined],
    ["POST", "/api/contracts/reajuste/ipc", { period: "2026-11", variation_pct: 5, source: "cliente" }],
  ] as const) {
    assert.equal((await call(client, method, path, body)).status, 403, `${method} ${path}`);
  }
});

test("un cliente no puede crear ni asignarse un correo reservado para la administración de Parkia", async () => {
  const create = await call(client, "POST", "/api/staff", { name: "Impostor", rut: "72.222.222-2", email: "reservado@parkia.cl", phone: "", role: "admin", password: "Cambiar123!" });
  assert.equal(create.status, 400);
  assert.match(((await create.json()) as { error: string }).error, /reservado/);
  // Tampoco con mayúsculas o espacios.
  assert.equal((await call(client, "POST", "/api/staff", { name: "Impostor", rut: "72.222.222-2", email: " Reservado@Parkia.CL ", phone: "", role: "admin", password: "Cambiar123!" })).status, 400);

  const rename = await call(client, "PATCH", `/api/staff/${clientStaffId}`, { name: "Admin Cliente", rut: "72.111.111-1", email: "reservado@parkia.cl", phone: "", role: "admin", reason: "cambio de correo" });
  assert.equal(rename.status, 403);
  assert.equal(((await rename.json()) as { code: string }).code, "PLATFORM_IDENTITY_PROTECTED");
  assert.equal(await db.prepare("SELECT 1 AS x FROM staff WHERE LOWER(email) = 'reservado@parkia.cl'").get(), undefined);
});

test("un cliente no puede cambiar la clave, los datos ni el estado de un administrador de Parkia", async () => {
  const before = await db.prepare("SELECT email, status, password_hash FROM staff WHERE id = ?").get(platformStaffId) as Record<string, unknown>;

  const reset = await call(client, "POST", `/api/staff/${platformStaffId}/password`, { password: "TomoElControl2026!", reason: "intento de toma de control" });
  assert.equal(reset.status, 403);
  assert.equal(((await reset.json()) as { code: string }).code, "PLATFORM_IDENTITY_PROTECTED");
  assert.equal((await call(client, "PATCH", `/api/staff/${platformStaffId}`, { name: "Otro", rut: "11.111.111-1", email: "otro@empresa.cl", phone: "", role: "guard", reason: "lo modifico" })).status, 403);
  assert.equal((await call(client, "PATCH", `/api/staff/${platformStaffId}/status`, { status: "inactive", reason: "lo desactivo" })).status, 403);

  assert.deepEqual(await db.prepare("SELECT email, status, password_hash FROM staff WHERE id = ?").get(platformStaffId), before, "nada cambió");
  // La clave original sigue funcionando.
  await harness.loginAs("admin@parkia.local", "admin123");
});

test("un administrador de plataforma sí puede gestionar esas cuentas", async () => {
  const create = await call(platform, "POST", "/api/staff", { name: "Segundo Parkia", rut: "72.333.333-3", email: "reservado@parkia.cl", phone: "", role: "admin", password: "Cambiar123!" });
  assert.equal(create.status, 200);
  const id = (await db.prepare("SELECT id FROM staff WHERE email = 'reservado@parkia.cl'").get() as { id: number }).id;
  assert.equal((await call(platform, "POST", `/api/staff/${id}/password`, { password: "NuevaClave2026!", reason: "soporte interno" })).status, 200);
  // Y el cliente sigue sin poder tocarla.
  assert.equal((await call(client, "POST", `/api/staff/${id}/password`, { password: "OtraClave2026!", reason: "no corresponde" })).status, 403);
});

test("el registro público no crea cuentas con un correo reservado", async () => {
  const previous = process.env.PARKIA_PLATFORM_ADMINS;
  process.env.PARKIA_PLATFORM_ADMINS = `${previous}, futuro.admin@parkia.cl`;
  try {
    const res = await fetch(`${harness.baseUrl}/api/public/signup`, {
      method: "POST", headers: json,
      body: JSON.stringify({ company_name: "Empresa Falsa SpA", company_rut: "76.555.444-3", name: "Alguien", email: "futuro.admin@parkia.cl", password: "ClaveSegura2026!", accept_terms: true }),
    });
    // Responde igual que siempre (no revela nada), pero no crea la cuenta.
    assert.ok(res.status === 200 || res.status === 400, `status ${res.status}`);
    assert.equal(await db.prepare("SELECT 1 AS x FROM staff WHERE email = 'futuro.admin@parkia.cl'").get(), undefined);
  } finally {
    process.env.PARKIA_PLATFORM_ADMINS = previous;
  }
});

test("un correo de plataforma sin verificar no da poderes de plataforma", async () => {
  await db.prepare("UPDATE staff SET email_verified = 0 WHERE id = ?").run(platformStaffId);
  try {
    assert.equal((await call(platform, "GET", "/api/platform/tenants")).status, 403);
  } finally {
    await db.prepare("UPDATE staff SET email_verified = 1 WHERE id = ?").run(platformStaffId);
  }
  assert.equal((await call(platform, "GET", "/api/platform/tenants")).status, 200);
});

test("con la exigencia activa, las acciones de plataforma piden verificación en dos pasos", async () => {
  const previous = process.env.PARKIA_PLATFORM_REQUIRE_2FA;
  process.env.PARKIA_PLATFORM_REQUIRE_2FA = "true";
  try {
    const denied = await call(platform, "GET", "/api/platform/tenants");
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { code: string }).code, "PLATFORM_2FA_REQUIRED");
    await db.prepare("UPDATE staff SET totp_enabled = 1 WHERE id = ?").run(platformStaffId);
    assert.equal((await call(platform, "GET", "/api/platform/tenants")).status, 200);
  } finally {
    await db.prepare("UPDATE staff SET totp_enabled = 0 WHERE id = ?").run(platformStaffId);
    if (previous === undefined) delete process.env.PARKIA_PLATFORM_REQUIRE_2FA; else process.env.PARKIA_PLATFORM_REQUIRE_2FA = previous;
  }
});
