import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

/**
 * Datos de prueba generados en memoria (sin import.meta, para que tambien los use Playwright).
 * Nunca se usan certificados ni CAF reales en el repo.
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

