import { test, expect } from '@playwright/test';
import { createTestCaf, createTestPfx, PFX_PASSWORD, RUT_EMISOR } from '../dte/generators';
import { findTableScrollContainers } from './horizontalOverflow';

/**
 * Asistente de facturación electrónica. No se prueba la conexión con el SII: esta prueba nunca sale a internet.
 * Certificado y CAF son datos sintéticos generados en memoria.
 */

test('el asistente guía desde los datos de la empresa hasta dejar listo el envío', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'admin@parkia.local', password: 'admin123' } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/settings?tab=sii');

  await expect(page.getByRole('heading', { name: 'Facturación electrónica (SII)' })).toBeVisible();
  await expect(page.getByText('0 de 6 pasos')).toBeVisible();

  // Paso 1: el primer paso pendiente se abre solo y valida el RUT.
  const issuer = page.getByRole('form', { name: 'Datos del emisor' });
  await expect(issuer).toBeVisible();
  await issuer.getByLabel('RUT de la empresa').fill('76192083-0');
  await issuer.getByRole('button', { name: 'Guardar datos del emisor' }).click();
  await expect(issuer.getByText('RUT inválido')).toBeVisible();
  await expect(issuer.getByText('Completa la razón social')).toBeVisible();

  await issuer.getByLabel('RUT de la empresa').fill(RUT_EMISOR);
  await issuer.getByLabel('Razón social').fill('Estacionamientos E2E SpA');
  await issuer.getByLabel(/^Giro/).fill('Servicios de estacionamiento');
  await issuer.getByLabel('Códigos de actividad económica').fill('522130');
  await issuer.getByLabel(/^Dirección/).fill('Av. Siempre Viva 742');
  await issuer.getByLabel(/^Comuna/).fill('Ñuñoa');
  await issuer.getByLabel('Unidad del SII').fill('SANTIAGO ORIENTE');
  await issuer.getByRole('button', { name: 'Guardar datos del emisor' }).click();
  await expect(page.getByText('1 de 6 pasos')).toBeVisible();

  // Paso 2: certificado. Una clave incorrecta se explica; la correcta lo deja cargado.
  await page.getByRole('button', { name: /Certificado digital/ }).click();
  const certificate = page.getByRole('form', { name: 'Cargar certificado' });
  const pfx = { name: 'certificado.pfx', mimeType: 'application/x-pkcs12', buffer: createTestPfx() };
  await certificate.getByLabel('Archivo del certificado').setInputFiles(pfx);
  await certificate.getByLabel('Clave del certificado').fill('clave-incorrecta');
  await certificate.getByRole('button', { name: 'Cargar certificado' }).click();
  await expect(certificate.getByRole('alert')).toContainText('clave del certificado es incorrecta');
  await certificate.getByLabel('Clave del certificado').fill(PFX_PASSWORD);
  await certificate.getByRole('button', { name: 'Cargar certificado' }).click();
  await expect(page.getByText('2 de 6 pasos')).toBeVisible();
  await expect(page.getByText('TITULAR DE PRUEBA PARKIA').first()).toBeVisible();
  // La clave nunca se vuelve a mostrar.
  await expect(page.getByText(PFX_PASSWORD)).toHaveCount(0);

  // Paso 4: folios. Un CAF de otro RUT se rechaza.
  await page.getByRole('button', { name: /Folios autorizados/ }).click();
  const caf = page.getByRole('form', { name: 'Cargar folios CAF' });
  await caf.getByLabel('Archivo CAF').setInputFiles({ name: 'ajeno.xml', mimeType: 'text/xml', buffer: Buffer.from(createTestCaf({ rut: '77777777-7' }), 'latin1') });
  await caf.getByRole('button', { name: 'Cargar folios' }).click();
  await expect(caf.getByRole('alert')).toContainText('RUT');
  await caf.getByLabel('Archivo CAF').setInputFiles({ name: 'folios.xml', mimeType: 'text/xml', buffer: Buffer.from(createTestCaf({ type: 39, from: 1, to: 20 }), 'latin1') });
  await caf.getByRole('button', { name: 'Cargar folios' }).click();
  await expect(page.getByText('3 de 6 pasos')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Folios cargados' })).toContainText('1 al 20');

  // Paso 6: producción bloqueada con la razón a la vista.
  await page.getByRole('button', { name: /Pasar a producción/ }).click();
  const goLive = page.getByRole('form', { name: 'Pasar a producción' });
  await expect(goLive).toContainText('la producción no está habilitada en este servidor');
  await expect(goLive.getByRole('button', { name: 'Pasar a producción' })).toBeDisabled();

  // El asistente no desborda en teléfono.
  const overflowing = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.right > window.innerWidth + 1; })
    .slice(0, 5).map(element => `${element.tagName}.${String(element.className).slice(0, 50)} right=${Math.round(element.getBoundingClientRect().right)}`));
  expect(overflowing).toEqual([]);
  expect(await page.evaluate(findTableScrollContainers)).toEqual([]);
});

test('solo el administrador ve la pestaña de facturación electrónica con datos', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { email: 'guardia@parkia.local', password: 'Cambiar123!' } })).ok()).toBeTruthy();
  const response = await page.request.get('/api/dte/onboarding');
  expect(response.status()).toBe(403);
});
