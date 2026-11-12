import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';

// Base aislada y desechable: nunca usa la base ni los archivos del usuario.
const tempDir = mkdtempSync(join(tmpdir(), 'parkia-e2e-'));
process.env.PARKIA_DB_PATH = join(tempDir, 'test.db');
process.env.PARKIA_STORAGE_PATH = join(tempDir, 'storage');
process.env.PARKIA_BACKUP_PATH = join(tempDir, 'backups');
process.env.NODE_ENV = 'test';
process.env.PARKIA_SEED_DEMO = 'true';
const { prepareTestDatabase } = await import('../support/pgTestDatabase');
const dropTestDatabase = await prepareTestDatabase();
const { db } = await import('../../server/db');
const { createApiApp, attachErrorHandler } = await import('../../server/app');
await db.prepare('UPDATE staff SET must_change_password = 0').run();
const app = createApiApp({ logger: false });
app.use(express.static(resolve('dist')));
app.get('*', (_req, res) => res.sendFile(resolve('dist/index.html')));
attachErrorHandler(app);
const server = app.listen(4178, '127.0.0.1', () => console.log('E2E server ready'));
function cleanup() {
  server.close(async () => {
    await db.close();
    await dropTestDatabase?.();
    rmSync(tempDir, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
