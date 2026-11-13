import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";
import { assertSafeRelayUrl, isForbiddenAddress, UnsafeRelayUrlError } from "../../server/modules/phase7/relayUrl";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let db: typeof import("../../server/db").db;
let admin = "";

before(async () => {
  harness = await createSaasTestServer();
  ({ db } = await import("../../server/db"));
  admin = await harness.loginAs("admin@parkia.local", "admin123");
});
after(async () => { await harness.close(); });
afterEach(() => { delete process.env.PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS; });

test("direcciones IP: la maquina misma, enlace local y metadatos de la nube siempre se bloquean", () => {
  for (const ip of ["127.0.0.1", "127.8.9.10", "0.0.0.0", "169.254.169.254", "169.254.0.1", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "febf::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "0:0:0:0:0:ffff:7f00:1", "no-es-una-ip"]) {
    assert.equal(isForbiddenAddress(ip, true), true, `${ip} (aun permitiendo redes privadas)`);
    assert.equal(isForbiddenAddress(ip, false), true, ip);
  }
});

test("direcciones IP: las redes privadas se bloquean salvo instalaciones locales", () => {
  for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.99", "fd12:3456::1", "fc00::1", "::ffff:192.168.1.5"]) {
    assert.equal(isForbiddenAddress(ip, false), true, `${ip} en la nube`);
    assert.equal(isForbiddenAddress(ip, true), false, `${ip} en una instalacion local`);
  }
});

test("direcciones IP: las publicas pasan (y los limites de los rangos privados son exactos)", () => {
  for (const ip of ["8.8.8.8", "203.0.113.10", "172.15.255.255", "172.32.0.1", "192.167.1.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isForbiddenAddress(ip, false), false, ip);
  }
});

test("URLs: solo http/https, sin credenciales y sin nombres internos", async () => {
  const bad: Array<[string, RegExp]> = [
    ["ftp://203.0.113.10/relay", /http o https/],
    ["file:///etc/passwd", /http o https/],
    ["http://user:clave@203.0.113.10/relay", /usuario ni clave/],
    ["http://localhost/relay", /interna/],
    ["http://api.localhost/relay", /interna/],
    ["http://metadata.google.internal/computeMetadata/v1/", /interna/],
    ["http://impresora.local/relay", /interna/],
    ["http://127.0.0.1:5432/", /red interna o no permitida/],
    ["http://[::1]:8080/", /red interna o no permitida/],
    ["http://169.254.169.254/latest/meta-data/", /red interna o no permitida/],
    ["http://192.168.1.50/relay/0", /red interna o no permitida/],
    ["http://2130706433/", /red interna o no permitida/], // 127.0.0.1 escrito como numero
    ["http://0x7f.0.0.1/", /red interna o no permitida/], // y en hexadecimal
    ["http://no-existe-parkia.invalid/relay", /resolver/],
    ["no es una url", /no es valida/],
  ];
  for (const [url, message] of bad) {
    await assert.rejects(() => assertSafeRelayUrl(url, { allowPrivate: false }), (error: Error) => error instanceof UnsafeRelayUrlError && message.test(error.message), url);
  }
  assert.equal((await assertSafeRelayUrl("http://203.0.113.10/relay/0?auth=x", { allowPrivate: false })).hostname, "203.0.113.10");
  assert.equal((await assertSafeRelayUrl("https://203.0.113.10:8443/rpc", { allowPrivate: false })).port, "8443");
  // Instalacion local: la red del estacionamiento si, pero nunca la propia maquina ni los metadatos.
  assert.equal((await assertSafeRelayUrl("http://192.168.1.50/relay/0", { allowPrivate: true })).hostname, "192.168.1.50");
  await assert.rejects(() => assertSafeRelayUrl("http://127.0.0.1/", { allowPrivate: true }), UnsafeRelayUrlError);
  await assert.rejects(() => assertSafeRelayUrl("http://169.254.169.254/", { allowPrivate: true }), UnsafeRelayUrlError);
});

const createDevice = (endpoint_url: string) =>
  fetch(`${harness.baseUrl}/api/devices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin },
    body: JSON.stringify({ name: "Barrera", type: "barrier", direction: "entry", vendor: "shelly", endpoint_url }),
  });

test("al registrar una barrera, una URL interna se rechaza con 400 y no se guarda nada", async () => {
  const before = Number((await db.prepare("SELECT COUNT(*) AS n FROM devices").get() as { n: number | string }).n);
  for (const url of ["http://127.0.0.1:5432/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/relay/0", "http://localhost:8080/api/health"]) {
    const res = await createDevice(url);
    assert.equal(res.status, 400, url);
    assert.equal(((await res.json()) as { code: string }).code, "RELAY_URL_NOT_ALLOWED");
  }
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS n FROM devices").get() as { n: number | string }).n), before);
  assert.equal((await createDevice("http://203.0.113.10/relay/0")).status, 201);
});

test("una instalacion local puede usar el rele en su red, pero nunca la propia maquina", async () => {
  process.env.PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS = "true";
  assert.equal((await createDevice("http://192.168.1.50/relay/0")).status, 201);
  assert.equal((await createDevice("http://127.0.0.1:5432/")).status, 400);
});

test("si la URL guardada pasa a apuntar a una red interna, la orden no se envia", async () => {
  const created = await createDevice("http://203.0.113.10/relay/0");
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };
  // Simula un nombre cuyo DNS cambio despues de registrarse (o datos alterados): la URL guardada ya no es segura.
  await db.prepare("UPDATE devices SET endpoint_url = 'http://169.254.169.254/latest/meta-data/' WHERE id = ?").run(id);

  const realFetch = globalThis.fetch;
  const outgoing: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (!url.startsWith(harness.baseUrl)) outgoing.push(url);
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const res = await fetch(`${harness.baseUrl}/api/devices/${id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: admin },
      body: JSON.stringify({ command: "open_barrier" }),
    });
    assert.ok(res.status < 500, `status ${res.status}`);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(outgoing, [], "el servidor no hizo ninguna peticion hacia fuera");
  const command = await db.prepare("SELECT status FROM device_commands WHERE device_id = ?").get(id) as { status: string };
  assert.equal(command.status, "failed");
});
