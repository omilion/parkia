import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

/**
 * Arnés mínimo para pruebas de API en archivos propios (sin tocar tests/api.test.ts):
 * base de datos desechable (SQLite, pglite o PostgreSQL según PARKIA_DB_ENGINE), servidor en un puerto libre,
 * inicio de sesión y alta de personal. Llámalo una vez por archivo, antes de importar cualquier módulo del servidor.
 */
export async function startTestServer() {
  const tempDir = mkdtempSync(join(tmpdir(), "parkia-test-"));
  process.env.PARKIA_DB_PATH = join(tempDir, "test.db");
  process.env.PARKIA_STORAGE_PATH = join(tempDir, "storage");
  process.env.PARKIA_BACKUP_PATH = join(tempDir, "backups");
  process.env.NODE_ENV = "test";
  process.env.PARKIA_PLATFORM_ADMINS = "admin@parkia.local";

  const { prepareTestDatabase } = await import("./pgTestDatabase");
  const dropTestDatabase = await prepareTestDatabase();
  const { db } = await import("../../server/db");
  const { attachErrorHandler, createApiApp } = await import("../../server/app");
  const app = createApiApp({ logger: false });
  attachErrorHandler(app);

  const server: Server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function login(email = "admin@parkia.local", password = "admin123") {
    const res = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    const body = await res.json();
    if (body.user?.must_change_password) {
      const changed = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ current_password: password, new_password: `${password}Nueva1` }),
      });
      assert.equal(changed.status, 200);
      return changed.headers.get("set-cookie")!.split(";")[0];
    }
    return cookie;
  }

  /** Crea una persona del equipo y devuelve su sesión (la clave inicial es `Cambiar123!`). */
  async function createStaffAndLogin(adminCookie: string, role: "admin" | "finance" | "guard" | "cashier", email: string, rut: string) {
    const res = await fetch(`${baseUrl}/api/staff`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ name: `${role} Test`, rut, email, phone: "", role, password: "Cambiar123!" }),
    });
    assert.equal(res.status, 200);
    return await login(email, "Cambiar123!");
  }

  async function close() {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    await db.close();
    await dropTestDatabase?.();
    rmSync(tempDir, { recursive: true, force: true });
  }

  const json = { "Content-Type": "application/json" };
  const call = (cookie: string, path: string, init: { method?: string; body?: unknown } = {}) =>
    fetch(`${baseUrl}${path}`, { method: init.method ?? "GET", headers: { ...json, Cookie: cookie }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });

  return { db, baseUrl, login, createStaffAndLogin, call, close };
}
