import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'finance@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
});

test('las rutas financieras conservan enlaces antiguos, recarga e historial', async ({ page }) => {
  await page.goto('/finance?tab=expenses');
  await expect(page).toHaveURL(/\/finanzas\/gastos$/);
  await expect(page.getByRole('tab', { name: 'Gastos', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Banco', exact: true }).click();
  await expect(page).toHaveURL(/\/finanzas\/banco$/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Banco', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Gastos', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Cierres', exact: true }).click();
  await expect(page).toHaveURL(/\/finanzas\/cierres$/);
  await expect(page.getByRole('heading', { name: 'Cierre Mensual Formal' })).toBeVisible();
});

test('abrir pagos no descarga las páginas ni los datos de gastos, DTE y reportes', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto('/finanzas/pagos', { waitUntil: 'networkidle' });
  await expect(page.getByRole('region', { name: 'Cuentas por cobrar' })).toBeVisible();
  expect(requests.filter(path => /\/api\/finance\/(expenses|invoices|reports)/.test(path))).toEqual([]);
  expect(requests.filter(path => /\/(ExpensesPage|InvoicesPage|ReportsPage|ClosuresPage)-.*\.js$/.test(path))).toEqual([]);
});

test('un error de carga de pagos se presenta sin quedar cargando indefinidamente', async ({ page }) => {
  await page.route('**/api/finance/payments', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fallo de prueba en cuentas' }) }));
  await page.goto('/finanzas/pagos');
  await expect(page.getByText('Fallo de prueba en cuentas', { exact: true })).toBeVisible({ timeout: 10000 });
});

test('una pestaña antigua desconocida se redirige a pagos', async ({ page }) => {
  await page.goto('/finance?tab=constructor');
  await expect(page).toHaveURL(/\/finanzas\/pagos$/);
  await expect(page.getByRole('region', { name: 'Cuentas por cobrar' })).toBeVisible();
});

test('finanzas registra el pago de un abonado desde teléfono', async ({ page }) => {
  const payments = await (await page.request.get('/api/finance/payments')).json();
  const payment = payments.find((item: { status: string; remaining_amount?: number; amount: number }) => ['pending', 'overdue'].includes(item.status) && (item.remaining_amount ?? item.amount) > 0);
  expect(payment).toBeTruthy();
  await page.goto('/finanzas/pagos');
  const row = page.getByRole('region', { name: 'Cuentas por cobrar' }).locator('article').filter({ hasText: `#PAG-${String(payment.id).padStart(4, '0')}` });
  await row.getByRole('button', { name: 'Registrar Pago', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar Pago Manual' });
  await dialog.getByLabel('Nota operacional', { exact: true }).fill('ab');
  await dialog.getByRole('button', { name: 'Registrar pago y preparar DTE' }).click();
  await expect(dialog.getByRole('alert')).toContainText('3 caracteres');
  await dialog.getByLabel('Nota operacional', { exact: true }).fill('Pago en efectivo validado en prueba de caja');
  await dialog.getByRole('button', { name: 'Registrar pago y preparar DTE' }).click();
  await expect(dialog).toHaveCount(0);
  const detail = await (await page.request.get(`/api/finance/payments/${payment.id}/detail`)).json();
  expect(detail.payment.status).toBe('paid');
});
