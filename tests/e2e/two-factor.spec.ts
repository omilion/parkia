import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateTotpCode } from '../../server/platform/auth/totp';

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const EMAIL = 'dospasos-e2e@parkia.local';
const PASSWORD = 'ClaveSegura2026!x';

async function signIn(page: Page, code?: string) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Clave', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  if (code !== undefined) {
    // El servidor pide el código recién después de validar la clave.
    await expect(page.getByLabel('Código de verificación')).toBeVisible();
    await page.getByLabel('Código de verificación').fill(code);
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  }
}

test('el administrador activa la verificación en dos pasos, guarda los códigos y entra con ellos', async ({ page, browser }) => {
  // Un administrador propio para no tocar la cuenta que usan los demás specs.
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  const created = await page.request.post('/api/staff', { data: { name: 'Dos Pasos E2E', rut: '55.555.555-5', email: EMAIL, phone: '', role: 'admin', password: 'Cambiar123!' } });
  expect(created.ok()).toBeTruthy();
  const own = await browser.newContext({ baseURL: 'http://127.0.0.1:4178' });
  expect((await own.request.post('/api/auth/login', { data: { email: EMAIL, password: 'Cambiar123!' } })).ok()).toBeTruthy();
  expect((await own.request.post('/api/auth/change-password', { data: { current_password: 'Cambiar123!', new_password: PASSWORD } })).ok()).toBeTruthy();
  await own.close();

  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4178', viewport: { width: 390, height: 844 } });
  const app = await context.newPage();
  await signIn(app);

  // Activar: QR + clave manual, código de 6 dígitos y códigos de recuperación.
  await app.getByRole('button', { name: 'Verificación en dos pasos' }).click();
  await app.getByRole('button', { name: 'Activar verificación en dos pasos' }).click();
  await expect(app.getByAltText('Código QR para tu aplicación de autenticación')).toBeVisible();
  expect((await new AxeBuilder({ page: app }).include('[role="dialog"]').withTags(wcag).analyze()).violations).toEqual([]);
  await app.getByText('¿No puedes escanear?').click();
  const secret = (await app.getByTestId('totp-secret').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await app.getByLabel('Código de 6 dígitos').fill('000000');
  await app.getByRole('button', { name: 'Confirmar y activar' }).click();
  const dialog = app.getByRole('dialog', { name: 'Verificación en dos pasos' });
  await expect(dialog.getByRole('alert')).toContainText('El código no es válido');

  await app.getByLabel('Código de 6 dígitos').fill(generateTotpCode(secret));
  await app.getByRole('button', { name: 'Confirmar y activar' }).click();
  const codes = await app.getByRole('list', { name: 'Códigos de recuperación' }).getByRole('listitem').allInnerTexts();
  expect(codes).toHaveLength(8);
  expect((await new AxeBuilder({ page: app }).include('[role="dialog"]').withTags(wcag).analyze()).violations).toEqual([]);

  // No se puede cerrar sin confirmar que se guardaron.
  await expect(app.getByRole('button', { name: 'Listo' })).toBeDisabled();
  await expect(app.getByRole('button', { name: 'Cerrar diálogo' })).toHaveCount(0);
  await app.getByLabel('Ya guardé mis códigos en un lugar seguro').check();
  await app.getByRole('button', { name: 'Listo' }).click();
  await expect(app.getByRole('dialog')).toHaveCount(0);

  // Ingresar de nuevo pide el código. El de la activación ya se usó: sirve el del siguiente intervalo.
  await app.getByRole('button', { name: 'Cerrar sesión' }).click();
  await signIn(app, '123456');
  await expect(app.getByRole('alert')).toContainText('no es válido');
  await app.getByLabel('Código de verificación').fill(generateTotpCode(secret, Date.now() + 30_000));
  await app.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(app.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();

  // Un código de recuperación entra una sola vez.
  await app.getByRole('button', { name: 'Cerrar sesión' }).click();
  await signIn(app, codes[0]);
  await expect(app.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  await app.getByRole('button', { name: 'Cerrar sesión' }).click();
  await signIn(app, codes[0]);
  await expect(app.getByRole('alert')).toContainText('no es válido');

  // Desactivar con la clave.
  await app.getByLabel('Código de verificación').fill(codes[1]);
  await app.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await app.getByRole('button', { name: 'Verificación en dos pasos' }).click();
  await expect(app.getByRole('status').filter({ hasText: 'está activa' })).toBeVisible();
  await app.getByLabel('Tu clave').fill('incorrecta');
  await app.getByRole('button', { name: 'Desactivar' }).click();
  await expect(app.getByRole('dialog').getByRole('alert')).toContainText('no es correcta');
  await app.getByLabel('Tu clave').fill(PASSWORD);
  await app.getByRole('button', { name: 'Desactivar' }).click();
  await expect(app.getByRole('status').filter({ hasText: 'quedó desactivada' })).toBeVisible();
  await context.close();
});
