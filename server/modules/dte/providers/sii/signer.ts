import { SignedXml } from "xml-crypto";
import type { LoadedCertificate } from "./cert";

/**
 * Firma XMLDSig segun el perfil restringido del SII (xmldsignature_v10.xsd):
 * C14N inclusivo 20010315, RSA-SHA1, digest SHA1 y KeyInfo con RSAKeyValue + X509Certificate.
 */

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export type SignerCertificate = Pick<LoadedCertificate, "privateKeyPem" | "certificatePem" | "certificateBase64" | "modulusBase64" | "exponentBase64">;

function keyInfoContent(cert: SignerCertificate) {
  return `<KeyValue><RSAKeyValue><Modulus>${cert.modulusBase64}</Modulus><Exponent>${cert.exponentBase64}</Exponent></RSAKeyValue></KeyValue>`
    + `<X509Data><X509Certificate>${cert.certificateBase64}</X509Certificate></X509Data>`;
}

function createSigner(cert: SignerCertificate) {
  return new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certificatePem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
    getKeyInfoContent: () => keyInfoContent(cert),
  });
}

/**
 * Firma el elemento con atributo ID = `referenceId` y agrega <Signature> como ultimo hijo
 * del elemento indicado por `parentXpath`. El XML de entrada no debe re-formatearse despues.
 */
export function signReference(xml: string, referenceId: string, parentXpath: string, cert: SignerCertificate): string {
  if (!/^[A-Za-z_][\w.-]*$/.test(referenceId)) throw new Error(`ID de referencia invalido: ${referenceId}`);
  const signer = createSigner(cert);
  signer.addReference({
    xpath: `//*[@ID='${referenceId}']`,
    transforms: [C14N],
    digestAlgorithm: SHA1,
  });
  signer.computeSignature(xml, { location: { reference: parentXpath, action: "append" } });
  return signer.getSignedXml();
}

/** Firma enveloped del documento completo con URI="" (usado para obtener el token del SII). */
export function signEnveloped(xml: string, cert: SignerCertificate): string {
  const signer = createSigner(cert);
  signer.addReference({
    xpath: "/*",
    transforms: [ENVELOPED],
    digestAlgorithm: SHA1,
    isEmptyUri: true,
  });
  signer.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  return signer.getSignedXml();
}

/**
 * Verifica todas las firmas de un XML con el certificado incluido en cada una.
 * Uso: pruebas y diagnostico antes de enviar al SII.
 */
export function verifySignatures(xml: string): { ok: boolean; count: number; errors: string[] } {
  const errors: string[] = [];
  const signatures = xml.match(/<Signature\b[\s\S]*?<\/Signature>/g) || [];
  for (const signatureXml of signatures) {
    const certBase64 = /<X509Certificate>([^<]+)<\/X509Certificate>/.exec(signatureXml)?.[1];
    if (!certBase64) {
      errors.push("Firma sin certificado");
      continue;
    }
    const pem = `-----BEGIN CERTIFICATE-----\n${certBase64.replace(/\s+/g, "").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
    const verifier = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
    try {
      verifier.loadSignature(signatureXml);
      if (!verifier.checkSignature(xml)) errors.push("Firma invalida");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { ok: signatures.length > 0 && errors.length === 0, count: signatures.length, errors };
}
