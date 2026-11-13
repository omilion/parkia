import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * Genera los iconos de la PWA (public/icons/*.png) a partir de un SVG, usando Chromium de Playwright.
 * Uso: npx tsx scripts/generate-pwa-icons.ts
 *
 * - icon-192 / icon-512: icono normal con esquinas redondeadas.
 * - icon-maskable-512: fondo a sangre; la "P" queda dentro de la zona segura (80 % central) para que
 *   Android pueda recortarlo en circulo o cuadrado sin cortar la marca.
 * - apple-touch-icon (180): iOS aplica su propio recorte, por eso va a sangre.
 */

const BRAND = "#4f46e5";

const glyph = (scale: number) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M168 120h118c62 0 100 36 100 90s-38 90-100 90h-62v92h-56V120zm56 48v84h56c30 0 48-14 48-42s-18-42-48-42h-56z" fill="#ffffff" fill-rule="evenodd"/>
  </g>`;

const svg = (kind: "rounded" | "bleed") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${kind === "rounded" ? 'rx="112"' : ""} fill="${BRAND}"/>${glyph(kind === "rounded" ? 1 : 0.8)}
</svg>`;

const targets = [
  { file: "icon-192.png", size: 192, kind: "rounded" as const },
  { file: "icon-512.png", size: 512, kind: "rounded" as const },
  { file: "icon-maskable-512.png", size: 512, kind: "bleed" as const },
  { file: "apple-touch-icon.png", size: 180, kind: "bleed" as const },
];

const outDir = join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: target.size, height: target.size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(target.kind).replace('width="512" height="512"', `width="${target.size}" height="${target.size}"`)}</body></html>`);
    await page.screenshot({ path: join(outDir, target.file), omitBackground: true, clip: { x: 0, y: 0, width: target.size, height: target.size } });
    await page.close();
    console.log(`public/icons/${target.file}`);
  }
} finally {
  await browser.close();
}
