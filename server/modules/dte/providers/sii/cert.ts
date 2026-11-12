import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import forge from "node-forge";
import { isValidRut, normalizeRut } from "./rut";

/**
 * Carga de certificado digital de firma electronica (.pfx / .p12) emitido por una entidad
 * acreditada en Chile. Se usa para firmar DTE, sobres y la semilla de autenticacion del SII.
 */

export type LoadedCertificate = {
  privateKeyPem: string;
  certificatePem: string;
  /** Certificado X509 en DER base64, para <X509Certificate>. */
  certificateBase64: string;
  /** Modulo y exponente RSA en base64, para <RSAKeyValue>. */
  modulusBase64: string;
  exponentBase64: string;
  subjectName: string;
  /** RUT del titular si se pudo leer del certificado. Es el "RutEnvia" de los envios. */
  subjectRut: string | null;
  issuerName: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  fingerprintSha256: string;
};

export class CertificateError extends Error {
  constructor(message: string, readonly code: "INVALID_PASSWORD" | "INVALID_FILE" | "NO_PRIVATE_KEY" | "EXPIRED" | "NOT_YET_VALID" | "KEY_MISMATCH") {
    super(message);
    this.name = "CertificateError";
  }
}

function bigIntegerToBase64(value: forge.jsbn.BigInteger): string {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return forge.util.encode64(forge.util.hexToBytes(hex));
}

function attributeValue(attributes: forge.pki.CertificateField[], shortName: string) {
  return attributes.find(attribute => attribute.shortName === shortName)?.value as string | undefined;
}

function distinguishedName(attributes: forge.pki.CertificateField[]) {
  return attributes
    .map(attribute => `${attribute.shortName || attribute.name || attribute.type}=${attribute.value}`)
    .join(", ");
}

/**
 * Busca el RUT del titular. Los certificados chilenos lo suelen incluir en subjectAltName
 * (otherName, OID 1.3.6.1.4.1.8321.1) o en el atributo serialNumber del sujeto.
 * VERIFICAR-SII: depende de la entidad emisora; si no se encuentra, el usuario lo ingresa a mano.
 */
function findSubjectRut(certificate: forge.pki.Certificate): string | null {
  const candidates: string[] = [];
  const serial = attributeValue(certificate.subject.attributes, "serialNumber");
  if (serial) candidates.push(serial);

  const altNames = certificate.getExtension("subjectAltName") as { value?: string } | null;
  if (altNames?.value) candidates.push(altNames.value);

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  candidates.push(der);

  for (const candidate of candidates) {
    const matches = candidate.match(/\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/g) || [];
    for (const match of matches) {
      if (isValidRut(match)) return normalizeRut(match);
    }
  }
  return null;
}

export function loadPfx(pfx: Buffer, password: string, options: { now?: Date; allowExpired?: boolean } = {}): LoadedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/mac could not be verified|invalid password|decrypt/i.test(message)) {
      throw new CertificateError("La clave del certificado es incorrecta", "INVALID_PASSWORD");
    }
    throw new CertificateError(
      `No se pudo leer el archivo .pfx/.p12 (${message}). Si fue exportado con cifrado AES moderno, reexportalo con: openssl pkcs12 -legacy`,
      "INVALID_FILE",
    );
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const privateKey = keyBags.find(bag => bag.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!privateKey) throw new CertificateError("El archivo no contiene la clave privada del certificado", "NO_PRIVATE_KEY");

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certificates = certBags.map(bag => bag.cert).filter((cert): cert is forge.pki.Certificate => Boolean(cert));
  // El certificado del titular es el que corresponde a la clave privada (el resto es la cadena de la CA).
  const certificate = certificates.find(cert => {
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    return publicKey.n && publicKey.n.equals(privateKey.n);
  });
  if (!certificate) throw new CertificateError("Ningun certificado del archivo corresponde a la clave privada", "KEY_MISMATCH");

  const now = options.now || new Date();
  if (!options.allowExpired) {
    if (certificate.validity.notAfter < now) {
      throw new CertificateError(`El certificado vencio el ${certificate.validity.notAfter.toISOString().slice(0, 10)}`, "EXPIRED");
    }
    if (certificate.validity.notBefore > now) {
      throw new CertificateError(`El certificado aun no es valido (desde ${certificate.validity.notBefore.toISOString().slice(0, 10)})`, "NOT_YET_VALID");
    }
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certificatePem = forge.pki.certificateToPem(certificate);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const derBuffer = Buffer.from(der, "binary");

  // Validacion cruzada con el motor criptografico de Node.
  createPrivateKey(privateKeyPem);
  createPublicKey(certificatePem);

  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  return {
    privateKeyPem,
    certificatePem,
    certificateBase64: derBuffer.toString("base64"),
    modulusBase64: bigIntegerToBase64(publicKey.n),
    exponentBase64: bigIntegerToBase64(publicKey.e),
    subjectName: attributeValue(certificate.subject.attributes, "CN") || distinguishedName(certificate.subject.attributes),
    subjectRut: findSubjectRut(certificate),
    issuerName: attributeValue(certificate.issuer.attributes, "CN") || distinguishedName(certificate.issuer.attributes),
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validity.notBefore,
    validTo: certificate.validity.notAfter,
    fingerprintSha256: createHash("sha256").update(derBuffer).digest("hex"),
  };
}

/** Dias que faltan para el vencimiento (negativo si ya vencio). */
export function daysUntilExpiry(certificate: Pick<LoadedCertificate, "validTo">, now = new Date()) {
  return Math.floor((certificate.validTo.getTime() - now.getTime()) / 86_400_000);
}
