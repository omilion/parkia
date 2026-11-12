import type { SiiEnvironment } from "../../types";

/**
 * Servidores del SII por ambiente. Unico lugar donde se definen.
 *
 * VERIFICAR-SII: rutas tomadas del Manual del Desarrollador Externo (DTE) y del
 * Manual de Boleta Electronica (API REST). Confirmar contra la documentacion vigente de sii.cl
 * antes de la primera prueba en certificacion.
 */

export type SiiEndpoints = {
  environment: SiiEnvironment;
  dte: {
    seed: string;
    token: string;
    upload: string;
    queryUpload: string;
    queryDocument: string;
  };
  boleta: {
    seed: string;
    token: string;
    upload: string;
    /** Sufijo: /{rut}-{dv}-{trackid} */
    uploadStatus: string;
    /** Sufijo: /{rut}-{dv}-{tipo}-{folio}/estado */
    documentStatus: string;
  };
};

const ENDPOINTS: Record<SiiEnvironment, SiiEndpoints> = {
  certificacion: {
    environment: "certificacion",
    dte: {
      seed: "https://maullin.sii.cl/DTEWS/CrSeed.jws",
      token: "https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws",
      upload: "https://maullin.sii.cl/cgi_dte/UPL/DTEUpload",
      queryUpload: "https://maullin.sii.cl/DTEWS/QueryEstUp.jws",
      queryDocument: "https://maullin.sii.cl/DTEWS/QueryEstDte.jws",
    },
    boleta: {
      seed: "https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla",
      token: "https://apicert.sii.cl/recursos/v1/boleta.electronica.token",
      upload: "https://pangal.sii.cl/recursos/v1/boleta.electronica.envio",
      uploadStatus: "https://apicert.sii.cl/recursos/v1/boleta.electronica.envio",
      documentStatus: "https://apicert.sii.cl/recursos/v1/boleta.electronica",
    },
  },
  produccion: {
    environment: "produccion",
    dte: {
      seed: "https://palena.sii.cl/DTEWS/CrSeed.jws",
      token: "https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws",
      upload: "https://palena.sii.cl/cgi_dte/UPL/DTEUpload",
      queryUpload: "https://palena.sii.cl/DTEWS/QueryEstUp.jws",
      queryDocument: "https://palena.sii.cl/DTEWS/QueryEstDte.jws",
    },
    boleta: {
      seed: "https://api.sii.cl/recursos/v1/boleta.electronica.semilla",
      token: "https://api.sii.cl/recursos/v1/boleta.electronica.token",
      upload: "https://rahue.sii.cl/recursos/v1/boleta.electronica.envio",
      uploadStatus: "https://api.sii.cl/recursos/v1/boleta.electronica.envio",
      documentStatus: "https://api.sii.cl/recursos/v1/boleta.electronica",
    },
  },
};

/**
 * Produccion exige confirmacion explicita: ningun codigo llega a produccion por omision.
 */
export function getSiiEndpoints(environment: SiiEnvironment, options: { allowProduction?: boolean } = {}): SiiEndpoints {
  if (environment === "produccion" && !options.allowProduction) {
    throw new Error("Acceso a produccion del SII bloqueado: requiere allowProduction explicito");
  }
  return ENDPOINTS[environment];
}

/**
 * VERIFICAR-SII: el servicio de carga historicamente rechaza clientes sin este User-Agent.
 */
export const SII_UPLOAD_USER_AGENT = "Mozilla/4.0 (compatible; PROG 1.0; Windows NT 5.0; YComp 5.0.2.4)";
