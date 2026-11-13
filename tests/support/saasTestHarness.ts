import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";

export async function createSaasTestServer(options?: { platformAdmins?: string }) {
  const tempDir = mkdtempSync(join(tmpdir(), "parkia-saas-test-"));
  process.env.PARKIA_DB_PATH = join(tempDir, "test.db");
  process.env.PARKIA_STORAGE_PATH = join(tempDir, "storage");
  process.env.PARKIA_BACKUP_PATH = join(tempDir, "backups");
  process.env.NODE_ENV = "test";
  process.env.PARKIA_PUBLIC_RATE_LIMIT = "200";
  if (options?.platformAdmins !== undefined) {
    process.env.PARKIA_PLATFORM_ADMINS = options.platformAdmins;
  } else {
    process.env.PARKIA_PLATFORM_ADMINS = "admin@parkia.local";
  }

  const { prepareTestDatabase } = await import("./pgTestDatabase");
  const dropTestDatabase = await prepareTestDatabase();
  const { db } = await import("../../server/db");
  const { attachErrorHandler, createApiApp } = await import("../../server/app");

  const app = createApiApp({ logger: false });
  attachErrorHandler(app);

  let server: Server;
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  server!.keepAliveTimeout = 120_000;
  server!.headersTimeout = 125_000;

  const address = server!.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(res.status, 200, `Login fallido para ${email}`);
    const setCookie = res.headers.get("set-cookie");
    assert(setCookie, "Se esperaba cookie de sesion");
    return setCookie.split(";")[0];
  }

  async function close() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await db.close();
    await dropTestDatabase?.();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { baseUrl, db, loginAs, close };
}
