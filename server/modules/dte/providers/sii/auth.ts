import type { SiiEnvironment } from "../../types";
import type { SiiEndpoints } from "./endpoints";
import { assertSiiResponseOk, SiiError } from "./errors";
import { postSoap, siiFetch, type SiiHttpOptions } from "./http";
import type { SignerCertificate } from "./signer";
import { signEnveloped } from "./signer";
import { decodeXmlEntities, escapeXml, readTag } from "./xml";

/**
 * Autenticacion con el SII: semilla -> semilla firmada con el certificado -> token.
 * Hay dos servicios distintos: SOAP para facturas y notas, REST para boletas.
 * El token se guarda en memoria por certificado, ambiente y servicio.
 */

export type TokenKind = "dte" | "boleta";

/** VERIFICAR-SII: duracion del token. Se renueva antes, con margen. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache() {
  tokenCache.clear();
}

export function buildSignedSeedRequest(seed: string, cert: SignerCertificate) {
  return signEnveloped(`<getToken><item><Semilla>${escapeXml(seed)}</Semilla></item></getToken>`, cert);
}

/** Las respuestas SOAP del SII traen el XML de respuesta escapado dentro de *Return. */
function unwrapSoapReturn(soap: string, returnTag: string) {
  const inner = readTag(soap, returnTag);
  if (inner === null) throw new SiiError(`Respuesta inesperada del SII: falta ${returnTag}`, "SII_BAD_RESPONSE", soap.slice(0, 500));
  return decodeXmlEntities(inner);
}

async function fetchDteToken(endpoints: SiiEndpoints, cert: SignerCertificate, http: SiiHttpOptions) {
  const seedXml = unwrapSoapReturn(await postSoap(endpoints.dte.seed, "<getSeed/>", http), "getSeedReturn");
  assertSiiResponseOk(readTag(seedXml, "ESTADO"), "semilla", readTag(seedXml, "GLOSA"));
  const seed = readTag(seedXml, "SEMILLA");
  if (!seed) throw new SiiError("El SII no entrego semilla", "SII_NO_SEED");

  const signed = buildSignedSeedRequest(seed, cert);
  const tokenXml = unwrapSoapReturn(
    await postSoap(endpoints.dte.token, `<getToken><pszXml><![CDATA[${signed}]]></pszXml></getToken>`, http),
    "getTokenReturn",
  );
  assertSiiResponseOk(readTag(tokenXml, "ESTADO"), "token", readTag(tokenXml, "GLOSA"));
  const token = readTag(tokenXml, "TOKEN");
  if (!token) throw new SiiError("El SII no entrego token", "SII_NO_TOKEN");
  return token;
}

async function fetchBoletaToken(endpoints: SiiEndpoints, cert: SignerCertificate, http: SiiHttpOptions) {
  const seedResponse = await siiFetch(endpoints.boleta.seed, { method: "GET", headers: { Accept: "application/xml" } }, http);
  const seedXml = await seedResponse.text();
  if (!seedResponse.ok) throw new SiiError(`El SII respondio HTTP ${seedResponse.status} al pedir semilla de boletas`, "SII_SEED_HTTP");
  assertSiiResponseOk(readTag(seedXml, "ESTADO"), "semilla", readTag(seedXml, "GLOSA"));
  const seed = readTag(seedXml, "SEMILLA");
  if (!seed) throw new SiiError("El SII no entrego semilla de boletas", "SII_NO_SEED");

  const tokenResponse = await siiFetch(endpoints.boleta.token, {
    method: "POST",
    headers: { "Content-Type": "application/xml", Accept: "application/xml" },
    body: buildSignedSeedRequest(seed, cert),
  }, http);
  const tokenXml = await tokenResponse.text();
  if (!tokenResponse.ok) throw new SiiError(`El SII respondio HTTP ${tokenResponse.status} al pedir token de boletas`, "SII_TOKEN_HTTP");
  assertSiiResponseOk(readTag(tokenXml, "ESTADO"), "token", readTag(tokenXml, "GLOSA"));
  const token = readTag(tokenXml, "TOKEN");
  if (!token) throw new SiiError("El SII no entrego token de boletas", "SII_NO_TOKEN");
  return token;
}

export async function getSiiToken(input: {
  kind: TokenKind;
  endpoints: SiiEndpoints;
  cert: SignerCertificate & { fingerprintSha256?: string };
  http?: SiiHttpOptions;
  forceRefresh?: boolean;
}): Promise<string> {
  const environment: SiiEnvironment = input.endpoints.environment;
  const certKey = input.cert.fingerprintSha256 || input.cert.certificateBase64.slice(-32);
  const cacheKey = `${input.kind}:${environment}:${certKey}`;
  const cached = tokenCache.get(cacheKey);
  if (!input.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const token = input.kind === "dte"
    ? await fetchDteToken(input.endpoints, input.cert, input.http || {})
    : await fetchBoletaToken(input.endpoints, input.cert, input.http || {});
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}
