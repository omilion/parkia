import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startTestServer } from "../support/apiHarness";

const harness = await startTestServer();
const { db, baseUrl } = harness;
const totp = await import("../../server/platform/auth/totp");
const { openTotpSecret, sealTotpSecret } = await import("../../server/platform/auth/totpSecret");

const EMAIL = "admin2fa@parkia.local";
const PASSWORD = "Cambiar123!Nueva1"; // el arnés cambia la clave inicial en el primer ingreso
let adminCookie = "";
let cookie = "";
let secret = "";
let recoveryCodes: string[] = [];
let staffId = 0;

const post = (path: string, body: unknown, session = cookie) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: session }, body: JSON.stringify(body) });
const loginWith = (totp_code?: string) =>
  fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, totp_code }) });
/** Un código del autenticador de `seconds` segundos en el futuro (cada intervalo solo sirve una vez). */
const codeAt = (seconds: number) => totp.generateTotpCode(secret, Date.now() + seconds * 1000);

before(async () => {
  adminCookie = await harness.login();
  cookie = await harness.createStaffAndLogin(adminCookie, "admin", EMAIL, "71.111.111-1");
  staffId = (await db.prepare("SELECT id FROM staff WHERE email = ?").get(EMAIL) as { id: number }).id;
});
after(async () => { await harness.close(); });

test("solo administradores configuran 2FA", async () => {
  const guard = await harness.createStaffAndLogin(adminCookie, "guard", "guard2fa@parkia.local", "71.222.222-2");
  assert.equal((await post("/api/auth/2fa/setup", {}, guard)).status, 403);
});

test("el secreto se guarda cifrado y se activa solo con un código válido; se entregan códigos de recuperación", async () => {
  const setup = await post("/api/auth/2fa/setup", {});
  assert.equal(setup.status, 200);
  secret = (await setup.json()).secret;

  const stored = (await db.prepare("SELECT totp_secret, totp_enabled FROM staff WHERE id = ?").get(staffId) as { totp_secret: string; totp_enabled: number });
  assert.ok(stored.totp_secret.startsWith("pk1:"), "el secreto no queda en texto plano");
  assert.ok(!stored.totp_secret.includes(secret));
  assert.equal(Number(stored.totp_enabled), 0);
  assert.equal(openTotpSecret(staffId, stored.totp_secret), secret);
  assert.throws(() => openTotpSecret(staffId + 1, stored.totp_secret), "el secreto está ligado a la persona");

  assert.equal((await post("/api/auth/2fa/enable", { code: "000000" })).status, 400);
  const enable = await post("/api/auth/2fa/enable", { code: codeAt(0) });
  assert.equal(enable.status, 200);
  const body = await enable.json();
  recoveryCodes = body.recovery_codes;
  assert.equal(recoveryCodes.length, 8);
  assert.ok(recoveryCodes.every(code => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(code)));
  assert.equal(new Set(recoveryCodes).size, 8);

  const row = await db.prepare("SELECT totp_recovery_codes FROM staff WHERE id = ?").get(staffId) as { totp_recovery_codes: string };
  for (const code of recoveryCodes) assert.ok(!row.totp_recovery_codes.includes(code.replace("-", "")), "solo se guardan hashes");
});

test("con 2FA activo no se puede reiniciar la configuración (una sesión robada no lo apaga)", async () => {
  const again = await post("/api/auth/2fa/setup", {});
  assert.equal(again.status, 409);
  const row = await db.prepare("SELECT totp_enabled FROM staff WHERE id = ?").get(staffId) as { totp_enabled: number };
  assert.equal(Number(row.totp_enabled), 1);
  assert.equal((await post("/api/auth/2fa/enable", { code: codeAt(60) })).status, 409);
});

test("el login pide el código y un código no se puede reutilizar", async () => {
  const missing = await loginWith();
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).totp_required, true);
  assert.equal((await loginWith("123456")).status, 401);

  // El código con que se activó ya se usó: ese intervalo no sirve para entrar.
  assert.equal((await loginWith(codeAt(0))).status, 401);

  const code = codeAt(30);
  assert.equal((await loginWith(code)).status, 200);
  assert.equal((await loginWith(code)).status, 401, "el mismo código dos veces");
  // Un intervalo anterior al último aceptado tampoco sirve.
  assert.equal((await loginWith(codeAt(-30))).status, 401);
});

test("un código de recuperación entra una sola vez, con o sin guion y en mayúsculas", async () => {
  const [first, second] = recoveryCodes;
  const ok = await loginWith(first.toUpperCase().replace("-", " "));
  assert.equal(ok.status, 200);
  assert.equal((await loginWith(first)).status, 401, "ya se usó");
  assert.equal((await loginWith("aaaaa-bbbbb")).status, 401, "uno inventado");
  assert.equal((await loginWith(second)).status, 200);

  const row = await db.prepare("SELECT totp_recovery_codes FROM staff WHERE id = ?").get(staffId) as { totp_recovery_codes: string };
  assert.equal(JSON.parse(row.totp_recovery_codes).length, 6);
  const events = await db.prepare("SELECT metadata FROM staff_access_events WHERE staff_id = ? AND event_type = 'login' AND metadata LIKE '%via_recovery_code%'").all(staffId);
  assert.equal(events.length, 2, "el ingreso con código de recuperación queda registrado");
});

test("un secreto antiguo en texto plano sigue funcionando", () => {
  assert.equal(openTotpSecret(5, "JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP");
  assert.equal(openTotpSecret(5, sealTotpSecret(5, "JBSWY3DPEHPK3PXP")), "JBSWY3DPEHPK3PXP");
});

test("desactivar pide la clave y borra el secreto y los códigos", async () => {
  assert.equal((await post("/api/auth/2fa/disable", { password: "incorrecta" })).status, 400);
  assert.equal((await post("/api/auth/2fa/disable", { password: PASSWORD })).status, 200);
  const row = await db.prepare("SELECT totp_secret, totp_enabled, totp_recovery_codes, totp_last_step FROM staff WHERE id = ?").get(staffId) as Record<string, unknown>;
  assert.equal(row.totp_secret, null);
  assert.equal(Number(row.totp_enabled), 0);
  assert.equal(row.totp_recovery_codes, null);
  assert.equal(row.totp_last_step, null);
  assert.equal((await loginWith()).status, 200, "sin 2FA entra solo con la clave");
});

test("códigos de recuperación: formato, normalización y hash estable", () => {
  const codes = totp.generateRecoveryCodes(20);
  assert.equal(new Set(codes).size, 20);
  assert.equal(totp.normalizeRecoveryCode(" ABCDE-fghij "), "abcdefghij");
  assert.equal(totp.hashRecoveryCode("abcde-fghij"), totp.hashRecoveryCode("ABCDE FGHIJ"));
  assert.equal(totp.looksLikeRecoveryCode("abcde-fghij"), true);
  assert.equal(totp.looksLikeRecoveryCode("123456"), false);
  assert.equal(totp.looksLikeRecoveryCode("abc"), false);
});
