import type { EnvioStatus } from "../../types";

/** Traduce respuestas del SII a mensajes accionables en espanol. VERIFICAR-SII: listas de codigos. */

export class SiiError extends Error {
  constructor(message: string, readonly code: string, readonly detail?: unknown) {
    super(message);
    this.name = "SiiError";
  }
}

/** STATUS de la respuesta de DTEUpload (RECEPCIONDTE). */
export const UPLOAD_STATUS_MESSAGES: Record<string, string> = {
  "0": "Envio recibido por el SII",
  "1": "El usuario que envia no tiene permiso para enviar documentos de esta empresa",
  "2": "Error en el tamano del archivo",
  "3": "El archivo llego incompleto",
  "5": "No autenticado: el token es invalido o expiro",
  "6": "La empresa no esta autorizada para enviar documentos electronicos",
  "7": "El sobre no cumple el esquema XML del SII",
  "8": "Error en la firma del sobre o de algun documento",
  "9": "Sistema del SII bloqueado temporalmente; reintentar mas tarde",
};

/** Estados del envio (QueryEstUp y API de boletas). */
const ENVIO_STATES: Record<string, { state: EnvioStatus["state"]; message: string }> = {
  REC: { state: "pending", message: "Envio recibido, en espera de procesamiento" },
  SOK: { state: "pending", message: "Esquema validado, en proceso" },
  FOK: { state: "pending", message: "Firma del envio validada, en proceso" },
  PDR: { state: "pending", message: "Envio en proceso" },
  CRT: { state: "pending", message: "Caratula validada, en proceso" },
  EPR: { state: "accepted", message: "Envio procesado" },
  RPR: { state: "accepted_with_objections", message: "Aceptado con reparos" },
  RLV: { state: "accepted_with_objections", message: "Aceptado con reparos leves" },
  RSC: { state: "rejected", message: "Rechazado por error en el esquema" },
  RFR: { state: "rejected", message: "Rechazado por error en la firma" },
  RCT: { state: "rejected", message: "Rechazado por error en la caratula" },
  RCH: { state: "rejected", message: "Rechazado por el SII" },
  RCS: { state: "rejected", message: "Rechazado por error en el esquema" },
  "102": { state: "rejected", message: "Faltan parametros de entrada" },
  "-11": { state: "pending", message: "Envio aun no procesado por el SII" },
};

export function interpretEnvioState(code: string): { state: EnvioStatus["state"]; message: string } {
  const normalized = String(code || "").trim().toUpperCase();
  return ENVIO_STATES[normalized] || { state: "pending", message: `Estado del SII no reconocido: ${normalized || "(vacio)"}` };
}

/** ESTADO de la respuesta de semilla y token (00 = ok). */
export function assertSiiResponseOk(estado: string | null, step: string, glosa?: string | null) {
  if (estado === "00" || estado === "0") return;
  throw new SiiError(`El SII rechazo la solicitud de ${step} (estado ${estado ?? "desconocido"}${glosa ? `: ${glosa}` : ""})`, `SII_${step.toUpperCase()}_${estado ?? "UNKNOWN"}`);
}
