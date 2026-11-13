import { test, expect } from '@playwright/test';

test('recuperar la clave: pedir el enlace y elegir una clave nueva', async ({ page, request, browser }) => {
  // Un usuario propio para no tocar la clave del administrador que usan los demás specs.
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  const email = 'recupera-e2e@parkia.local';
  const created = await page.request.post('/api/staff', { data: { name: 'Recupera E2E', rut: '54.444.444-4', email, phone: '', role: 'guard', password: 'Cambiar123!' } });
  expect(created.ok()).toBeTruthy();

  // Desde la pantalla de ingreso (sin sesión).
  const visitor = await browser.newContext({ baseURL: 'http://127.0.0.1:4178', viewport: { width: 390, height: 844 } });
  const login = await visitor.newPage();
  await login.goto('/');
  await login.getByRole('button', { name: '¿Olvidaste tu clave?' }).click();
  await login.getByLabel('Email').fill(email);
  await login.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(login.getByRole('status')).toContainText('Si el correo está registrado');

  // En pruebas el servidor devuelve el token (en produccion solo viaja por correo).
  const token = (await (await request.post('/api/auth/forgot-password', { data: { email } })).json()).reset_token as string;
  expect(token).toHaveLength(64);

  const reset = await visitor.newPage();
  await reset.goto('/restablecer?token=invalido-pero-largo');
  await reset.getByLabel('Clave nueva', { exact: true }).fill('OtraClaveSegura2026!');
  await reset.getByLabel('Repite la clave').fill('OtraClaveSegura2026!');
  await reset.getByRole('button', { name: 'Guardar clave nueva' }).click();
  await expect(reset.getByRole('alert')).toBeVisible();

  await reset.goto(`/restablecer?token=${token}`);
  await reset.getByLabel('Clave nueva', { exact: true }).fill('OtraClaveSegura2026!');
  await reset.getByLabel('Repite la clave').fill('distinta');
  await reset.getByRole('button', { name: 'Guardar clave nueva' }).click();
  await expect(reset.getByText('La nueva clave no coincide')).toBeVisible();
  await reset.getByLabel('Repite la clave').fill('OtraClaveSegura2026!');
  await reset.getByRole('button', { name: 'Guardar clave nueva' }).click();
  await expect(reset.getByRole('status')).toContainText('Tu clave fue cambiada');

  // La clave nueva funciona y la anterior ya no.
  const attempt = (password: string) => request.post('/api/auth/login', { data: { email, password } });
  expect((await attempt('OtraClaveSegura2026!')).ok()).toBeTruthy();
  expect((await attempt('Cambiar123!')).ok()).toBeFalsy();
  await visitor.close();
});
