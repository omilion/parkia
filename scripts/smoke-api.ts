/**
 * Recorre todos los endpoints GET sin parametros de la API con una sesion de administrador y
 * reporta cualquier respuesta 5xx. Sirve para validar una base recien migrada:
 *
 *   PARKIA_DB_ENGINE=postgres DATABASE_URL=... PARKIA_PG_ADMIN_URL=... npx tsx scripts/smoke-api.ts
 *
 * Usa ADMIN_EMAIL / ADMIN_PASSWORD (por defecto los de la demo).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.PARKIA_SEED_DEMO = process.env.PARKIA_SEED_DEMO || "false";

const { db } = await import("../server/db");
const { attachErrorHandler, createApiApp } = await import("../server/app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const routes = new Set<string>();
for (const file of sourceFiles("server")) {
  for (const match of readFileSync(file, "utf8").matchAll(/app\.get\(\s*["'`](\/api\/[^"'`]+)["'`]/g)) {
    if (!match[1].includes(":") && !match[1].includes("*")) routes.add(match[1]);
  }
}

const app = createApiApp({ logger: false });
attachErrorHandler(app);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const email = process.env.ADMIN_EMAIL || "admin@parkia.local";
const password = process.env.ADMIN_PASSWORD || "admin123";
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
if (!login.ok) throw new Error(`No se pudo iniciar sesion como ${email}: HTTP ${login.status}`);
let cookie = (login.headers.get("set-cookie") || "").split(";")[0];
const loginBody = await login.json();
if (loginBody.user?.must_change_password) {
  const changed = await fetch(`${base}/api/auth/change-password`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ current_password: password, new_password: `${password}Smoke1` }),
  });
  cookie = (changed.headers.get("set-cookie") || cookie).split(";")[0];
}

const failures: string[] = [];
let ok = 0;
for (const route of [...routes].sort()) {
  const response = await fetch(`${base}${route}`, { headers: { Cookie: cookie } });
  if (response.status >= 500) failures.push(`${response.status} ${route}: ${(await response.text()).slice(0, 200)}`);
  else ok += 1;
}

server.close();
await db.close();
console.log(`Endpoints GET revisados: ${routes.size} (sin error 5xx: ${ok})`);
for (const failure of failures) console.log(`FALLA ${failure}`);
process.exit(failures.length ? 1 : 0);
