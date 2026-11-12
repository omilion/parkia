import { test, expect } from '@playwright/test';

/** Formularios secundarios migrados a react-hook-form + Zod con reglas compartidas con la API. */

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
});

test('gastos: muestra errores por campo y registra cuando los datos son válidos', async ({ page }) => {
  await page.goto('/finanzas/gastos');
  await page.getByRole('button', { name: 'Nuevo Gasto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar Gasto' });
  await dialog.getByRole('button', { name: 'Registrar Gasto', exact: true }).click();
  await expect(dialog.getByText('Completa el proveedor')).toBeVisible();
  await expect(dialog.getByText('Completa la descripción')).toBeVisible();
  await expect(dialog.getByText('El monto debe ser mayor que cero')).toBeVisible();
  await expect(dialog.getByLabel('Proveedor', { exact: true })).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByLabel('Proveedor', { exact: true }).fill('Proveedor E2E');
  await dialog.getByLabel('Descripción', { exact: true }).fill('Reparación portón E2E');
  await dialog.getByLabel('Total', { exact: true }).fill('11900');
  await dialog.getByRole('button', { name: 'Registrar Gasto', exact: true }).click();
  await expect(page.getByText('Gasto registrado.', { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('personal: la confirmación de clave debe coincidir antes de enviar', async ({ page }) => {
  let passwordRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/staff\/\d+\/password$/.test(request.url())) passwordRequests += 1; });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Clave', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Restablecer clave' });
  await dialog.getByLabel('Nueva clave').fill('ClaveNueva123');
  await dialog.getByLabel('Confirmar clave').fill('ClaveNueva124');
  await dialog.getByLabel('Motivo operacional').fill('Prueba de validación');
  await dialog.getByRole('button', { name: 'Guardar clave' }).click();
  await expect(dialog.getByText('Las claves no coinciden')).toBeVisible();
  expect(passwordRequests).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('bitácora: el cierre de turno exige las verificaciones y el resumen', async ({ page }) => {
  await page.goto('/access?tab=shift-log');
  const open = page.getByRole('form', { name: 'Abrir bitácora de turno' });
  const close = page.getByRole('form', { name: 'Cerrar y traspasar turno' });
  await expect(open.or(close)).toBeVisible();
  if (await open.isVisible()) await open.getByRole('button', { name: 'Abrir Turno' }).click();
  await expect(close).toBeVisible();
  await close.getByRole('button', { name: 'Cerrar Turno' }).click();
  await expect(close.getByText('Confirma las cuatro verificaciones antes de cerrar')).toBeVisible();
  await expect(close.getByText('El resumen de traspaso debe tener al menos 3 caracteres')).toBeVisible();
  await close.getByLabel('Pendiente 1', { exact: true }).fill('ab');
  await close.getByRole('button', { name: 'Cerrar Turno' }).click();
  await expect(close.getByText('El pendiente debe tener al menos 3 caracteres')).toBeVisible();
});

test('plazas: el precio vacío no se envía como cero', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  let createRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/spaces')) createRequests += 1; });
  await page.goto('/spaces');
  await page.getByRole('button', { name: /Nuevo (Espacio|Estacionamiento)/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Registrar Nuevo Estacionamiento' });
  await dialog.getByLabel('Identificador / Nombre').fill('E2E-01');
  await dialog.getByRole('button', { name: 'Crear Estacionamiento' }).click();
  await expect(dialog.getByText('Ingresa un monto')).toBeVisible();
  expect(createRequests).toBe(0);
});
