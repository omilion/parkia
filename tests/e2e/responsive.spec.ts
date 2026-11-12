import { test, expect } from '@playwright/test';
import { findTableScrollContainers } from './horizontalOverflow';

const viewports = [
  { width: 360, height: 800 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test(`auditoría y navegación a ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const login = await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } });
    expect(login.ok()).toBeTruthy();
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Auditoria', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Eventos de auditoría' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.width < 768) {
      await expect(page.getByRole('navigation', { name: 'Navegación móvil' })).toBeVisible();
      await page.getByRole('button', { name: 'Filtros', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Filtros' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Filtros' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Más', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Más opciones' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Más opciones' })).not.toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`auditoria-${viewport.width}.png`), fullPage: true });
  });
}

for (const viewport of viewports) {
  test(`las paginas principales caben a ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    const login = await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } });
    expect(login.ok()).toBeTruthy();
    const routes = ['/', '/operar', '/access', '/spaces', '/finance', '/clients', '/contracts', '/tasks', '/documents', '/staff', '/audit', '/settings'];
    const overflowing: string[] = [];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.getByText('Cargando modulo...', { exact: true }).waitFor({ state: 'hidden' });
      const width = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      if (width.page > width.viewport) overflowing.push(`${route}: ${width.page}px`);
      if (viewport.width <= 1024) {
        const containers = await page.evaluate(findTableScrollContainers);
        if (containers.length) overflowing.push(`${route}: ${JSON.stringify(containers)}`);
      }
      const name = route === '/' ? 'inicio' : route.slice(1);
      await page.screenshot({ path: test.info().outputPath(`${name}-${viewport.width}.png`), fullPage: true });
    }
    expect(overflowing).toEqual([]);
  });
}

test('ficha y filtros de clientes funcionan en teléfono', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const login = await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } });
  expect(login.ok()).toBeTruthy();
  await page.goto('/clients');
  const list = page.getByRole('region', { name: 'Clientes', exact: true });
  await expect(list.getByRole('button', { name: 'Juan Perez' })).toBeVisible();
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Filtros' });
  await filters.getByLabel('Tipo de cliente').selectOption('natural');
  await filters.getByRole('button', { name: 'Ver resultados' }).click();
  await expect(list.getByRole('button', { name: 'Juan Perez' })).toBeVisible();
  await list.getByRole('button', { name: 'Juan Perez' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

for (const width of [360, 768, 1024]) test(`subvistas operativas caben a ${width}px`, async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  const routes = ['/finance?tab=payments', '/finance?tab=collections', '/finance?tab=expenses', '/finance?tab=cgvc', '/finance?tab=invoices', '/finance?tab=reports', '/access?tab=visitors', '/access?tab=audit', '/access?tab=shift-log'];
  const overflowing: string[] = [];
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'networkidle' });
    await page.getByText('Cargando modulo...', { exact: true }).waitFor({ state: 'hidden' });
    const result = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
    const containers = await page.evaluate(findTableScrollContainers);
    if (result.page > result.viewport || containers.length) overflowing.push(`${route}: ancho ${result.page}, contenedores ${JSON.stringify(containers)}`);
    await page.screenshot({ path: test.info().outputPath(`${route.replace(/[/?=]/g, '-')}.png`), fullPage: true });
  }
  expect(overflowing).toEqual([]);
});

test('detecta una tabla ancha dentro de overflow-x-auto', async ({ page }) => {
  await page.setContent('<div style="width:300px;overflow-x:auto"><table style="width:720px"><tbody><tr><td>Datos</td></tr></tbody></table></div>');
  const containers = await page.evaluate(findTableScrollContainers);
  expect(containers).toHaveLength(1);
  expect(containers[0].width).toBe(300);
  expect(containers[0].contentWidth).toBeGreaterThan(300);
});
