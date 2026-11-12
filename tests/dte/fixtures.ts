import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { validateXML } from "xmllint-wasm";
import type { DteDocumentInput } from "../../server/modules/dte/types";

/**
 * Datos de prueba generados en memoria. Nunca se usan certificados ni CAF reales en el repo.
 */

export const RUT_EMISOR = "76192083-9";
export const RUT_TITULAR = "11111111-1";
export const PFX_PASSWORD = "clave-de-prueba";

export function createTestPfx(options: { notBefore?: Date; notAfter?: Date; withRut?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const forgePrivate = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString());
  const forgePublic = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublic;
  cert.serialNumber = "01";
  cert.validity.notBefore = options.notBefore || new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = options.notAfter || new Date(Date.now() + 365 * 86_400_000);
  const subject = [
    { name: "commonName", value: "TITULAR DE PRUEBA PARKIA" },
    { name: "countryName", value: "CL" },
    ...(options.withRut === false ? [] : [{ name: "serialNumber", value: RUT_TITULAR }]),
  ];
  cert.setSubject(subject);
  cert.setIssuer([{ name: "commonName", value: "CA DE PRUEBA" }, { name: "countryName", value: "CL" }]);
  cert.sign(forgePrivate, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(forgePrivate, [cert], PFX_PASSWORD, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

export function createTestCaf(options: { type?: number; from?: number; to?: number; rut?: string; idk?: number; mismatchedKey?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 512, publicExponent: 3 });
  const jwk = (options.mismatchedKey
    ? generateKeyPairSync("rsa", { modulusLength: 512, publicExponent: 3 }).publicKey
    : publicKey).export({ format: "jwk" });
  const modulus = Buffer.from(jwk.n!, "base64url").toString("base64");
  const exponent = Buffer.from(jwk.e!, "base64url").toString("base64");
  const privatePem = privateKey.export({ type: "pkcs1", format: "pem" }).toString().trim();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();

  return `<?xml version="1.0"?>
<AUTORIZACION>
<CAF version="1.0">
<DA>
<RE>${options.rut || RUT_EMISOR}</RE>
<RS>ESTACIONAMIENTOS ÑUÑOA SPA</RS>
<TD>${options.type || 39}</TD>
<RNG><D>${options.from || 1}</D><H>${options.to || 100}</H></RNG>
<FA>2026-11-01</FA>
<RSAPK><M>${modulus}</M><E>${exponent}</E></RSAPK>
<IDK>${options.idk ?? 100}</IDK>
</DA>
<FRMA algoritmo="SHA1withRSA">ZmlybWEtZGVsLXNpaS1zaW11bGFkYQ==</FRMA>
</CAF>
<RSASK>${privatePem}</RSASK>
<RSAPUBK>${publicPem}</RSAPUBK>
</AUTORIZACION>
`;
}

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
