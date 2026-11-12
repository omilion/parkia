import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  webServer: { command: 'npx tsx tests/e2e/server.ts', url: 'http://127.0.0.1:4178', timeout: 60000, reuseExistingServer: false },
});
