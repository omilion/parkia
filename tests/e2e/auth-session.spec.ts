import { test, expect } from '@playwright/test';

test('login y logout por interfaz descartan la cache y un fallo de logout conserva la sesion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  let clientReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/clients' && request.method() === 'GET') clientReads++; });
  await page.goto('/clients');
  const signIn = async () => {
    await page.getByLabel('Email', { exact: true }).fill('admin@parkia.local');
    await page.getByLabel('Clave', { exact: true }).fill('admin123');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Clientes', exact: true }).getByRole('button', { name: 'Juan Perez' })).toBeVisible();
  };
  await signIn();
  const initialReads = clientReads;
  await page.route('**/api/auth/logout', route => route.abort('connectionfailed'));
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo conectar');
  await expect(page.getByRole('region', { name: 'Clientes', exact: true })).toBeVisible();
  await page.unroute('**/api/auth/logout');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
  await signIn();
  expect(clientReads).toBeGreaterThan(initialReads);
});
