import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return encodeBase32(randomBytes(byteLength));
}

export function generateTotpCode(secret: string, timestampMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const key = decodeBase32(secret);
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, "0");
}

export function verifyTotpCode(
  secret: string | null | undefined,
  code: string | null | undefined,
  timestampMs = Date.now(),
  windowSteps = 1,
): boolean {
  if (!secret || !code) return false;
  const normalizedCode = String(code).trim();
  if (!/^\d{6}$/.test(normalizedCode)) return false;

  const targetBuf = Buffer.from(normalizedCode, "utf8");
  for (let stepOffset = -windowSteps; stepOffset <= windowSteps; stepOffset++) {
    const candidate = generateTotpCode(secret, timestampMs + stepOffset * 30_000);
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length === targetBuf.length && timingSafeEqual(candidateBuf, targetBuf)) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUrl(params: { secret: string; email: string; issuer?: string }): string {
  const issuer = params.issuer || "Parkia";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.email)}`;
  return `otpauth://totp/${label}?secret=${encodeURIComponent(params.secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

