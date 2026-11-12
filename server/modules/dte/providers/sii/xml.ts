import iconv from "iconv-lite";

/**
 * Helpers XML para el SII. Los documentos se transmiten en ISO-8859-1, asi que todo texto
 * se limpia a caracteres representables en latin1 antes de construir el XML.
 */

const LATIN1_REPLACEMENTS: Record<string, string> = {
  "‘": "'", "’": "'", "“": "\"", "”": "\"",
  "–": "-", "—": "-", "…": "...", "€": "EUR", " ": " ",
};

/** Deja solo caracteres latin1 imprimibles, colapsa espacios y recorta al largo maximo. */
export function cleanText(value: unknown, maxLength?: number): string {
  let text = String(value ?? "")
    .normalize("NFC")
    .replace(/[‘’“”–—…€ ]/g, char => LATIN1_REPLACEMENTS[char] || " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength).trimEnd();
  return text;
}

/**
 * Escapa texto de contenido XML con el mismo criterio que la canonicalizacion C14N (& < >).
 * Asi el texto firmado del TED es identico al que el SII obtiene al re-serializar el documento.
 * VERIFICAR-SII: el Formato DTE menciona tambien comillas y apostrofes; dentro de contenido de
 * elementos son XML valido sin escapar, y escaparlos cambiaria la cadena firmada del TED.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type XmlChild = string | null | undefined | false;

/** Elemento con texto escapado. Devuelve "" si el valor es vacio y el elemento es opcional. */
export function el(name: string, value: unknown, options: { maxLength?: number; optional?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") {
    if (options.optional !== false) return "";
  }
  const text = typeof value === "number" ? String(value) : cleanText(value, options.maxLength);
  if (!text && options.optional !== false) return "";
  return `<${name}>${escapeXml(text)}</${name}>`;
}

/** Elemento contenedor. Omite el elemento completo si no tiene hijos. */
export function group(name: string, children: XmlChild[], attributes = "", keepEmpty = false): string {
  const content = children.filter(Boolean).join("");
  if (!content && !keepEmpty) return "";
  return `<${name}${attributes ? ` ${attributes}` : ""}>${content}</${name}>`;
}

/** Quita el espacio en blanco entre etiquetas (forma "aplanada" que usa el SII para el TED y el CAF). */
export function flattenXml(xml: string): string {
  return xml.replace(/>\s+</g, "><").trim();
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="ISO-8859-1"?>';

/** Codifica el XML final en ISO-8859-1 para enviarlo al SII. */
export function encodeLatin1(xml: string): Buffer {
  return iconv.encode(xml, "latin1");
}

export function decodeLatin1(buffer: Buffer | Uint8Array): string {
  return iconv.decode(Buffer.from(buffer), "latin1");
}

/** Hora local de Chile en formato YYYY-MM-DDTHH:MM:SS (sin zona), como pide el SII. */
export function chileTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export function chileDate(date = new Date()): string {
  return chileTimestamp(date).slice(0, 10);
}

/** Extrae el texto del primer elemento con ese nombre local (ignora prefijos). Para respuestas simples del SII. */
export function readTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return match ? match[1].trim() : null;
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}
