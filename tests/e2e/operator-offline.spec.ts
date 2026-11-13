import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('el guardia opera sin conexión y todo se sincroniza al volver la red', async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'guardia@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();

  // Un auto que ya llevaba una hora dentro (creado con conexión) para cobrarlo y darle salida sin red.
  const created = await page.request.post('/api/visitors', { data: { plate: 'OFFA01' } });
  expect(created.ok()).toBeTruthy();
  const ticketId = (await created.json()).ticket.ticketId as number;
  expect((await page.request.post(`/__e2e__/age-ticket/${ticketId}`)).ok()).toBeTruthy();

  await page.goto('/operar');
  await expect(page.getByRole('heading', { name: 'Operar' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Con conexión' })).toBeVisible();
  await expect(page.getByText('OFFA01')).toBeVisible();

  // Se instala el service worker y la página queda controlada (así la app abre sin red).
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => { await page.reload(); return page.evaluate(() => Boolean(navigator.serviceWorker.controller)); }, { timeout: 15000 }).toBe(true);
  await expect(page.getByText('OFFA01')).toBeVisible();

  // ---- Se corta la red.
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
  await expect(page.getByText('Trabajando sin conexión')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver caja y cierre' })).toBeDisabled();

  // Entrada sin conexión.
  await page.getByRole('button', { name: 'Entrada', exact: true }).click();
  const entry = page.getByRole('dialog', { name: 'Registrar entrada' });
  await entry.getByLabel('Patente').fill('OFFB02');
  await entry.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText(/Entrada registrada sin conexión: OFFB02/)).toBeVisible();
  await expect(page.getByText(/1 operación pendiente de envío/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'OFFB02' })).toContainText('Sin enviar');

  // Cobro en efectivo y salida del auto que ya estaba dentro, cotizados en el dispositivo.
  await page.getByRole('button', { name: 'Salida / Cobrar' }).click();
  const exit = page.getByRole('dialog', { name: 'Salida y cobro' });
  await exit.getByLabel('Patente').fill('OFFA01');
  await exit.getByRole('button', { name: 'Buscar ticket' }).click();
  await expect(exit.getByText('Total a cobrar')).toBeVisible();
  await expect(exit.getByText(/Cotizado en este dispositivo, sin conexión/)).toBeVisible();
  await expect(exit.getByLabel('Medio de pago')).toBeDisabled();
  await exit.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(exit.getByText('Ticket pagado. Puedes registrar la salida.')).toBeVisible();
  await exit.getByRole('button', { name: 'Registrar salida' }).click();
  await expect(page.getByText('Salida registrada sin conexión para OFFA01.')).toBeVisible();
  await expect(page.getByText(/3 operaciones pendientes de envío/)).toBeVisible();

  // Recargar sin red no pierde nada: la app abre desde el service worker y las operaciones siguen en el dispositivo.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Operar' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toContainText('3 operaciones pendientes');
  await expect(page.getByRole('listitem').filter({ hasText: 'OFFB02' })).toContainText('Sin enviar');
  await expect(page.getByText('OFFA01')).toHaveCount(0);

  // ---- Vuelve la red: se envía solo.
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: 'Con conexión' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/operaci(ón|ones) pendientes? de envío/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'OFFB02' })).not.toContainText('Sin enviar');

  // El servidor quedó con lo mismo que el guardia hizo sin red.
  const paid = await (await page.request.get('/api/visitors/payments?plate=OFFA01')).json();
  const rows = Array.isArray(paid) ? paid : paid.data;
  expect(rows.some((row: { plate: string }) => row.plate === 'OFFA01')).toBeTruthy();
  const open = await (await page.request.get('/api/visitors')).json();
  const openRows = Array.isArray(open) ? open : open.data;
  expect(openRows.some((row: { plate: string }) => row.plate === 'OFFB02')).toBeTruthy();
  expect(openRows.some((row: { plate: string }) => row.plate === 'OFFA01')).toBeFalsy();

  // Limpieza: se libera la plaza de OFFB02 para no afectar a otros specs.
  const offb = openRows.find((row: { plate: string }) => row.plate === 'OFFB02');
  expect((await page.request.post(`/api/visitors/${offb.id}/complete`)).ok()).toBeTruthy();
});
