import { gzipSync } from 'node:zlib';
import { test, expect } from '@playwright/test';

test('el inicio carga menos de 200 KB comprimidos de JavaScript y CSS', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  const sizes: Array<Promise<{ path: string; bytes: number }>> = [];
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/assets/') && /\.(js|css)$/.test(path)) sizes.push(response.body().then(body => ({ path, bytes: gzipSync(body).byteLength })));
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.getByText('Operación de accesos hoy', { exact: true })).toBeVisible();
  const assets = await Promise.all(sizes);
  expect(assets.length).toBeGreaterThan(0);
  expect(assets.reduce((total, asset) => total + asset.bytes, 0), JSON.stringify(assets)).toBeLessThan(200 * 1024);
});
