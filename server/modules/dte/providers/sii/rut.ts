/** Utilidades de RUT chileno para el SII (formato 12345678-K, sin puntos). */

export function computeRutDv(body: number | string): string {
  let sum = 0;
  let multiplier = 2;
  const digits = String(body).replace(/\D/g, "");
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return "0";
  if (result === 10) return "K";
  return String(result);
}

/** Normaliza a "12345678-K". Lanza error si el digito verificador no corresponde. */
export function normalizeRut(value: string): string {
  const clean = String(value || "").replace(/[.\s]/g, "").toUpperCase();
  const match = /^(\d{1,8})-?([\dK])$/.exec(clean);
  if (!match) throw new Error(`RUT invalido: ${value}`);
  const body = String(Number(match[1]));
  if (computeRutDv(body) !== match[2]) throw new Error(`RUT con digito verificador incorrecto: ${value}`);
  return `${body}-${match[2]}`;
}

export function isValidRut(value: string): boolean {
  try {
    normalizeRut(value);
    return true;
  } catch {
    return false;
  }
}

export function splitRut(value: string): { body: string; dv: string } {
  const [body, dv] = normalizeRut(value).split("-");
  return { body, dv };
}

/** RUT del SII, receptor de todos los envios. */
export const SII_RUT = "60803000-K";

/**
 * RUT generico para boletas a consumidor final sin identificar.
 * VERIFICAR-SII: confirmar en el "Formato Boletas Electronicas" vigente que 66666666-6 sigue siendo el RUT generico.
 */
export const CONSUMIDOR_FINAL_RUT = "66666666-6";
