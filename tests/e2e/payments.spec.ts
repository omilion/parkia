import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('el cliente paga su ticket desde el QR con la pasarela simulada', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();

  // El administrador activa la pasarela simulada desde Configuración.
  await page.goto('/settings?tab=payments');
  await expect(page.getByRole('heading', { name: 'Pagos en línea', exact: true })).toBeVisible();
  const mock = page.getByRole('form', { name: /Pago simulado/ });
  await mock.getByLabel('Aceptar pagos con esta forma de pago').check();
  await mock.getByRole('button', { name: 'Guardar' }).click();
  await expect(mock.getByText('Configuración guardada.')).toBeVisible();

  // Un ticket con una hora de estadía y su enlace de pago.
  const created = await page.request.post('/api/visitors', { data: { plate: 'QRPAY1' } });
  expect(created.ok()).toBeTruthy();
  const ticketId = (await created.json()).ticket.ticketId as number;
  expect((await page.request.post(`/__e2e__/age-ticket/${ticketId}`)).ok()).toBeTruthy();
  const link = await (await page.request.get(`/api/visitors/${ticketId}/pay-link`)).json();

  // El cliente (sin sesion) abre el enlace, ve el monto y paga.
  const customer = await browser.newContext({ baseURL: 'http://127.0.0.1:4178', viewport: { width: 390, height: 844 } });
  const phone = await customer.newPage();
  await phone.goto(link.path);
  await expect(phone.getByRole('heading', { name: 'Pagar mi estacionamiento' })).toBeVisible();
  await expect(phone.getByText('QRPAY1')).toBeVisible();
  await expect(phone.getByText('Total a pagar')).toBeVisible();
  expect((await new AxeBuilder({ page: phone }).withTags(wcag).analyze()).violations).toEqual([]);
  await phone.getByRole('button', { name: /Pago simulado/ }).click();
  await expect(phone.getByText('Pasarela simulada · no se cobra dinero real')).toBeVisible();
  expect((await new AxeBuilder({ page: phone }).withTags(wcag).analyze()).violations).toEqual([]);
  await phone.getByRole('button', { name: 'Aprobar pago' }).click();
  await expect(phone.getByText('¡Pago recibido! Ya puedes retirarte.')).toBeVisible();
  await expect(phone.getByText('Pago confirmado')).toBeVisible();
  await customer.close();

  // El ticket quedo pagado por confirmacion de la pasarela.
  const tickets = await (await page.request.get('/api/visitors')).json();
  const paid = (Array.isArray(tickets) ? tickets : tickets.data).find((item: { id: number }) => item.id === ticketId);
  expect(paid.status).toBe('paid');

  // Se libera la plaza para no afectar a otros specs que comparten la base de demostracion.
  expect((await page.request.post(`/api/visitors/${ticketId}/complete`)).ok()).toBeTruthy();
});

test('un enlace de pago inexistente muestra un error claro', async ({ page }) => {
  await page.goto('/pagar/t_enlace-que-no-existe');
  await expect(page.getByRole('alert')).toContainText('no es válido');
});
