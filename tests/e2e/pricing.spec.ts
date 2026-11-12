import { test, expect } from '@playwright/test';

test('el administrador crea una tarifa, un convenio y el comercio valida un ticket', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();

  await page.goto('/settings?tab=tariffs');
  await expect(page.getByRole('heading', { name: 'Tarifas', exact: true })).toBeVisible();

  // Convenio nuevo.
  await page.getByRole('button', { name: 'Nuevo convenio' }).click();
  const agreement = page.getByRole('dialog', { name: 'Nuevo convenio' });
  await agreement.getByLabel('Comercio').fill('Panadería E2E');
  await agreement.getByLabel('Código').fill('PAN-E2E');
  await agreement.getByLabel('Minutos gratis').fill('45');
  await agreement.getByRole('button', { name: 'Guardar' }).click();
  await expect(agreement).toHaveCount(0);
  await expect(page.getByText('Panadería E2E')).toBeVisible();

  // Nueva tarifa para motos con simulador.
  await page.getByRole('button', { name: 'Nueva tarifa' }).click();
  const plan = page.getByRole('dialog', { name: 'Nueva tarifa' });
  await plan.getByLabel('Nombre').fill('Motos E2E');
  await plan.getByLabel('Tipo de vehículo').selectOption('moto');
  await plan.getByLabel('Minutos de gracia').fill('0');
  await plan.getByLabel('$ por minuto').fill('20');
  await plan.getByLabel('Entrada').fill('2026-06-10T10:00');
  await plan.getByLabel('Salida').fill('2026-06-10T11:00');
  await plan.getByRole('button', { name: 'Simular cobro' }).click();
  await expect(plan.getByRole('status')).toContainText('$1.200');
  await plan.getByRole('button', { name: 'Crear tarifa' }).click();
  await expect(plan).toHaveCount(0);
  await expect(page.getByText('Motos E2E')).toBeVisible();

  // Un ticket de moto, validado por el comercio desde la pagina publica (sin sesion).
  const entry = await page.request.post('/api/visitors', { data: { plate: 'MOTE2E', vehicle_type: 'moto' } });
  expect(entry.ok()).toBeTruthy();
  const anonymous = await page.context().browser()!.newPage({ baseURL: 'http://127.0.0.1:4178' });
  await anonymous.goto('/validar');
  await expect(anonymous.getByRole('heading', { name: 'Validar estacionamiento' })).toBeVisible();
  await anonymous.getByLabel('Código del comercio').fill('PAN-E2E');
  await anonymous.getByLabel('Patente del cliente').fill('MOTE2E');
  await anonymous.getByRole('button', { name: 'Validar ticket' }).click();
  await expect(anonymous.getByRole('status')).toContainText('45 minutos gratis');
  await anonymous.close();
});
