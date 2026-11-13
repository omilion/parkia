import QRCode from 'qrcode';
import type { Align, ReceiptBlock, ReceiptDocument } from './document';

/**
 * Codificador ESC/POS para impresoras térmicas de 58 y 80 mm.
 *
 * Decisiones de compatibilidad:
 *  - Los textos van en CP858 (acentos y ñ del español) con `ESC t 19`, que casi todas las térmicas traen.
 *  - QR y timbre PDF417 se imprimen como imagen (trama, `GS v 0`): los comandos nativos de códigos de barras
 *    cambian entre marcas y en las baratas faltan; una imagen funciona en todas.
 *  - Las imágenes se envían en franjas de 64 filas para no desbordar el búfer de impresoras pequeñas.
 */

export type PaperWidth = 58 | 80;
export const PAPER: Record<PaperWidth, { columns: number; dots: number }> = {
  58: { columns: 32, dots: 384 },
  80: { columns: 48, dots: 576 },
};

/** Imagen en blanco y negro: `data[y * width + x]` es 1 (negro) o 0 (blanco). */
export type Bitmap = { width: number; height: number; data: Uint8Array };

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Caracteres del español (y algunos habituales) en CP858. Lo que no está se imprime como "?".
const CP858: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b,
  'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'Ö': 0x99, 'Ü': 0x9a,
  '£': 0x9c, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '¿': 0xa8, '¡': 0xad, '«': 0xae,
  '»': 0xaf, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, '°': 0xf8, '€': 0xd5, '·': 0xfa, '×': 0x9e,
};

export function encodeCp858(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x0a) bytes.push(LF);
    else if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else bytes.push(CP858[char] ?? 0x3f);
  }
  return bytes;
}

/** Parte un texto en líneas de hasta `columns` caracteres, cortando por palabras (y palabras demasiado largas). */
export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > columns) {
        if (current) { lines.push(current); current = ''; }
        lines.push(rest.slice(0, columns));
        rest = rest.slice(columns);
      }
      if (!current) current = rest;
      else if (current.length + 1 + rest.length <= columns) current += ` ${rest}`;
      else { lines.push(current); current = rest; }
    }
    lines.push(current);
  }
  return lines;
}

/** `izquierda      derecha` en exactamente `columns` caracteres; si no cabe, se recorta la izquierda (nunca la derecha: es el monto). */
export function rowLine(left: string, right: string, columns: number) {
  const value = right.slice(0, columns);
  const room = columns - value.length - 1; // siempre al menos un espacio entre ambos
  const clipped = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}.` : left;
  return clipped + ' '.repeat(Math.max(1, columns - clipped.length - value.length)) + value;
}

// ------------------------------------------------------------------ imagenes
/** Codifica una imagen como franjas `GS v 0` (modo normal, 8 puntos por byte, bit más alto a la izquierda). */
export function rasterCommands(bitmap: Bitmap, stripRows = 64): number[] {
  const bytesPerRow = Math.ceil(bitmap.width / 8);
  const out: number[] = [];
  for (let top = 0; top < bitmap.height; top += stripRows) {
    const rows = Math.min(stripRows, bitmap.height - top);
    out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (let y = top; y < top + rows; y++) {
      for (let byte = 0; byte < bytesPerRow; byte++) {
        let value = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byte * 8 + bit;
          if (x < bitmap.width && bitmap.data[y * bitmap.width + x]) value |= 0x80 >> bit;
        }
        out.push(value);
      }
    }
  }
  return out;
}

/** Centra la imagen en una hoja blanca del ancho exacto del papel (no todas las impresoras alinean imágenes con ESC a). */
export function centerOnPaper(bitmap: Bitmap, paperDots: number): Bitmap {
  if (bitmap.width >= paperDots) return bitmap;
  const left = Math.floor((paperDots - bitmap.width) / 2);
  const data = new Uint8Array(paperDots * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) data.set(bitmap.data.subarray(y * bitmap.width, (y + 1) * bitmap.width), y * paperDots + left);
  return { width: paperDots, height: bitmap.height, data };
}

/** Reduce una imagen que no cabe en el papel (promedio por bloque y umbral). Las que ya caben no se tocan. */
export function fitBitmap(bitmap: Bitmap, maxWidth: number): Bitmap {
  if (bitmap.width <= maxWidth) return bitmap;
  const scale = maxWidth / bitmap.width;
  const width = maxWidth;
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale), x1 = Math.max(x0 + 1, Math.min(bitmap.width, Math.floor((x + 1) / scale)));
      const y0 = Math.floor(y / scale), y1 = Math.max(y0 + 1, Math.min(bitmap.height, Math.floor((y + 1) / scale)));
      let black = 0, total = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { black += bitmap.data[yy * bitmap.width + xx]; total += 1; }
      data[y * width + x] = black * 2 >= total ? 1 : 0;
    }
  }
  return { width, height, data };
}

/** QR como imagen: módulo = `scale` puntos, con la zona silenciosa de 4 módulos que exige el estándar. */
export function qrBitmap(value: string, paperDots: number): Bitmap {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const quiet = 4;
  const scale = Math.max(2, Math.min(8, Math.floor((paperDots * 0.75) / (size + quiet * 2))));
  const width = (size + quiet * 2) * scale;
  const data = new Uint8Array(width * width);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qr.modules.data[row * size + col]) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) data[((row + quiet) * scale + dy) * width + (col + quiet) * scale + dx] = 1;
    }
  }
  return { width, height: width, data };
}

/** Convierte píxeles RGBA (de un canvas) a blanco y negro: oscuro y opaco = negro. */
export function bitmapFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Bitmap {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const alpha = rgba[i * 4 + 3];
    const luminance = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
    data[i] = alpha > 127 && luminance < 128 ? 1 : 0;
  }
  return { width, height, data };
}

/** Decodifica un PNG en base64 a blanco y negro usando el navegador. */
export async function loadPngBitmap(pngBase64: string): Promise<Bitmap> {
  const bytes = Uint8Array.from(atob(pngBase64), char => char.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return bitmapFromRgba(pixels.data, pixels.width, pixels.height);
}

// ------------------------------------------------------------------ constructor
export class EscPos {
  private bytes: number[] = [];
  init() { this.bytes.push(ESC, 0x40, ESC, 0x74, 19); return this; } // reset + tabla de caracteres CP858
  align(align: Align) { this.bytes.push(ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0); return this; }
  bold(on: boolean) { this.bytes.push(ESC, 0x45, on ? 1 : 0); return this; }
  size(scale: 1 | 2 | 3) { const n = scale - 1; this.bytes.push(GS, 0x21, (n << 4) | n); return this; }
  text(value: string) { this.bytes.push(...encodeCp858(value)); return this; }
  line(value = '') { return this.text(value).feed(0, true); }
  feed(lines: number, single = false) { if (single) this.bytes.push(LF); else if (lines > 0) this.bytes.push(ESC, 0x64, Math.min(lines, 255)); return this; }
  image(bitmap: Bitmap) { this.bytes.push(...rasterCommands(bitmap)); return this; }
  cut() { this.bytes.push(GS, 0x56, 0x42, 0x00); return this; } // avanza y corta (parcial)
  toBytes() { return Uint8Array.from(this.bytes); }
}

/**
 * Dibuja el documento como bytes ESC/POS. `loadImage` decodifica las imágenes PNG del documento
 * (en el navegador, `loadPngBitmap`; en pruebas, una función falsa).
 */
export async function renderEscPos(
  doc: ReceiptDocument,
  options: { paper: PaperWidth },
  loadImage: (pngBase64: string) => Promise<Bitmap> = loadPngBitmap,
): Promise<Uint8Array> {
  const { columns, dots } = PAPER[options.paper];
  const printer = new EscPos().init();

  const text = (block: Extract<ReceiptBlock, { type: 'text' }>) => {
    const size = block.size ?? 1;
    printer.align(block.align ?? 'left').bold(Boolean(block.bold)).size(size);
    for (const line of wrapText(block.text, Math.floor(columns / size))) printer.line(line);
    printer.size(1).bold(false);
  };

  for (const block of doc.blocks) {
    switch (block.type) {
      case 'text': text(block); break;
      case 'row': printer.align('left').bold(Boolean(block.bold)).line(rowLine(block.left, block.right, columns)).bold(false); break;
      case 'rule': printer.align('left').line('-'.repeat(columns)); break;
      case 'feed': printer.feed(block.lines ?? 1); break;
      case 'qr':
        printer.align('center').image(centerOnPaper(qrBitmap(block.value, dots), dots));
        if (block.caption) text({ type: 'text', text: block.caption, align: 'center' });
        break;
      case 'image':
        printer.align('center').image(centerOnPaper(fitBitmap(await loadImage(block.pngBase64), dots), dots));
        if (block.caption) text({ type: 'text', text: block.caption, align: 'center' });
        break;
    }
  }
  return printer.cut().toBytes();
}
