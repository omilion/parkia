import { sign, verify, type KeyObject } from "node:crypto";
import type { DteType } from "../../types";
import { cleanText, el, escapeXml, flattenXml } from "./xml";

/**
 * Timbre Electronico del DTE (TED). El bloque DD resume el documento y se firma con la clave
 * privada del CAF (SHA1withRSA). Ese mismo TED aplanado es el contenido del codigo PDF417
 * que va impreso en la boleta o factura.
 */

export type TedInput = {
  rutEmisor: string;
  type: DteType;
  folio: number;
  fechaEmision: string;
  rutReceptor: string;
  razonSocialReceptor: string;
  montoTotal: number;
  primerItem: string;
  /** Elemento <CAF> aplanado, tal cual viene del archivo del SII. */
  cafXml: string;
  cafPrivateKey: KeyObject;
  timestamp: string;
};

export type TedResult = {
  ddXml: string;
  tedXml: string;
  signatureBase64: string;
};

export function buildDd(input: Omit<TedInput, "cafPrivateKey">): string {
  return flattenXml([
    "<DD>",
    el("RE", input.rutEmisor, { optional: false }),
    el("TD", input.type, { optional: false }),
    el("F", input.folio, { optional: false }),
    el("FE", input.fechaEmision, { optional: false }),
    el("RR", input.rutReceptor, { optional: false }),
    // RSR puede quedar vacio (el esquema no fija largo minimo), pero se escribe siempre.
    `<RSR>${escapeXml(cleanText(input.razonSocialReceptor, 40))}</RSR>`,
    el("MNT", input.montoTotal, { optional: false }),
    `<IT1>${escapeXml(cleanText(input.primerItem, 40))}</IT1>`,
    input.cafXml,
    el("TSTED", input.timestamp, { optional: false }),
    "</DD>",
  ].join(""));
}

/**
 * VERIFICAR-SII: la firma se calcula sobre el DD aplanado (sin espacios entre etiquetas)
 * codificado en ISO-8859-1, que es lo que documenta el SII y lo que hacen las implementaciones
 * conocidas. Validar con el primer set de pruebas.
 */
export function buildTed(input: TedInput): TedResult {
  const ddXml = buildDd(input);
  const signature = sign("RSA-SHA1", Buffer.from(ddXml, "latin1"), input.cafPrivateKey);
  const signatureBase64 = signature.toString("base64");
  const tedXml = `<TED version="1.0">${ddXml}<FRMT algoritmo="SHA1withRSA">${signatureBase64}</FRMT></TED>`;
  return { ddXml, tedXml, signatureBase64 };
}

export function verifyTed(tedXml: string, cafPublicKey: KeyObject): boolean {
  const dd = /<DD>[\s\S]*<\/DD>/.exec(flattenXml(tedXml))?.[0];
  const frmt = /<FRMT[^>]*>([^<]+)<\/FRMT>/.exec(tedXml)?.[1];
  if (!dd || !frmt) return false;
  return verify("RSA-SHA1", Buffer.from(dd, "latin1"), cafPublicKey, Buffer.from(frmt.trim(), "base64"));
}
