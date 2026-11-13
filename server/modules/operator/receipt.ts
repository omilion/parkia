import { db } from "../../db";
import { tedToPng } from "../dte/pdf417";

/**
 * Datos para imprimir el comprobante de un ticket cobrado. Si ya se emitio la boleta electronica,
 * se incluye su timbre (PDF417) como imagen PNG: asi cualquier impresora termica lo imprime como
 * trama, sin depender de comandos nativos de codigo de barras que cambian de marca en marca.
 */
export async function buildTicketReceipt(tenantId: number, ticketId: number) {
  const ticket = await db.prepare(`
    SELECT vt.id, vt.plate, vt.status, vt.entry_time, vt.exit_time, vt.paid_at, vt.amount, vt.payment_method, vt.public_token,
           vt.exit_deadline, s.name AS space_name, b.name AS branch_name
    FROM visitor_tickets vt
    LEFT JOIN spaces s ON s.id = vt.space_id
    LEFT JOIN branches b ON b.id = vt.branch_id
    WHERE vt.id = ? AND vt.tenant_id = ?
  `).get(ticketId, tenantId) as Record<string, any> | undefined;
  if (!ticket) return null;

  const company = await db.prepare("SELECT company_name, company_rut FROM tenant_settings WHERE tenant_id = ?").get(tenantId) as { company_name: string | null; company_rut: string | null } | undefined;
  const document = await db.prepare(`
    SELECT id, folio, dte_type, issued_at, total, status, ted_xml
    FROM dte_documents
    WHERE tenant_id = ? AND source_type = 'ticket' AND source_id = ? AND dte_type IN (39, 41) AND status <> 'voided'
    ORDER BY id DESC LIMIT 1
  `).get(tenantId, String(ticketId)) as { id: number; folio: number; dte_type: number; issued_at: string; total: number; status: string; ted_xml: string | null } | undefined;

  let boleta: { document_id: number; folio: number; dte_type: number; issued_at: string; total: number; status: string; ted_png_base64: string | null } | null = null;
  if (document) {
    let png: string | null = null;
    // Un timbre que no se puede dibujar no debe impedir imprimir el comprobante de pago.
    try { png = document.ted_xml ? (await tedToPng(document.ted_xml)).toString("base64") : null; } catch { png = null; }
    boleta = { document_id: document.id, folio: Number(document.folio), dte_type: Number(document.dte_type), issued_at: document.issued_at, total: Number(document.total), status: document.status, ted_png_base64: png };
  }
  return {
    ticket: { ...ticket, amount: Number(ticket.amount || 0) },
    company: { name: company?.company_name || "Estacionamiento", rut: company?.company_rut || null },
    boleta,
  };
}
