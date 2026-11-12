import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
});

test('tareas valida el formulario y refresca la lista después de crear', async ({ page }) => {
  await page.goto('/tasks');
  const form = page.getByRole('form', { name: 'Nueva tarea' });
  await form.getByLabel('Título', { exact: true }).fill('ab');
  await form.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('3 caracteres');
  await form.getByLabel('Título', { exact: true }).fill('Revisión de caseta E2E');
  await form.getByRole('button', { name: 'Crear tarea', exact: true }).click();
  await expect(page.getByText('Revisión de caseta E2E', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Título', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Filtros' }).getByLabel('Estado de tareas')).toBeVisible();
});

test('configuración valida porcentajes y guarda sin perder campos no editados', async ({ page }) => {
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Datos generales de la empresa' });
  await form.getByLabel('Razón social', { exact: true }).fill('Empresa E2E');
  await form.getByRole('button', { name: 'Guardar cambios de la empresa' }).click();
  await expect(page.getByText('Configuracion actualizada', { exact: true })).toBeVisible();
  await page.reload();
  await expect(form.getByLabel('Razón social', { exact: true })).toHaveValue('Empresa E2E');
  await form.getByLabel('Recuperación estimada de mora (%)').fill('101');
  await form.getByRole('button', { name: 'Guardar cambios de la empresa' }).click();
  await expect(form.getByLabel('Recuperación estimada de mora (%)')).toHaveValue('101');
  const config = await (await page.request.get('/api/config')).json();
  expect(config.overdue_recovery_rate).not.toBe(101);
});
