import type { DteType, SignedDte } from "../../types";
import { isBoleta } from "../../types";
import type { SignerCertificate } from "./signer";
import { signReference } from "./signer";
import { normalizeRut, SII_RUT } from "./rut";
import { chileTimestamp, encodeLatin1, el, group, XML_DECLARATION } from "./xml";

/**
 * Sobre de envio al SII: EnvioBOLETA (boletas 39/41) o EnvioDTE (facturas y notas).
 * Cada documento se firma dentro del sobre final y luego se firma el SetDTE completo,
 * de modo que la canonicalizacion coincide exactamente con la que hace el SII al verificar.
 */

export type EnvelopeOptions = {
  rutEmisor: string;
  /** RUT del titular del certificado que envia. */
  rutEnvia: string;
  /** Fecha y numero de resolucion. En certificacion: fecha de autorizacion de pruebas y numero 0. */
  fechaResolucion: string;
  numeroResolucion: number;
  /** Incluye xmlns:xsi y xsi:schemaLocation como en los ejemplos del SII. */
  includeSchemaLocation?: boolean;
  now?: Date;
};

export type BuiltEnvelope = {
  kind: "boleta" | "dte";
  /** XML firmado, con declaracion ISO-8859-1. */
  xml: string;
  /** Bytes en ISO-8859-1 listos para subir. */
  bytes: Buffer;
  setId: string;
  documentIds: string[];
};

const SII_NS = "http://www.sii.cl/SiiDte";
export const MAX_DOCUMENTS_PER_ENVELOPE = 500;

function subtotals(documents: SignedDte[]) {
  const counts = new Map<DteType, number>();
  for (const doc of documents) counts.set(doc.type, (counts.get(doc.type) || 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([type, count]) => group("SubTotDTE", [el("TpoDTE", type), el("NroDTE", count)]));
}

export function buildEnvelope(documents: SignedDte[], options: EnvelopeOptions, cert: SignerCertificate): BuiltEnvelope {
  if (!documents.length) throw new Error("El sobre debe incluir al menos un documento");
  if (documents.length > MAX_DOCUMENTS_PER_ENVELOPE) throw new Error(`Maximo ${MAX_DOCUMENTS_PER_ENVELOPE} documentos por sobre`);
  const boleta = isBoleta(documents[0].type);
  if (documents.some(doc => isBoleta(doc.type) !== boleta)) {
    throw new Error("No se pueden mezclar boletas con facturas o notas en un mismo sobre");
  }
  const ids = documents.map(doc => doc.documentId);
  if (new Set(ids).size !== ids.length) throw new Error("Hay documentos repetidos en el sobre");

  const root = boleta ? "EnvioBOLETA" : "EnvioDTE";
  const schema = boleta ? "EnvioBOLETA_v11.xsd" : "EnvioDTE_v10.xsd";
  const setId = "SetDoc";
  const rootAttributes = options.includeSchemaLocation === false
    ? `xmlns="${SII_NS}" version="1.0"`
    : `xmlns="${SII_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SII_NS} ${schema}" version="1.0"`;

  const caratula = group("Caratula", [
    el("RutEmisor", normalizeRut(options.rutEmisor)),
    el("RutEnvia", normalizeRut(options.rutEnvia)),
    el("RutReceptor", SII_RUT),
    el("FchResol", options.fechaResolucion),
    el("NroResol", options.numeroResolucion),
    el("TmstFirmaEnv", chileTimestamp(options.now)),
    ...subtotals(documents),
  ], 'version="1.0"');

  let xml = `<${root} ${rootAttributes}><SetDTE ID="${setId}">${caratula}${documents.map(doc => doc.dteXml).join("")}</SetDTE></${root}>`;

  for (const doc of documents) {
    xml = signReference(xml, doc.documentId, `//*[local-name()='DTE'][*[local-name()='Documento'][@ID='${doc.documentId}']]`, cert);
  }
  xml = signReference(xml, setId, "/*", cert);

  const finalXml = `${XML_DECLARATION}\n${xml}`;
  return { kind: boleta ? "boleta" : "dte", xml: finalXml, bytes: encodeLatin1(finalXml), setId, documentIds: ids };
}
