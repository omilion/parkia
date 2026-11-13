import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  // El service worker se bloquea por omisión para que los specs no vean una versión en caché; pwa.spec.ts lo habilita.
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: { command: 'npx tsx tests/e2e/server.ts', url: 'http://127.0.0.1:4178', timeout: 60000, reuseExistingServer: false },
});
