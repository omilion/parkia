import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('el guardia imprime el ticket de entrada con el QR de pago y configura la impresora', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'guardia@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
  await page.goto('/operar');
  await expect(page.getByRole('status').filter({ hasText: 'Con conexión' })).toBeVisible();

  // Panel de la impresora (accesible y sin térmica: se usa la impresión del sistema).
  await page.getByRole('button', { name: /^Impresora/ }).click();
  const panel = page.getByRole('dialog', { name: 'Impresora de tickets' });
  await expect(panel.getByText(/Sin impresora térmica conectada/)).toBeVisible();
  await panel.getByLabel('Ancho del papel').selectOption('58');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(wcag).analyze()).violations).toEqual([]);
  await panel.getByRole('button', { name: 'Cerrar diálogo' }).click();
  await expect(panel).toHaveCount(0);

  // La preferencia de papel se recuerda.
  await page.reload();
  await page.getByRole('button', { name: /^Impresora/ }).click();
  await expect(page.getByLabel('Ancho del papel')).toHaveValue('58');
  await page.getByRole('button', { name: 'Cerrar diálogo' }).click();

  // Entrada: queda lista para imprimir (sin térmica no se abre ningún diálogo solo).
  await page.getByRole('button', { name: 'Entrada', exact: true }).click();
  const entry = page.getByRole('dialog', { name: 'Registrar entrada' });
  await entry.getByLabel('Patente').fill('PRT001');
  await entry.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText(/Entrada registrada: PRT001/)).toBeVisible();
  await expect(page.locator('iframe[data-parkia-print]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Imprimir ticket de entrada' }).click();
  const frame = page.frameLocator('iframe[data-parkia-print]');
  await expect(frame.locator('body')).toContainText('PRT001');
  await expect(frame.locator('body')).toContainText('TICKET DE ENTRADA');
  await expect(frame.locator('img[alt="Código QR de pago"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await page.locator('iframe[data-parkia-print]').evaluate(element => (element as HTMLIFrameElement).srcdoc)).toContain('size:58mm auto');

  // Limpieza: se libera la plaza.
  const open = await (await page.request.get('/api/visitors')).json();
  const row = (Array.isArray(open) ? open : open.data).find((item: { plate: string }) => item.plate === 'PRT001');
  expect((await page.request.post(`/api/visitors/${row.id}/complete`)).ok()).toBeTruthy();
});
