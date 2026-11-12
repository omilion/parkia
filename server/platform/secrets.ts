import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifrado por sobre (envelope encryption) para secretos por tenant:
 * certificados digitales, claves de certificado, CAF del SII, credenciales de pasarelas.
 *
 * - Clave maestra: PARKIA_MASTER_KEY (32 bytes en base64 o hex). Nunca se guarda en la base.
 * - Clave de cifrado de claves (KEK) por tenant: HKDF-SHA256(master, salt = "parkia-kek", info = tenant).
 * - Cada valor se cifra con una clave de datos (DEK) aleatoria, que se guarda envuelta con la KEK.
 * - AES-256-GCM en ambas capas. El AAD liga el texto cifrado al tenant y al proposito,
 *   de modo que un secreto copiado a otro tenant o a otro campo no se puede descifrar.
 *
 * Formato (version 1), todo en base64 con prefijo "pk1:":
 *   [1 byte version][12 iv_kek][16 tag_kek][32 dek_envuelta][12 iv_dato][16 tag_dato][n dato]
 */

const VERSION = 1;
const PREFIX = "pk1:";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const DEV_FALLBACK_SEED = "parkia-dev-master-key-NO-USAR-EN-PRODUCCION";

let cachedMasterKey: Buffer | null = null;
let warnedDevKey = false;

function parseMasterKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === KEY_LEN) return decoded;
  throw new Error("PARKIA_MASTER_KEY debe ser de 32 bytes, en hex (64 caracteres) o base64 (44 caracteres)");
}

export function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const raw = process.env.PARKIA_MASTER_KEY;
  if (raw) {
    cachedMasterKey = parseMasterKey(raw);
    return cachedMasterKey;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Falta PARKIA_MASTER_KEY: no se pueden cifrar ni descifrar secretos en produccion sin clave maestra");
  }
  if (!warnedDevKey && process.env.NODE_ENV !== "test") {
    warnedDevKey = true;
    console.warn("[secrets] PARKIA_MASTER_KEY no definida: se usa una clave de desarrollo. No usar con datos reales.");
  }
  cachedMasterKey = createHash("sha256").update(DEV_FALLBACK_SEED).digest();
  return cachedMasterKey;
}

/** Solo para tests: fuerza la recarga de la clave maestra desde el entorno. */
export function resetMasterKeyCacheForTesting() {
  cachedMasterKey = null;
}

/** Genera una clave maestra nueva en base64, para poner en PARKIA_MASTER_KEY. */
export function generateMasterKey(): string {
  return randomBytes(KEY_LEN).toString("base64");
}

function deriveTenantKek(tenantId: number): Buffer {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("tenantId invalido para cifrado de secretos");
  return Buffer.from(hkdfSync("sha256", getMasterKey(), "parkia-kek", `tenant:${tenantId}`, KEY_LEN));
}

function aad(tenantId: number, purpose: string, layer: "kek" | "data") {
  return Buffer.from(`parkia:v${VERSION}:${layer}:tenant=${tenantId}:purpose=${purpose}`, "utf8");
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, additional: Buffer) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additional);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, additional: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(additional);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export type SecretContext = {
  tenantId: number;
  /** Proposito del secreto, p. ej. "dte.certificate.pfx" o "dte.caf.39". Debe coincidir al descifrar. */
  purpose: string;
};

export function encryptSecret(plaintext: Buffer | string, context: SecretContext): string {
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
  const kek = deriveTenantKek(context.tenantId);
  const dek = randomBytes(KEY_LEN);
  const wrapped = gcmEncrypt(kek, dek, aad(context.tenantId, context.purpose, "kek"));
  const sealed = gcmEncrypt(dek, data, aad(context.tenantId, context.purpose, "data"));
  dek.fill(0);
  return PREFIX + Buffer.concat([
    Buffer.from([VERSION]),
    wrapped.iv, wrapped.tag, wrapped.ciphertext,
    sealed.iv, sealed.tag, sealed.ciphertext,
  ]).toString("base64");
}

export function decryptSecret(token: string, context: SecretContext): Buffer {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) throw new Error("Secreto con formato desconocido");
  const raw = Buffer.from(token.slice(PREFIX.length), "base64");
  const minLength = 1 + IV_LEN + TAG_LEN + KEY_LEN + IV_LEN + TAG_LEN;
  if (raw.length < minLength) throw new Error("Secreto truncado");
  if (raw[0] !== VERSION) throw new Error(`Version de secreto no soportada: ${raw[0]}`);

  let offset = 1;
  const take = (length: number) => {
    const part = raw.subarray(offset, offset + length);
    offset += length;
    return part;
  };
  const kekIv = take(IV_LEN);
  const kekTag = take(TAG_LEN);
  const wrappedDek = take(KEY_LEN);
  const dataIv = take(IV_LEN);
  const dataTag = take(TAG_LEN);
  const ciphertext = raw.subarray(offset);

  try {
    const kek = deriveTenantKek(context.tenantId);
    const dek = gcmDecrypt(kek, kekIv, kekTag, wrappedDek, aad(context.tenantId, context.purpose, "kek"));
    const plaintext = gcmDecrypt(dek, dataIv, dataTag, ciphertext, aad(context.tenantId, context.purpose, "data"));
    dek.fill(0);
    return plaintext;
  } catch {
    throw new Error("No se pudo descifrar el secreto: clave maestra, tenant o proposito no coinciden, o el dato fue alterado");
  }
}

export function decryptSecretString(token: string, context: SecretContext): string {
  return decryptSecret(token, context).toString("utf8");
}
