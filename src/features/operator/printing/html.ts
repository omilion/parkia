import QRCode from 'qrcode';
import type { ReceiptBlock, ReceiptDocument } from './document';
import type { PaperWidth } from './escpos';

/**
 * Versión HTML del recibo para el diálogo de impresión del sistema (respaldo cuando no hay impresora térmica
 * conectada: iPhone/Safari, impresoras de red, "Guardar como PDF"). Mide 58 u 80 mm con `@page`.
 */

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sizeCss = { 1: '1em', 2: '1.6em', 3: '2.4em' } as const;

async function blockHtml(block: ReceiptBlock): Promise<string> {
  switch (block.type) {
    case 'text':
      return `<p style="text-align:${block.align ?? 'left'};font-weight:${block.bold ? 700 : 400};font-size:${sizeCss[block.size ?? 1]};margin:2px 0">${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`;
    case 'row':
      return `<p style="display:flex;justify-content:space-between;gap:8px;margin:2px 0;font-weight:${block.bold ? 700 : 400}"><span>${escapeHtml(block.left)}</span><span>${escapeHtml(block.right)}</span></p>`;
    case 'rule':
      return '<hr style="border:0;border-top:1px dashed #000;margin:6px 0">';
    case 'feed':
      return `<div style="height:${(block.lines ?? 1) * 0.6}em"></div>`;
    case 'qr': {
      const url = await QRCode.toDataURL(block.value, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
      return `<div style="text-align:center"><img alt="Código QR de pago" src="${url}" width="150" height="150" style="image-rendering:pixelated">${block.caption ? `<p style="margin:2px 0">${escapeHtml(block.caption)}</p>` : ''}</div>`;
    }
    case 'image':
      return `<div style="text-align:center"><img alt="Timbre electrónico" src="data:image/png;base64,${block.pngBase64}" style="max-width:100%;image-rendering:pixelated">${block.caption ? `<p style="margin:2px 0;font-size:.85em">${escapeHtml(block.caption).replace(/\n/g, '<br>')}</p>` : ''}</div>`;
  }
}

export async function renderReceiptHtml(doc: ReceiptDocument, paper: PaperWidth) {
  const body = (await Promise.all(doc.blocks.map(blockHtml))).join('\n');
  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>@page{size:${paper}mm auto;margin:2mm}html,body{margin:0;padding:0}body{width:${paper - 4}mm;font:12px/1.35 'Courier New',monospace;color:#000}img{display:block;margin:4px auto}</style></head>
<body>${body}</body></html>`;
}

/** Abre el diálogo de impresión del sistema con el recibo. El marco queda en la página hasta terminar de imprimir. */
export function printHtml(html: string) {
  return new Promise<void>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('data-parkia-print', 'true');
    frame.setAttribute('title', 'Vista de impresión');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('No se pudo abrir la impresión'));
      }
      window.setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
