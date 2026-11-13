import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let resetPublicAttemptsForTesting: typeof import("../../server/middleware/publicAttempts").resetPublicAttemptsForTesting;
let clientId = 0;

const EMAIL = "seguridad.portal@empresa.cl";
const post = (path: string, body: unknown) =>
  fetch(`${harness.baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const requestLink = () => post("/api/portal/auth/request-link", { email: EMAIL });
const verify = (token: string) => post("/api/portal/auth/verify", { token });

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({ resetPublicAttemptsForTesting } = await import("../../server/middleware/publicAttempts"));
  const admin = await harness.loginAs("admin@parkia.local", "admin123");
  const created = await fetch(`${harness.baseUrl}/api/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ name: "Abonado Seguridad", email: EMAIL, phone: "+56922223333", rut: "77.765.432-1", type: "company" }),
  });
  assert.ok(created.status === 200 || created.status === 201);
  clientId = ((await created.json()) as { id: number }).id;
});
after(async () => { await harness.close(); });
beforeEach(async () => {
  resetMemoryOutbox();
  resetPublicAttemptsForTesting();
  await db.prepare("DELETE FROM portal_sessions WHERE client_id = ?").run(clientId);
  await db.prepare("DELETE FROM portal_magic_links WHERE client_id = ?").run(clientId);
});

test("un enlace de un solo uso abre una sola sesion aunque lleguen varias peticiones a la vez", async () => {
  const token = ((await (await requestLink()).json()) as { debugToken: string }).debugToken;
  const attempts = await Promise.all(Array.from({ length: 6 }, () => verify(token)));
  assert.equal(attempts.filter(res => res.status === 200).length, 1, attempts.map(res => res.status).join(","));
  assert.equal(attempts.filter(res => res.status === 401).length, 5);
  const sessions = await db.prepare("SELECT COUNT(*) AS n FROM portal_sessions WHERE client_id = ?").get(clientId) as { n: number | string };
  assert.equal(Number(sessions.n), 1, "solo una sesion creada");
});

test("a una misma persona se le envian como maximo 3 enlaces por hora, con la misma respuesta de siempre", async () => {
  const bodies: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await requestLink();
    assert.equal(res.status, 200);
    bodies.push(((await res.json()) as { message: string }).message);
  }
  assert.equal(new Set(bodies).size, 1, "el mensaje no cambia: no se revela que se alcanzo el limite");
  assert.equal(memoryOutbox.length, 3, "solo 3 correos salieron");
  const links = await db.prepare("SELECT COUNT(*) AS n FROM portal_magic_links WHERE client_id = ?").get(clientId) as { n: number | string };
  assert.equal(Number(links.n), 3);
});

test("pedir enlaces en exceso desde una misma direccion responde 429", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) statuses.push((await post("/api/portal/auth/request-link", { email: `nadie${i}@empresa.cl` })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

test("probar enlaces al azar tambien tiene limite", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) statuses.push((await verify(`a${String(i).padStart(30, "0")}`)).status);
  assert.ok(statuses.slice(0, 20).every(status => status === 401));
  assert.deepEqual(statuses.slice(20), [429, 429]);
});

test("la cookie del portal lleva Secure con HTTPS y se borra igual", async () => {
  const previous = process.env.SESSION_COOKIE_SECURE;
  try {
    process.env.SESSION_COOKIE_SECURE = "true";
    const token = ((await (await requestLink()).json()) as { debugToken: string }).debugToken;
    const ok = await verify(token);
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /parkia_portal_session=/);
    for (const flag of ["HttpOnly", "SameSite=Lax", "Secure"]) assert.ok(cookie.includes(flag), `${flag} en ${cookie}`);
    assert.match(cookie, /Max-Age=604800/);

    const out = await fetch(`${harness.baseUrl}/api/portal/auth/logout`, { method: "POST", headers: { cookie: cookie.split(";")[0] } });
    assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0.*Secure|Secure.*Max-Age=0/);

    process.env.SESSION_COOKIE_SECURE = "false";
    resetPublicAttemptsForTesting();
    const second = ((await (await requestLink()).json()) as { debugToken: string }).debugToken;
    assert.ok(!(await verify(second)).headers.get("set-cookie")!.includes("Secure"), "sin HTTPS no se marca Secure (si no, el navegador la descartaria)");
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SECURE; else process.env.SESSION_COOKIE_SECURE = previous;
  }
});

test("el enlace del correo apunta a APP_URL y no al encabezado Host de la peticion", async () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://app.parkia.cl";
  try {
    const res = await fetch(`${harness.baseUrl}/api/portal/auth/request-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Host": "evil.example", Host: harness.baseUrl.replace("http://", "") },
      body: JSON.stringify({ email: EMAIL }),
    });
    assert.equal(res.status, 200);
    const mail = memoryOutbox.at(-1)!;
    const text = `${mail.text}\n${mail.html}`;
    assert.ok(text.includes("https://app.parkia.cl/portal?token="), "usa el dominio configurado");
    assert.ok(!text.includes("evil.example"));
  } finally {
    if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous;
  }
});
