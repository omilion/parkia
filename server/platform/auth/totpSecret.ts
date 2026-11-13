import { decryptSecretString, encryptSecret } from "../secrets";

/**
 * El secreto TOTP se guarda cifrado con la clave maestra (PARKIA_MASTER_KEY): si se filtra la base,
 * los secretos no sirven para generar códigos. El cifrado por sobre exige un "tenant" para derivar la clave;
 * el personal no pertenece a uno solo, así que se usa un espacio fijo (1) y el propósito liga el secreto a la persona.
 *
 * Los secretos guardados antes de esta mejora están en texto plano (sin prefijo "pk1:"): se aceptan tal cual
 * y quedan sellados la próxima vez que la persona configura su 2FA.
 */
const KEY_SPACE = 1;
const purposeFor = (staffId: number) => `auth.totp.${staffId}`;

export function sealTotpSecret(staffId: number, secret: string): string {
  return encryptSecret(secret, { tenantId: KEY_SPACE, purpose: purposeFor(staffId) });
}

export function openTotpSecret(staffId: number, stored: string): string {
  if (!stored.startsWith("pk1:")) return stored;
  return decryptSecretString(stored, { tenantId: KEY_SPACE, purpose: purposeFor(staffId) });
}
