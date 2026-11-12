/**
 * Tipos del dominio de Documentos Tributarios Electronicos (DTE).
 * Ver docs/PARKIA_PLAN_V2.md seccion 3.
 */

export type DteType = 33 | 34 | 39 | 41 | 56 | 61;

export const BOLETA_TYPES: readonly DteType[] = [39, 41];
export const DTE_TYPE_LABELS: Record<DteType, string> = {
  33: "Factura electronica",
  34: "Factura no afecta o exenta electronica",
  39: "Boleta electronica",
  41: "Boleta exenta electronica",
  56: "Nota de debito electronica",
  61: "Nota de credito electronica",
};

export function isBoleta(type: DteType) {
  return type === 39 || type === 41;
}

export function isExenta(type: DteType) {
  return type === 34 || type === 41;
}

export type SiiEnvironment = "certificacion" | "produccion";

export type DteEmisor = {
  rut: string;
  razonSocial: string;
  giro: string;
  /** Codigos de actividad economica (1 a 4). Obligatorio en facturas y notas. */
  acteco?: number[];
  direccion: string;
  comuna: string;
  ciudad?: string;
  codigoSucursalSii?: number;
  telefono?: string;
  correo?: string;
};

export type DteReceptor = {
  rut: string;
  razonSocial: string;
  giro?: string;
  direccion?: string;
  comuna?: string;
  ciudad?: string;
  correo?: string;
  contacto?: string;
};

export type DteItem = {
  nombre: string;
  descripcion?: string;
  cantidad?: number;
  unidad?: string;
  /**
   * Precio unitario. En boletas va con IVA incluido; en facturas y notas va neto.
   * Si se omite, se usa monto / cantidad.
   */
  precioUnitario?: number;
  /** Monto de la linea en pesos enteros, mismo criterio de IVA que precioUnitario. */
  monto: number;
  exento?: boolean;
};

export type DteReferencia = {
  /** Tipo del documento referenciado (33, 39, ...), o "SET" para el set de pruebas del SII. */
  tipoDocumento: number | string;
  folio: number | string;
  fecha: string;
  /** 1 = anula, 2 = corrige texto, 3 = corrige montos. */
  codigo?: 1 | 2 | 3;
  razon?: string;
};

export type DteDocumentInput = {
  type: DteType;
  folio: number;
  /** Fecha de emision YYYY-MM-DD en hora local de Chile. */
  fechaEmision: string;
  emisor: DteEmisor;
  /**
   * Opcional en boletas: sin receptor se emite a consumidor final anonimo.
   * Obligatorio en facturas y notas.
   */
  receptor?: DteReceptor | null;
  items: DteItem[];
  referencias?: DteReferencia[];
  /** Forma de pago de facturas: 1 contado, 2 credito, 3 sin costo. */
  formaPago?: 1 | 2 | 3;
  /** Solo boletas: 3 = ventas y servicios (por defecto). */
  indicadorServicio?: 1 | 2 | 3 | 4;
};

export type DteTotals = {
  neto: number;
  exento: number;
  iva: number;
  total: number;
  tasaIva: number;
};

export type SignedDte = {
  type: DteType;
  folio: number;
  documentId: string;
  /** XML del elemento <DTE> sin firmar aun (la firma se aplica dentro del sobre). */
  dteXml: string;
  tedXml: string;
  /** Cadena exacta que va en el codigo PDF417 de la representacion impresa. */
  tedBarcode: string;
  totals: DteTotals;
  timestampFirma: string;
};

export type EnvioResult = {
  trackId: string;
  status: "uploaded";
  raw: unknown;
};

export type EnvioStatus = {
  trackId: string;
  /** Codigo de estado del SII (EPR, RPR, RCH, RCT, RFR, REC, ...). */
  code: string;
  state: "pending" | "accepted" | "accepted_with_objections" | "rejected";
  message: string;
  detail?: unknown;
  raw: unknown;
};

/** Interfaz de proveedor DTE: integracion directa con el SII u otro proveedor intermediario. */
export interface DteProvider {
  readonly name: string;
  /** Genera, timbra y deja listo un documento (sin enviarlo). */
  issue(input: DteDocumentInput): Promise<SignedDte>;
  /** Firma y envia un lote de documentos del mismo grupo (boletas o resto de DTE). */
  sendBatch(documents: SignedDte[]): Promise<EnvioResult & { envioXml: string }>;
  queryStatus(trackId: string, kind: "boleta" | "dte"): Promise<EnvioStatus>;
}
