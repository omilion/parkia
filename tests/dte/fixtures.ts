import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateXML } from "xmllint-wasm";
import type { DteDocumentInput } from "../../server/modules/dte/types";

/**
 * Datos de prueba generados en memoria. Nunca se usan certificados ni CAF reales en el repo.
 */

import { RUT_EMISOR } from "./generators";
export { createTestCaf, createTestPfx, PFX_PASSWORD, RUT_EMISOR, RUT_TITULAR } from "./generators";

export const EMISOR = {
  rut: RUT_EMISOR,
  razonSocial: "Estacionamientos Ñuñoa SpA",
  giro: "Servicios de estacionamiento de vehiculos",
  acteco: [522130],
  direccion: "Av. Irarrázaval 1234",
  comuna: "Ñuñoa",
  ciudad: "Santiago",
};

export function boletaInput(folio = 1, overrides: Partial<DteDocumentInput> = {}): DteDocumentInput {
  return {
    type: 39,
    folio,
    fechaEmision: "2026-11-11",
    emisor: EMISOR,
    items: [{ nombre: "Servicio de estacionamiento", descripcion: "Patente ABCD12, 10:05 a 11:47, 102 min", monto: 1190 }],
    ...overrides,
  };
}

export function facturaInput(folio = 1, overrides: Partial<DteDocumentInput> = {}): DteDocumentInput {
  return {
    type: 33,
    folio,
    fechaEmision: "2026-11-11",
    formaPago: 1,
    emisor: EMISOR,
    receptor: {
      rut: "77777777-7",
      razonSocial: "Constructora Peñalolén & Cía. Ltda.",
      giro: "Construccion",
      direccion: "Los Militares 5555",
      comuna: "Las Condes",
      ciudad: "Santiago",
    },
    items: [{ nombre: "Arriendo mensual estacionamiento", cantidad: 2, precioUnitario: 50000, monto: 100000 }],
    ...overrides,
  };
}

const XSD_DIR = join(import.meta.dirname, "../../server/modules/dte/providers/sii/xsd");

function xsd(path: string, fileName: string) {
  return { fileName, contents: new Uint8Array(readFileSync(join(XSD_DIR, path))) };
}

/** Valida contra los XSD oficiales del SII. xmllint solo acepta UTF-8: se cambia solo la declaracion. */
export async function validateAgainstSii(xml: string, kind: "boleta" | "dte") {
  const utf8 = xml.replace(/^<\?xml[^>]*\?>/, '<?xml version="1.0" encoding="UTF-8"?>');
  const schema = kind === "boleta"
    ? [xsd("boleta/EnvioBOLETA_v11.xsd", "EnvioBOLETA_v11.xsd")]
    : [xsd("dte/EnvioDTE_v10.xsd", "EnvioDTE_v10.xsd")];
  const preload = kind === "boleta"
    ? [xsd("boleta/xmldsignature_v10.xsd", "xmldsignature_v10.xsd")]
    : [xsd("dte/DTE_v10.xsd", "DTE_v10.xsd"), xsd("dte/SiiTypes_v10.xsd", "SiiTypes_v10.xsd"), xsd("dte/xmldsignature_v10.xsd", "xmldsignature_v10.xsd")];
  return validateXML({ xml: [{ fileName: "envio.xml", contents: utf8 }], schema, preload });
}
