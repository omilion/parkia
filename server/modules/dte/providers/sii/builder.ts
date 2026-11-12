import type { DteDocumentInput, DteItem, DteTotals, DteType, SignedDte } from "../../types";
import { isBoleta, isExenta } from "../../types";
import type { ParsedCaf } from "./caf";
import { cafContainsFolio } from "./caf";
import { CONSUMIDOR_FINAL_RUT, normalizeRut } from "./rut";
import { buildTed } from "./ted";
import { chileTimestamp, cleanText, el, escapeXml, group } from "./xml";

/**
 * Construccion del XML de un DTE segun DTE_v10.xsd (facturas y notas) y EnvioBOLETA_v11.xsd (boletas).
 * El resultado es el elemento <DTE> con el TED incluido y sin firma: la firma XMLDSig del
 * documento se aplica al armar el sobre (envelope.ts), en el mismo contexto en que el SII la verifica.
 */

export const IVA_RATE = 19;
const DEFAULT_RSR_SIN_RECEPTOR = "CONSUMIDOR FINAL"; // VERIFICAR-SII: texto de RSR en boletas sin receptor.

export class DteValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Documento invalido: ${issues.join("; ")}`);
    this.name = "DteValidationError";
  }
}

function assertIntegerAmount(value: number, label: string, issues: string[]) {
  if (!Number.isInteger(value) || value < 0) issues.push(`${label} debe ser un entero en pesos mayor o igual a 0`);
}

/** Formatea cantidades y precios unitarios: enteros sin decimales, si no hasta 4 decimales. */
function formatDecimal(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function computeTotals(type: DteType, items: DteItem[]): DteTotals {
  const exempt = isExenta(type)
    ? items.reduce((sum, item) => sum + item.monto, 0)
    : items.filter(item => item.exento).reduce((sum, item) => sum + item.monto, 0);
  const affected = isExenta(type) ? 0 : items.filter(item => !item.exento).reduce((sum, item) => sum + item.monto, 0);

  if (isBoleta(type)) {
    // En boletas los montos de linea incluyen IVA: se desglosa el neto desde el bruto.
    const neto = Math.round(affected / (1 + IVA_RATE / 100));
    const iva = affected - neto;
    return { neto, exento: exempt, iva, total: affected + exempt, tasaIva: IVA_RATE };
  }

  // En facturas y notas los montos de linea son netos.
  const iva = Math.round(affected * IVA_RATE / 100);
  return { neto: affected, exento: exempt, iva, total: affected + iva + exempt, tasaIva: IVA_RATE };
}

export function validateInput(input: DteDocumentInput, caf?: Pick<ParsedCaf, "type" | "folioFrom" | "folioTo" | "rutEmisor">) {
  const issues: string[] = [];
  if (!Number.isInteger(input.folio) || input.folio < 1) issues.push("Folio invalido");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaEmision)) issues.push("Fecha de emision debe ser YYYY-MM-DD");
  if (!input.items.length) issues.push("El documento debe tener al menos un item");
  if (input.items.length > 1000) issues.push("Maximo 1000 lineas de detalle");

  try { normalizeRut(input.emisor.rut); } catch { issues.push("RUT del emisor invalido"); }
  if (!cleanText(input.emisor.razonSocial)) issues.push("Falta razon social del emisor");
  if (!cleanText(input.emisor.giro)) issues.push("Falta giro del emisor");
  if (!cleanText(input.emisor.direccion)) issues.push("Falta direccion del emisor");
  if (!cleanText(input.emisor.comuna)) issues.push("Falta comuna del emisor");

  if (!isBoleta(input.type)) {
    if (!input.emisor.acteco?.length) issues.push("Facturas y notas requieren al menos un codigo de actividad economica (Acteco)");
    if (input.emisor.acteco && input.emisor.acteco.length > 4) issues.push("Maximo 4 codigos de actividad economica");
    const receptor = input.receptor;
    if (!receptor) {
      issues.push("Facturas y notas requieren receptor");
    } else {
      try { normalizeRut(receptor.rut); } catch { issues.push("RUT del receptor invalido"); }
      if (!cleanText(receptor.razonSocial)) issues.push("Falta razon social del receptor");
      if (input.type === 33 || input.type === 34) {
        if (!cleanText(receptor.giro)) issues.push("Falta giro del receptor");
        if (!cleanText(receptor.direccion)) issues.push("Falta direccion del receptor");
        if (!cleanText(receptor.comuna)) issues.push("Falta comuna del receptor");
      }
    }
    if ((input.type === 56 || input.type === 61) && !input.referencias?.length) {
      issues.push("Notas de credito y debito deben referenciar el documento que modifican");
    }
  } else if (input.receptor) {
    try { normalizeRut(input.receptor.rut); } catch { issues.push("RUT del receptor invalido"); }
  }

  input.items.forEach((item, index) => {
    if (!cleanText(item.nombre)) issues.push(`Item ${index + 1}: falta nombre`);
    assertIntegerAmount(item.monto, `Item ${index + 1}: monto`, issues);
    if (item.cantidad !== undefined && !(item.cantidad > 0)) issues.push(`Item ${index + 1}: cantidad debe ser mayor a 0`);
  });

  if (caf) {
    if (caf.type !== input.type) issues.push(`El CAF es de tipo ${caf.type} y el documento de tipo ${input.type}`);
    if (!cafContainsFolio(caf, input.folio)) issues.push(`El folio ${input.folio} no esta en el rango del CAF (${caf.folioFrom}-${caf.folioTo})`);
    try {
      if (normalizeRut(caf.rutEmisor) !== normalizeRut(input.emisor.rut)) issues.push("El CAF pertenece a otro emisor");
    } catch { /* ya informado */ }
  }

  if (issues.length) throw new DteValidationError(issues);
}

export function documentId(type: DteType, folio: number) {
  return `T${type}F${folio}`;
}

function buildIdDoc(input: DteDocumentInput) {
  if (isBoleta(input.type)) {
    return group("IdDoc", [
      el("TipoDTE", input.type),
      el("Folio", input.folio),
      el("FchEmis", input.fechaEmision),
      el("IndServicio", input.indicadorServicio || 3),
    ]);
  }
  return group("IdDoc", [
    el("TipoDTE", input.type),
    el("Folio", input.folio),
    el("FchEmis", input.fechaEmision),
    el("FmaPago", input.formaPago),
  ]);
}

function buildEmisor(input: DteDocumentInput) {
  const emisor = input.emisor;
  if (isBoleta(input.type)) {
    return group("Emisor", [
      el("RUTEmisor", normalizeRut(emisor.rut)),
      el("RznSocEmisor", emisor.razonSocial, { maxLength: 100 }),
      el("GiroEmisor", emisor.giro, { maxLength: 80 }),
      el("CdgSIISucur", emisor.codigoSucursalSii),
      el("DirOrigen", emisor.direccion, { maxLength: 70 }),
      el("CmnaOrigen", emisor.comuna, { maxLength: 20 }),
      el("CiudadOrigen", emisor.ciudad, { maxLength: 20 }),
    ]);
  }
  return group("Emisor", [
    el("RUTEmisor", normalizeRut(emisor.rut)),
    el("RznSoc", emisor.razonSocial, { maxLength: 100 }),
    el("GiroEmis", emisor.giro, { maxLength: 80 }),
    el("Telefono", emisor.telefono, { maxLength: 20 }),
    el("CorreoEmisor", emisor.correo, { maxLength: 80 }),
    ...(emisor.acteco || []).slice(0, 4).map(code => el("Acteco", code)),
    el("CdgSIISucur", emisor.codigoSucursalSii),
    el("DirOrigen", emisor.direccion, { maxLength: 70 }),
    el("CmnaOrigen", emisor.comuna, { maxLength: 20 }),
    el("CiudadOrigen", emisor.ciudad, { maxLength: 20 }),
  ]);
}

function buildReceptor(input: DteDocumentInput) {
  const receptor = input.receptor;
  if (isBoleta(input.type)) {
    // Boleta a consumidor final: solo el RUT generico, sin datos personales.
    if (!receptor) return group("Receptor", [el("RUTRecep", CONSUMIDOR_FINAL_RUT)]);
    return group("Receptor", [
      el("RUTRecep", normalizeRut(receptor.rut)),
      el("RznSocRecep", receptor.razonSocial, { maxLength: 100 }),
      el("Contacto", receptor.contacto, { maxLength: 80 }),
      el("CorreoRecep", receptor.correo, { maxLength: 80 }),
      el("DirRecep", receptor.direccion, { maxLength: 70 }),
      el("CmnaRecep", receptor.comuna, { maxLength: 20 }),
      el("CiudadRecep", receptor.ciudad, { maxLength: 20 }),
    ]);
  }
  if (!receptor) throw new DteValidationError(["Facturas y notas requieren receptor"]);
  return group("Receptor", [
    el("RUTRecep", normalizeRut(receptor.rut)),
    el("RznSocRecep", receptor.razonSocial, { maxLength: 100 }),
    el("GiroRecep", receptor.giro, { maxLength: 40 }),
    el("Contacto", receptor.contacto, { maxLength: 80 }),
    el("CorreoRecep", receptor.correo, { maxLength: 80 }),
    el("DirRecep", receptor.direccion, { maxLength: 70 }),
    el("CmnaRecep", receptor.comuna, { maxLength: 20 }),
    el("CiudadRecep", receptor.ciudad, { maxLength: 20 }),
  ]);
}

function buildTotales(type: DteType, totals: DteTotals) {
  if (isBoleta(type)) {
    if (type === 41) return group("Totales", [el("MntExe", totals.exento), el("MntTotal", totals.total)]);
    return group("Totales", [
      el("MntNeto", totals.neto),
      totals.exento > 0 ? el("MntExe", totals.exento) : "",
      el("IVA", totals.iva),
      el("MntTotal", totals.total),
    ]);
  }
  if (type === 34) return group("Totales", [el("MntExe", totals.exento), el("MntTotal", totals.total)]);
  return group("Totales", [
    el("MntNeto", totals.neto),
    totals.exento > 0 ? el("MntExe", totals.exento) : "",
    el("TasaIVA", totals.tasaIva),
    el("IVA", totals.iva),
    el("MntTotal", totals.total),
  ]);
}

function buildDetalle(type: DteType, item: DteItem, index: number) {
  const cantidad = item.cantidad ?? 1;
  const precio = item.precioUnitario ?? item.monto / cantidad;
  // En documentos exentos (34, 41) todas las lineas son exentas por definicion; IndExe solo en documentos afectos.
  const indExe = item.exento && !isExenta(type) ? el("IndExe", 1) : "";
  const nombreMax = 80;
  return group("Detalle", [
    el("NroLinDet", index + 1),
    indExe,
    el("NmbItem", item.nombre, { maxLength: nombreMax }),
    el("DscItem", item.descripcion, { maxLength: 1000 }),
    `<QtyItem>${formatDecimal(cantidad)}</QtyItem>`,
    el("UnmdItem", item.unidad, { maxLength: 4 }),
    `<PrcItem>${formatDecimal(precio)}</PrcItem>`,
    el("MontoItem", item.monto),
  ]);
}

function buildReferencias(input: DteDocumentInput) {
  return (input.referencias || []).map((ref, index) => {
    if (isBoleta(input.type)) {
      // El esquema de boletas no tiene FchRef y CodRef es texto libre (p. ej. "SET" en certificacion).
      return group("Referencia", [
        el("NroLinRef", index + 1),
        el("TpoDocRef", String(ref.tipoDocumento), { maxLength: 3 }),
        el("FolioRef", String(ref.folio), { maxLength: 18 }),
        el("CodRef", ref.codigo !== undefined ? String(ref.codigo) : (String(ref.tipoDocumento) === "SET" ? "SET" : undefined), { maxLength: 18 }),
        el("RazonRef", ref.razon, { maxLength: 90 }),
      ]);
    }
    return group("Referencia", [
      el("NroLinRef", index + 1),
      el("TpoDocRef", String(ref.tipoDocumento), { maxLength: 3 }),
      el("FolioRef", String(ref.folio), { maxLength: 18 }),
      el("FchRef", ref.fecha),
      el("CodRef", ref.codigo),
      el("RazonRef", ref.razon, { maxLength: 90 }),
    ]);
  }).join("");
}

/**
 * Arma el <DTE> completo con TED. Lanza DteValidationError si faltan datos.
 * `now` permite fijar la hora en tests.
 */
export function buildDte(input: DteDocumentInput, caf: ParsedCaf, options: { now?: Date } = {}): SignedDte {
  validateInput(input, caf);
  const totals = computeTotals(input.type, input.items);
  const timestamp = chileTimestamp(options.now);
  const id = documentId(input.type, input.folio);

  const receptorRut = input.receptor ? normalizeRut(input.receptor.rut) : CONSUMIDOR_FINAL_RUT;
  const receptorNombre = input.receptor?.razonSocial || DEFAULT_RSR_SIN_RECEPTOR;
  const ted = buildTed({
    rutEmisor: normalizeRut(input.emisor.rut),
    type: input.type,
    folio: input.folio,
    fechaEmision: input.fechaEmision,
    rutReceptor: receptorRut,
    razonSocialReceptor: receptorNombre,
    montoTotal: totals.total,
    primerItem: input.items[0].nombre,
    cafXml: caf.cafXml,
    cafPrivateKey: caf.privateKey,
    timestamp,
  });

  const encabezado = group("Encabezado", [
    buildIdDoc(input),
    buildEmisor(input),
    buildReceptor(input),
    buildTotales(input.type, totals),
  ]);

  const documento = [
    `<Documento ID="${escapeXml(id)}">`,
    encabezado,
    input.items.map((item, index) => buildDetalle(input.type, item, index)).join(""),
    buildReferencias(input),
    ted.tedXml,
    `<TmstFirma>${timestamp}</TmstFirma>`,
    "</Documento>",
  ].join("");

  return {
    type: input.type,
    folio: input.folio,
    documentId: id,
    dteXml: `<DTE version="1.0">${documento}</DTE>`,
    tedXml: ted.tedXml,
    tedBarcode: ted.tedXml,
    totals,
    timestampFirma: timestamp,
  };
}
