import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
});

test('el alta de contrato valida y conserva valores al volver entre pasos', async ({ page }) => {
  await page.goto('/contracts');
  await page.getByRole('button', { name: 'Generar Nuevo Contrato' }).click();
  const form = page.getByRole('form', { name: 'Nuevo contrato por pasos' });
  await form.getByRole('button', { name: 'Continuar' }).click();
  await expect(form.getByText('Selecciona un cliente', { exact: true })).toBeVisible();
  await form.getByLabel('Buscar cliente por RUT o nombre').fill('Juan');
  await form.getByRole('button', { name: /Juan Perez/ }).click();
  const options = form.getByLabel('Plaza disponible').locator('option');
  await expect.poll(() => options.count()).toBeGreaterThan(1);
  const spaceId = await options.nth(1).getAttribute('value');
  await form.getByLabel('Plaza disponible').selectOption(spaceId!);
  await form.getByRole('button', { name: 'Continuar' }).click();
  await form.getByLabel('Tarifa mensual', { exact: true }).fill('75000');
  await form.getByRole('button', { name: 'Continuar' }).click();
  await expect(form.getByText('$75.000', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(form.getByLabel('Tarifa mensual', { exact: true })).toHaveValue('75.000');
  await form.getByRole('button', { name: 'Continuar' }).click();
  await form.getByRole('button', { name: 'Generar contrato', exact: true }).click();
  await expect(page.getByText('Contrato generado correctamente', { exact: true })).toBeVisible();
});

test('mapa móvil permite ampliar y mover sin habilitar el editor', async ({ page }) => {
  const branches = await (await page.request.get('/api/branches')).json();
  const spaces = await (await page.request.get(`/api/spaces?branch_id=${branches[0].id}`)).json();
  const created = await page.request.post('/api/space-maps', { data: {
    branch_id: branches[0].id, name: 'Mapa prueba móvil', image_width: 400, image_height: 400, is_default: true,
    image: { fileName: 'map.png', mimeType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFZsAAAAASUVORK5CYII=' },
  } });
  expect(created.ok()).toBeTruthy();
  const mapId = (await created.json()).map.id;
  expect((await page.request.put(`/api/space-maps/${mapId}/regions`, { data: { regions: [{ space_id: spaces[0].id, geometry: { type: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }] } })).ok()).toBeTruthy();
  await page.goto(`/spaces?mapSpaceId=${spaces[0].id}&branchId=${branches[0].id}`);
  await expect(page.getByRole('button', { name: 'Acercar mapa' })).toBeVisible();
  await expect(page.getByText('Para editar el mapa, usa una tablet o computador.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Acercar mapa' }).click();
  await expect(page.getByText('150%', { exact: true })).toBeVisible();
  const viewport = page.getByRole('region', { name: 'Mapa interactivo' });
  await viewport.scrollIntoViewIfNeeded();
  const box = (await viewport.boundingBox())!;
  const inner = viewport.locator(':scope > div');
  const before = await inner.getAttribute('style');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => inner.getAttribute('style')).not.toBe(before);
  await page.getByRole('button', { name: 'Restablecer', exact: true }).click();
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
});
