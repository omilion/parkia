import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('la app es instalable: manifest válido con iconos reales', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Parkia', short_name: 'Parkia', display: 'standalone', start_url: '/operar', scope: '/', lang: 'es-CL' });
  const purposes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`);
  expect(purposes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBeTruthy();
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBeTruthy();
});

test('el shell de la app carga sin conexión una vez instalado el service worker', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Recarga hasta que la página quede controlada por el service worker.
  await expect.poll(async () => { await page.reload(); return page.evaluate(() => Boolean(navigator.serviceWorker.controller)); }, { timeout: 15000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Parkia' })).toBeVisible();
  await context.setOffline(false);
});
