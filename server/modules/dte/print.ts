import type { DteDocumentRow, DteSettingsRow } from "./service";
import { tedToSvg } from "./pdf417";
import { isBoleta, type DteItem, type DteType } from "./types";

/** Nombres oficiales de los documentos tal como se imprimen. */
const PRINT_LABELS: Record<DteType, string> = {
  33: "Factura Electrónica",
  34: "Factura No Afecta o Exenta Electrónica",
  39: "Boleta Electrónica",
  41: "Boleta Exenta Electrónica",
  56: "Nota de Débito Electrónica",
  61: "Nota de Crédito Electrónica",
};

/**
 * Representacion impresa de un DTE: HTML listo para imprimir en termica de 80 mm o en carta,
 * con el codigo PDF417 del timbre. Cualquier navegador lo imprime o lo guarda como PDF.
 * VERIFICAR-SII: el instructivo exige medidas minimas del codigo y textos exactos; revisar al certificar.
 */

export type PrintFormat = "thermal" | "letter";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = (value: number) => `$${Math.round(value).toLocaleString("es-CL")}`;

function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}

function formatRut(rut: string | null) {
  if (!rut) return "";
  const clean = rut.replace(/[^0-9kK]/g, "").toUpperCase();
  return `${clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${clean.slice(-1)}`;
}

export function renderDocumentHtml(input: { settings: DteSettingsRow; document: DteDocumentRow; format: PrintFormat }) {
  const { settings, document, format } = input;
  const items = JSON.parse(document.items_json) as DteItem[];
  const label = (PRINT_LABELS[document.dte_type] || "Documento tributario").toUpperCase();
  const isTest = document.environment === "certificacion";
  const thermal = format === "thermal";
  const barcode = document.ted_xml ? tedToSvg(document.ted_xml) : "";
  const boleta = isBoleta(document.dte_type);

  const lines = items.map(item => {
    const quantity = item.cantidad ?? 1;
    const detail = [item.descripcion].filter(Boolean).join(" ");
    return `<tr><td class="item"><div>${escapeHtml(item.nombre)}</div>${detail ? `<div class="detail">${escapeHtml(detail)}</div>` : ""}${quantity !== 1 ? `<div class="detail">${escapeHtml(quantity)} x ${money(item.precioUnitario ?? item.monto / quantity)}</div>` : ""}</td><td class="amount">${money(item.monto)}</td></tr>`;
  }).join("");

  const totals = boleta
    ? `<tr><td>Total</td><td class="amount total">${money(document.total)}</td></tr><tr class="note"><td colspan="2">El IVA de esta boleta es ${money(document.iva)}</td></tr>`
    : `${document.neto ? `<tr><td>Neto</td><td class="amount">${money(document.neto)}</td></tr>` : ""}${document.exento ? `<tr><td>Exento</td><td class="amount">${money(document.exento)}</td></tr>` : ""}<tr><td>IVA 19%</td><td class="amount">${money(document.iva)}</td></tr><tr><td>Total</td><td class="amount total">${money(document.total)}</td></tr>`;

  const receptor = document.receptor_rut
    ? `<div class="block"><strong>Cliente:</strong> ${escapeHtml(document.receptor_razon)}<br>RUT: ${escapeHtml(formatRut(document.receptor_rut))}${document.receptor_direccion ? `<br>${escapeHtml(document.receptor_direccion)}${document.receptor_comuna ? `, ${escapeHtml(document.receptor_comuna)}` : ""}` : ""}</div>`
    : "";

  const resolution = settings.resolucion_fecha
    ? `Res. N° ${settings.resolucion_numero ?? 0} de ${formatDate(settings.resolucion_fecha)}`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(label)} N° ${document.folio}</title>
<style>
  @page { size: ${thermal ? "80mm auto" : "letter"}; margin: ${thermal ? "3mm" : "15mm"}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: ${thermal ? "11px" : "13px"}; }
  .sheet { width: ${thermal ? "74mm" : "auto"}; max-width: ${thermal ? "74mm" : "190mm"}; margin: 0 auto; padding: ${thermal ? "0" : "0"}; }
  .head { ${thermal ? "text-align: center;" : "display: flex; justify-content: space-between; gap: 16px; align-items: flex-start;"} }
  .emisor { ${thermal ? "" : "flex: 1;"} }
  .emisor h1 { font-size: ${thermal ? "14px" : "18px"}; margin: 0 0 4px; }
  .box { border: 2px solid #000; padding: 8px 12px; text-align: center; font-weight: 700; ${thermal ? "margin: 8px 0;" : "min-width: 230px;"} }
  .box div + div { margin-top: 4px; }
  .sii { font-size: ${thermal ? "11px" : "12px"}; font-weight: 700; margin-top: 4px; }
  .block { margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 1px solid #000; padding: 4px 0; font-size: ${thermal ? "10px" : "12px"}; }
  th.amount, td.amount { text-align: right; white-space: nowrap; }
  td { padding: 3px 0; vertical-align: top; }
  .detail { font-size: ${thermal ? "9px" : "11px"}; color: #333; }
  .totals { margin-top: 6px; border-top: 1px solid #000; }
  .totals td { padding: 2px 0; }
  .total { font-weight: 700; font-size: ${thermal ? "13px" : "15px"}; }
  .note td { font-size: ${thermal ? "9px" : "11px"}; }
  .ted { margin-top: 12px; text-align: center; }
  .ted svg { width: ${thermal ? "70mm" : "9cm"}; height: auto; max-width: 100%; }
  .legal { text-align: center; font-size: ${thermal ? "9px" : "11px"}; margin-top: 4px; }
  .test { margin: 8px 0; border: 2px dashed #b00; color: #b00; text-align: center; font-weight: 700; padding: 6px; }
</style>
</head>
<body>
<div class="sheet">
  ${isTest ? '<div class="test">DOCUMENTO DE PRUEBA - SIN VALIDEZ TRIBUTARIA</div>' : ""}
  <div class="head">
    <div class="emisor">
      <h1>${escapeHtml(settings.razon_social)}</h1>
      <div>${escapeHtml(settings.giro)}</div>
      <div>${escapeHtml(settings.direccion)}${settings.comuna ? `, ${escapeHtml(settings.comuna)}` : ""}</div>
    </div>
    <div>
      <div class="box">
        <div>R.U.T.: ${escapeHtml(formatRut(settings.rut_emisor))}</div>
        <div>${escapeHtml(label)}</div>
        <div>N° ${document.folio}</div>
      </div>
      <div class="sii" style="text-align:center">S.I.I. - ${escapeHtml(settings.sii_unidad)}</div>
    </div>
  </div>
  <div class="block">Fecha de emisión: ${escapeHtml(formatDate(document.issued_at))}</div>
  ${receptor}
  <table>
    <thead><tr><th>Detalle</th><th class="amount">Monto</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <table class="totals"><tbody>${totals}</tbody></table>
  <div class="ted">${barcode}</div>
  <div class="legal"><strong>Timbre Electrónico SII</strong><br>${escapeHtml(resolution)}<br>Verifique este documento en www.sii.cl</div>
</div>
</body>
</html>`;
}
