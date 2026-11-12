/** Transporte HTTP inyectable, para probar sin red y para fijar timeouts en un solo lugar. */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SiiHttpOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 30_000;

export async function siiFetch(url: string, init: RequestInit, options: SiiHttpOptions = {}): Promise<Response> {
  const fetchImpl = options.fetch || (globalThis.fetch as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Tiempo de espera agotado al conectar con el SII (${url})`);
    throw new Error(`No se pudo conectar con el SII (${url}): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function soapEnvelope(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}

export async function postSoap(url: string, body: string, options: SiiHttpOptions = {}) {
  const response = await siiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "\"\"" },
    body: soapEnvelope(body),
  }, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`El SII respondio HTTP ${response.status} en ${url}`);
  return text;
}
