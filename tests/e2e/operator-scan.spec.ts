import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('el cajero escanea el QR del ticket con la cámara y ve el cobro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'caja@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();

  // Un ticket con una hora de estadía y su QR (el token que se imprime en el ticket de entrada).
  const created = await page.request.post('/api/visitors', { data: { plate: 'SCN001' } });
  expect(created.ok()).toBeTruthy();
  const { ticketId, public_token: token } = (await created.json()).ticket as { ticketId: number; public_token: string };
  expect((await page.request.post(`/__e2e__/age-ticket/${ticketId}`)).ok()).toBeTruthy();

  // Cámara simulada: un video sintético y un lector que "ve" primero un código ajeno y luego el del ticket.
  await page.addInitScript(({ qr }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 320;
    const context = canvas.getContext('2d')!;
    // Un canvas sin cambios no emite cuadros: se redibuja para que el video "avance" como una cámara real.
    let tick = 0;
    setInterval(() => { context.fillStyle = tick++ % 2 ? '#334155' : '#475569'; context.fillRect(0, 0, 320, 320); }, 50);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
    // El lector ve un código ajeno durante 1,5 s y luego el del ticket.
    let startedAt = 0;
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      async detect() {
        startedAt ||= Date.now();
        return [{ rawValue: Date.now() - startedAt < 1500 ? 'https://promo.example.com/oferta' : qr }];
      }
    };
  }, { qr: `http://127.0.0.1:4178/pagar/${token}` });

  await page.goto('/operar');
  await expect(page.getByText('SCN001')).toBeVisible();
  await page.getByRole('button', { name: 'Salida / Cobrar' }).click();
  const exit = page.getByRole('dialog', { name: 'Salida y cobro' });
  await exit.getByRole('button', { name: 'Escanear QR del ticket' }).click();

  const scanner = page.getByRole('dialog', { name: 'Escanear QR del ticket' });
  await expect(scanner.getByLabel('Vista de la cámara')).toBeVisible();
  await expect(scanner.getByText(/no es de un ticket de Parkia/)).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(wcag).analyze()).violations).toEqual([]);

  // Al leer el QR del ticket se cierra la cámara y aparece el cobro de SCN001.
  await expect(scanner).toHaveCount(0);
  await expect(exit.getByText('SCN001')).toBeVisible();
  await expect(exit.getByText('Total a cobrar')).toBeVisible();

  // Limpieza.
  await exit.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(exit.getByText('Ticket pagado. Puedes registrar la salida.')).toBeVisible();
  await exit.getByRole('button', { name: 'Registrar salida' }).click();
  await expect(page.getByText('Salida registrada para SCN001.')).toBeVisible();
});

test('sin permiso de cámara se explica y se puede seguir con la patente', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post('/api/auth/login', { data: { email: 'caja@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  });
  await page.goto('/operar');
  await page.getByRole('button', { name: 'Salida / Cobrar' }).click();
  const exit = page.getByRole('dialog', { name: 'Salida y cobro' });
  await exit.getByRole('button', { name: 'Escanear QR del ticket' }).click();
  const scanner = page.getByRole('dialog', { name: 'Escanear QR del ticket' });
  await expect(scanner.getByRole('alert')).toContainText('No hay permiso para usar la cámara');
  await scanner.getByRole('button', { name: 'Cancelar' }).click();
  await expect(exit.getByLabel('Patente')).toBeVisible();
});
