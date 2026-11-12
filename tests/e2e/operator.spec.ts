import { test, expect } from '@playwright/test';

for (const [email, plate] of [['guardia@parkia.local', 'GHTR81'], ['caja@parkia.local', 'CJTR82']]) {
  test(`entrada, cobro y salida en teléfono: ${email}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const login = await page.request.post('/api/auth/login', { data: { email, password: 'Cambiar123!' } });
    expect(login.ok()).toBeTruthy();
    await page.goto('/operar');
    await expect(page.getByRole('heading', { name: 'Operar' })).toBeVisible();
    await expect(page.getByLabel('Sucursal')).toHaveValue(/\d+/);
    await page.getByRole('button', { name: 'Entrada', exact: true }).click();
    const entry = page.getByRole('dialog', { name: 'Registrar entrada' });
    await entry.getByLabel('Patente').fill(plate);
    await entry.getByRole('button', { name: 'Registrar entrada' }).click();
    await expect(entry).toHaveCount(0);
    await expect(page.getByText(new RegExp(`Entrada registrada: ${plate}`))).toBeVisible();
    await page.getByRole('button', { name: 'Salida / Cobrar' }).click();
    const exit = page.getByRole('dialog', { name: 'Salida y cobro' });
    await exit.getByLabel('Patente').fill(plate);
    await exit.getByRole('button', { name: 'Buscar ticket' }).click();
    await expect(exit.getByText('Total a cobrar')).toBeVisible();
    await exit.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(exit.getByText('Ticket pagado. Puedes registrar la salida.')).toBeVisible();
    await exit.getByRole('button', { name: 'Registrar salida' }).click();
    await expect(exit).toHaveCount(0);
    await expect(page.getByText(`Salida registrada para ${plate}.`)).toBeVisible();
    await page.getByRole('button', { name: 'Ver caja y cierre' }).click();
    const cash = page.getByRole('dialog', { name: 'Caja y cierre' });
    await cash.getByRole('button', { name: 'Continuar al conteo' }).click();
    await cash.getByLabel('Efectivo contado').fill('0');
    await cash.getByLabel('Tarjeta contada').fill('0');
    await cash.getByLabel('Transferencia contada').fill('0');
    await cash.getByRole('button', { name: 'Revisar cierre' }).click();
    await cash.getByRole('button', { name: 'Confirmar cierre de caja' }).click();
    await expect(cash).toHaveCount(0);
    await expect(page.getByText(/Caja cerrada/)).toBeVisible();
  });
}

test('el cierre por identificador no permite cerrar la caja de otro usuario', async ({ playwright }) => {
  const guard = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4178' });
  const cashier = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4178' });
  try {
    expect((await guard.post('/api/auth/login', { data: { email: 'guardia@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
    expect((await cashier.post('/api/auth/login', { data: { email: 'caja@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
    const cash = await cashier.get('/api/visitors/cash/current');
    expect(cash.ok()).toBeTruthy();
    const cashId = (await cash.json()).session.id;
    const attempted = await guard.post('/api/visitors/cash/current/close', { data: { cash_session_id: cashId, counted_cash: 0, counted_card: 0, counted_transfer: 0 } });
    expect(attempted.ok()).toBeFalsy();
    const stillOpen = await cashier.get('/api/visitors/cash/current');
    expect((await stillOpen.json()).session.id).toBe(cashId);
  } finally {
    await guard.dispose();
    await cashier.dispose();
  }
});
