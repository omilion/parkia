import type { DteType, EnvioStatus } from "../../types";
import type { SiiEndpoints } from "./endpoints";
import { SII_UPLOAD_USER_AGENT } from "./endpoints";
import { interpretEnvioState, SiiError, UPLOAD_STATUS_MESSAGES } from "./errors";
import { postSoap, siiFetch, type SiiHttpOptions } from "./http";
import { splitRut } from "./rut";
import { decodeXmlEntities, readTag } from "./xml";

/**
 * Envio de sobres y consulta de estados.
 * - Facturas y notas: DTEUpload (multipart) + QueryEstUp / QueryEstDte (SOAP).
 * - Boletas: API REST de boleta electronica.
 */

type UploadInput = {
  endpoints: SiiEndpoints;
  token: string;
  rutEmisor: string;
  rutEnvia: string;
  envelope: Buffer;
  fileName?: string;
  http?: SiiHttpOptions;
};

function uploadForm(input: UploadInput) {
  const sender = splitRut(input.rutEnvia);
  const company = splitRut(input.rutEmisor);
  const form = new FormData();
  form.append("rutSender", sender.body);
  form.append("dvSender", sender.dv);
  form.append("rutCompany", company.body);
  form.append("dvCompany", company.dv);
  form.append("archivo", new Blob([new Uint8Array(input.envelope)], { type: "text/xml" }), input.fileName || "envio.xml");
  return form;
}

export async function uploadDteEnvelope(input: UploadInput): Promise<{ trackId: string; raw: string }> {
  const response = await siiFetch(input.endpoints.dte.upload, {
    method: "POST",
    headers: { Cookie: `TOKEN=${input.token}`, "User-Agent": SII_UPLOAD_USER_AGENT, Accept: "*/*" },
    body: uploadForm(input),
  }, input.http);
  const raw = await response.text();
  if (!response.ok) throw new SiiError(`El SII respondio HTTP ${response.status} al subir el sobre`, "SII_UPLOAD_HTTP", raw.slice(0, 500));

  const status = readTag(raw, "STATUS");
  if (status !== "0") {
    const message = UPLOAD_STATUS_MESSAGES[status || ""] || `El SII rechazo el sobre (STATUS ${status ?? "desconocido"})`;
    throw new SiiError(message, `SII_UPLOAD_${status ?? "UNKNOWN"}`, raw);
  }
  const trackId = readTag(raw, "TRACKID");
  if (!trackId) throw new SiiError("El SII acepto el sobre pero no entrego TRACKID", "SII_UPLOAD_NO_TRACKID", raw);
  return { trackId, raw };
}

export async function uploadBoletaEnvelope(input: UploadInput): Promise<{ trackId: string; raw: unknown }> {
  const response = await siiFetch(input.endpoints.boleta.upload, {
    method: "POST",
    headers: { Cookie: `TOKEN=${input.token}`, "User-Agent": SII_UPLOAD_USER_AGENT, Accept: "application/json" },
    body: uploadForm(input),
  }, input.http);
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* el SII responde texto en algunos errores */ }
  if (!response.ok || !body) {
    throw new SiiError(`El SII respondio HTTP ${response.status} al subir boletas`, "SII_BOLETA_UPLOAD_HTTP", body || text.slice(0, 500));
  }
  // VERIFICAR-SII: nombres de campos de la respuesta (trackid, estado).
  const trackId = body.trackid ?? body.trackId ?? body.TRACKID;
  if (!trackId) throw new SiiError("El SII no entrego trackid para el envio de boletas", "SII_BOLETA_NO_TRACKID", body);
  return { trackId: String(trackId), raw: body };
}

export async function queryDteUploadStatus(input: {
  endpoints: SiiEndpoints;
  token: string;
  rutEmisor: string;
  trackId: string;
  http?: SiiHttpOptions;
}): Promise<EnvioStatus> {
  const company = splitRut(input.rutEmisor);
  const soap = await postSoap(input.endpoints.dte.queryUpload,
    `<getEstUp><RutCompania>${company.body}</RutCompania><DvCompania>${company.dv}</DvCompania><TrackId>${input.trackId}</TrackId><Token>${input.token}</Token></getEstUp>`,
    input.http);
  const inner = decodeXmlEntities(readTag(soap, "getEstUpReturn") || "");
  const code = readTag(inner, "ESTADO") || "";
  const interpreted = interpretEnvioState(code);
  return {
    trackId: input.trackId,
    code,
    state: interpreted.state,
    message: readTag(inner, "GLOSA") || interpreted.message,
    detail: {
      informados: readTag(inner, "INFORMADOS"),
      aceptados: readTag(inner, "ACEPTADOS"),
      rechazados: readTag(inner, "RECHAZADOS"),
      reparos: readTag(inner, "REPAROS"),
    },
    raw: inner,
  };
}

export async function queryBoletaUploadStatus(input: {
  endpoints: SiiEndpoints;
  token: string;
  rutEmisor: string;
  trackId: string;
  http?: SiiHttpOptions;
}): Promise<EnvioStatus> {
  const { body: rut, dv } = splitRut(input.rutEmisor);
  const url = `${input.endpoints.boleta.uploadStatus}/${rut}-${dv}-${encodeURIComponent(input.trackId)}`;
  const response = await siiFetch(url, { method: "GET", headers: { Cookie: `TOKEN=${input.token}`, Accept: "application/json" } }, input.http);
  const text = await response.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* respuesta no JSON */ }
  if (!response.ok || !body) throw new SiiError(`El SII respondio HTTP ${response.status} al consultar el envio de boletas`, "SII_BOLETA_STATUS_HTTP", body || text.slice(0, 500));
  // VERIFICAR-SII: estructura { estado, estadistica[], detalle_rep_rech[] }.
  const code = String(body.estado ?? "");
  const interpreted = interpretEnvioState(code);
  return {
    trackId: input.trackId,
    code,
    state: interpreted.state,
    message: interpreted.message,
    detail: { estadistica: body.estadistica ?? null, rechazos: body.detalle_rep_rech ?? null },
    raw: body,
  };
}

/** Fecha YYYY-MM-DD a DDMMAAAA (formato de QueryEstDte). */
function ddmmyyyy(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}${m}${y}`;
}

export async function queryDteDocumentStatus(input: {
  endpoints: SiiEndpoints;
  token: string;
  rutConsultante: string;
  rutEmisor: string;
  rutReceptor: string;
  type: DteType;
  folio: number;
  fechaEmision: string;
  montoTotal: number;
  http?: SiiHttpOptions;
}) {
  const consultante = splitRut(input.rutConsultante);
  const company = splitRut(input.rutEmisor);
  const receptor = splitRut(input.rutReceptor);
  const soap = await postSoap(input.endpoints.dte.queryDocument, [
    "<getEstDte>",
    `<RutConsultante>${consultante.body}</RutConsultante><DvConsultante>${consultante.dv}</DvConsultante>`,
    `<RutCompania>${company.body}</RutCompania><DvCompania>${company.dv}</DvCompania>`,
    `<RutReceptor>${receptor.body}</RutReceptor><DvReceptor>${receptor.dv}</DvReceptor>`,
    `<TipoDte>${input.type}</TipoDte><FolioDte>${input.folio}</FolioDte>`,
    `<FechaEmisionDte>${ddmmyyyy(input.fechaEmision)}</FechaEmisionDte><MontoDte>${input.montoTotal}</MontoDte>`,
    `<Token>${input.token}</Token>`,
    "</getEstDte>",
  ].join(""), input.http);
  const inner = decodeXmlEntities(readTag(soap, "getEstDteReturn") || "");
  return { code: readTag(inner, "ESTADO") || "", message: readTag(inner, "GLOSA_ESTADO") || readTag(inner, "GLOSA") || "", raw: inner };
}
