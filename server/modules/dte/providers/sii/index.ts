import type { DteDocumentInput, DteProvider, EnvioStatus, SignedDte, SiiEnvironment } from "../../types";
import { getSiiToken } from "./auth";
import { buildDte } from "./builder";
import type { ParsedCaf } from "./caf";
import type { LoadedCertificate } from "./cert";
import { queryBoletaUploadStatus, queryDteUploadStatus, uploadBoletaEnvelope, uploadDteEnvelope } from "./client";
import { getSiiEndpoints } from "./endpoints";
import { buildEnvelope } from "./envelope";
import type { SiiHttpOptions } from "./http";

/**
 * Proveedor DTE con integracion directa al SII. No toca la base de datos: recibe el
 * certificado y los CAF ya descifrados y devuelve XML, track id y estados.
 * El servicio del modulo (persistencia, folios, colas) se apoya en esta clase.
 */

export type SiiProviderConfig = {
  environment: SiiEnvironment;
  /** Debe ser true para hablar con produccion. */
  allowProduction?: boolean;
  rutEmisor: string;
  /** RUT de quien envia; por defecto el del certificado. */
  rutEnvia?: string;
  fechaResolucion: string;
  numeroResolucion: number;
  certificate: LoadedCertificate;
  /** Busca el CAF que cubre un tipo y folio. */
  resolveCaf: (type: number, folio: number) => ParsedCaf;
  http?: SiiHttpOptions;
};

export class SiiDteProvider implements DteProvider {
  readonly name = "sii";
  private readonly endpoints;

  constructor(private readonly config: SiiProviderConfig) {
    this.endpoints = getSiiEndpoints(config.environment, { allowProduction: config.allowProduction });
  }

  private get rutEnvia() {
    const rut = this.config.rutEnvia || this.config.certificate.subjectRut;
    if (!rut) throw new Error("No se pudo determinar el RUT de quien envia: ingreselo en la configuracion");
    return rut;
  }

  async issue(input: DteDocumentInput): Promise<SignedDte> {
    return buildDte(input, this.config.resolveCaf(input.type, input.folio));
  }

  buildEnvelope(documents: SignedDte[]) {
    return buildEnvelope(documents, {
      rutEmisor: this.config.rutEmisor,
      rutEnvia: this.rutEnvia,
      fechaResolucion: this.config.fechaResolucion,
      numeroResolucion: this.config.numeroResolucion,
    }, this.config.certificate);
  }

  async token(kind: "dte" | "boleta", forceRefresh = false) {
    return getSiiToken({ kind, endpoints: this.endpoints, cert: this.config.certificate, http: this.config.http, forceRefresh });
  }

  async sendBatch(documents: SignedDte[]) {
    const envelope = this.buildEnvelope(documents);
    const token = await this.token(envelope.kind);
    const upload = {
      endpoints: this.endpoints,
      token,
      rutEmisor: this.config.rutEmisor,
      rutEnvia: this.rutEnvia,
      envelope: envelope.bytes,
      http: this.config.http,
    };
    const result = envelope.kind === "boleta" ? await uploadBoletaEnvelope(upload) : await uploadDteEnvelope(upload);
    return { trackId: result.trackId, status: "uploaded" as const, raw: result.raw, envioXml: envelope.xml };
  }

  async queryStatus(trackId: string, kind: "boleta" | "dte"): Promise<EnvioStatus> {
    const token = await this.token(kind);
    const query = { endpoints: this.endpoints, token, rutEmisor: this.config.rutEmisor, trackId, http: this.config.http };
    return kind === "boleta" ? queryBoletaUploadStatus(query) : queryDteUploadStatus(query);
  }
}
