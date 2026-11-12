import { createPrivateKey, createPublicKey, KeyObject } from "node:crypto";
import { DOMParser, type Element, type Document } from "@xmldom/xmldom";
import type { DteType, SiiEnvironment } from "../../types";
import { normalizeRut } from "./rut";
import { decodeLatin1, flattenXml } from "./xml";

/**
 * Codigo de Autorizacion de Folios (CAF). Lo descarga el contribuyente desde sii.cl por tipo
 * de documento; contiene el rango autorizado y la clave privada RSA con que se firma el TED.
 */

export type ParsedCaf = {
  rutEmisor: string;
  razonSocial: string;
  type: DteType;
  folioFrom: number;
  folioTo: number;
  authorizedAt: string;
  /** IDK identifica la clave del SII que firmo el CAF. */
  idk: number;
  environment: SiiEnvironment;
  /** Elemento <CAF> aplanado, tal cual se copia dentro del TED. */
  cafXml: string;
  privateKey: KeyObject;
  privateKeyPem: string;
  publicKey: KeyObject;
  /** Vencimiento estimado; null si el tipo no vence. */
  expiresAt: string | null;
};

export class CafError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CafError";
  }
}

const SUPPORTED_TYPES: DteType[] = [33, 34, 39, 41, 56, 61];

function text(parent: Element | Document, tag: string): string {
  const node = parent.getElementsByTagName(tag)[0];
  return node?.textContent?.trim() || "";
}

/** Acepta el archivo tal como lo entrega el SII (suele venir en ISO-8859-1). */
export function readCafFile(content: Buffer | string): string {
  if (typeof content === "string") return content;
  const head = content.subarray(0, 120).toString("latin1");
  return /encoding=["']ISO-8859-1["']/i.test(head) ? decodeLatin1(content) : content.toString("utf8");
}

function addMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

export function parseCaf(content: Buffer | string, expected: { rutEmisor?: string; type?: DteType } = {}): ParsedCaf {
  const xml = readCafFile(content);
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_level, message) => { errors.push(String(message)); } })
    .parseFromString(xml, "text/xml");
  const cafNode = doc.getElementsByTagName("CAF")[0];
  if (!cafNode || errors.length) throw new CafError("El archivo no es un CAF valido del SII");

  const da = cafNode.getElementsByTagName("DA")[0];
  if (!da) throw new CafError("El CAF no tiene el bloque DA");

  const rutEmisor = normalizeRut(text(da, "RE"));
  const type = Number(text(da, "TD")) as DteType;
  const folioFrom = Number(text(da, "D"));
  const folioTo = Number(text(da, "H"));
  const authorizedAt = text(da, "FA");
  const idk = Number(text(da, "IDK"));
  const modulus = text(da, "M");
  const exponent = text(da, "E");
  const privateKeyPem = text(doc, "RSASK");

  if (!SUPPORTED_TYPES.includes(type)) throw new CafError(`Tipo de documento ${text(da, "TD")} no soportado por Parkia`);
  if (!Number.isInteger(folioFrom) || !Number.isInteger(folioTo) || folioFrom < 1 || folioTo < folioFrom) {
    throw new CafError("Rango de folios invalido en el CAF");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(authorizedAt)) throw new CafError("Fecha de autorizacion invalida en el CAF");
  if (!modulus || !exponent) throw new CafError("El CAF no trae la clave publica (RSAPK)");
  if (!privateKeyPem) throw new CafError("El CAF no trae la clave privada (RSASK)");
  if (expected.rutEmisor && normalizeRut(expected.rutEmisor) !== rutEmisor) {
    throw new CafError(`El CAF es del RUT ${rutEmisor} y no del emisor configurado ${normalizeRut(expected.rutEmisor)}`);
  }
  if (expected.type && expected.type !== type) {
    throw new CafError(`El CAF es para documentos tipo ${type}, no ${expected.type}`);
  }

  let privateKey: KeyObject;
  let publicKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyPem);
    publicKey = createPublicKey({
      key: { kty: "RSA", n: Buffer.from(modulus, "base64").toString("base64url"), e: Buffer.from(exponent, "base64").toString("base64url") },
      format: "jwk",
    });
  } catch {
    throw new CafError("Las claves del CAF no se pudieron leer");
  }

  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  if (privateJwk.n !== publicJwk.n || privateJwk.e !== publicJwk.e) {
    throw new CafError("La clave privada del CAF no corresponde a su clave publica (RSAPK)");
  }

  // Se copia el <CAF> exactamente como viene, solo sin espacios entre etiquetas.
  const rawMatch = /<CAF\b[\s\S]*?<\/CAF>/.exec(xml);
  if (!rawMatch) throw new CafError("No se pudo extraer el bloque CAF");

  // VERIFICAR-SII: IDK 100 corresponde a la clave del ambiente de certificacion; otro valor, produccion.
  const environment: SiiEnvironment = idk === 100 ? "certificacion" : "produccion";

  // VERIFICAR-SII: los CAF de facturas y notas vencen a los 6 meses de autorizados; los de boleta no.
  const expiresAt = type === 39 || type === 41 ? null : addMonths(authorizedAt, 6);

  return {
    rutEmisor,
    razonSocial: text(da, "RS"),
    type,
    folioFrom,
    folioTo,
    authorizedAt,
    idk,
    environment,
    cafXml: flattenXml(rawMatch[0]),
    privateKey,
    privateKeyPem,
    publicKey,
    expiresAt,
  };
}

export function cafContainsFolio(caf: Pick<ParsedCaf, "folioFrom" | "folioTo">, folio: number) {
  return Number.isInteger(folio) && folio >= caf.folioFrom && folio <= caf.folioTo;
}

export function cafRemaining(caf: Pick<ParsedCaf, "folioTo">, nextFolio: number) {
  return Math.max(0, caf.folioTo - nextFolio + 1);
}
