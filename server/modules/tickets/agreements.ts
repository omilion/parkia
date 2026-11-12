import { db } from "../../db";
import { runWithTenant } from "../../db/engine/context";
import { resolveStoredFile, storeDocumentFile } from "../../storage";
import type { AgreementValues, LostTicketValues } from "../../../shared/schemas/pricing";

/**
 * Convenios con comercios (minutos gratis, porcentaje o monto fijo) y su validacion sobre un
 * ticket, mas el flujo formal de ticket perdido.
 */

export type AgreementRow = {
  id: number;
  tenant_id: number;
  branch_id: number | null;
  name: string;
  code: string;
  kind: "free_minutes" | "percent" | "fixed";
  value: number;
  cap_amount: number | null;
  status: "active" | "inactive";
  notes: string | null;
  created_at: string;
};

export class AgreementError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "AGREEMENT_ERROR") {
    super(message);
    this.name = "AgreementError";
  }
}

export async function listAgreements(tenantId: number) {
  return await db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM ticket_validations v WHERE v.agreement_id = a.id) AS validations_count
    FROM agreements a WHERE a.tenant_id = ? ORDER BY a.status ASC, a.name ASC
  `).all(tenantId) as Array<AgreementRow & { validations_count: number }>;
}

async function assertCodeFree(code: string, exceptId?: number) {
  const taken = await db.prepare("SELECT id FROM agreements WHERE code = ?").get(code) as { id: number } | undefined;
  if (taken && taken.id !== exceptId) throw new AgreementError("Ese código ya está en uso por otro convenio; elige otro", 409, "CODE_TAKEN");
}

export async function createAgreement(tenantId: number, values: AgreementValues) {
  await assertCodeFree(values.code);
  const result = await db.prepare(`
    INSERT INTO agreements (tenant_id, branch_id, name, code, kind, value, cap_amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tenantId, values.branch_id ?? null, values.name, values.code, values.kind, values.value, values.cap_amount ?? null, values.status, values.notes ?? null);
  return await db.prepare("SELECT * FROM agreements WHERE id = ?").get(result.lastInsertRowid) as AgreementRow;
}

export async function updateAgreement(tenantId: number, id: number, values: AgreementValues) {
  const current = await db.prepare("SELECT * FROM agreements WHERE id = ? AND tenant_id = ?").get(id, tenantId) as AgreementRow | undefined;
  if (!current) throw new AgreementError("Convenio no encontrado", 404, "NOT_FOUND");
  await assertCodeFree(values.code, id);
  await db.prepare(`
    UPDATE agreements SET branch_id = ?, name = ?, code = ?, kind = ?, value = ?, cap_amount = ?, status = ?, notes = ?
    WHERE id = ? AND tenant_id = ?
  `).run(values.branch_id ?? null, values.name, values.code, values.kind, values.value, values.cap_amount ?? null, values.status, values.notes ?? null, id, tenantId);
  return await db.prepare("SELECT * FROM agreements WHERE id = ?").get(id) as AgreementRow;
}

function maskPlate(plate: string) {
  const clean = plate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return clean.length <= 4 ? clean : `${clean.slice(0, 2)}${"•".repeat(clean.length - 4)}${clean.slice(-2)}`;
}

function describe(agreement: AgreementRow) {
  if (agreement.kind === "free_minutes") return `${agreement.value} minutos gratis`;
  if (agreement.kind === "percent") return `${agreement.value}% de descuento`;
  return `$${Number(agreement.value).toLocaleString("es-CL")} de descuento`;
}

/**
 * Aplica un convenio a un ticket abierto. Un comercio valida un ticket una sola vez.
 * Las cotizaciones vigentes del ticket se anulan para que la siguiente incluya el descuento.
 */
export async function validateTicketWithAgreement(input: { tenantId: number; ticketId: number; agreementId: number; validatedBy: "merchant" | "staff"; staffId?: number | null }) {
  return await db.transaction(async () => {
    const ticket = await db.prepare("SELECT id, plate, status FROM visitor_tickets WHERE id = ? AND tenant_id = ?")
      .get(input.ticketId, input.tenantId) as { id: number; plate: string; status: string } | undefined;
    if (!ticket) throw new AgreementError("Ticket no encontrado", 404, "TICKET_NOT_FOUND");
    if (ticket.status !== "active") throw new AgreementError("Este ticket ya no admite validaciones (está pagado o finalizado)", 409, "TICKET_CLOSED");
    const agreement = await db.prepare("SELECT * FROM agreements WHERE id = ? AND tenant_id = ?").get(input.agreementId, input.tenantId) as AgreementRow | undefined;
    if (!agreement || agreement.status !== "active") throw new AgreementError("El convenio no está vigente", 404, "AGREEMENT_INACTIVE");
    const already = await db.prepare("SELECT id FROM ticket_validations WHERE ticket_id = ? AND agreement_id = ?").get(ticket.id, agreement.id);
    if (already) throw new AgreementError("Este ticket ya fue validado por este comercio", 409, "ALREADY_VALIDATED");

    const inserted = await db.prepare(`
      INSERT INTO ticket_validations (tenant_id, ticket_id, agreement_id, validated_by, staff_id) VALUES (?, ?, ?, ?, ?)
    `).run(input.tenantId, ticket.id, agreement.id, input.validatedBy, input.staffId ?? null);
    await db.prepare("UPDATE visitor_ticket_quotes SET status = 'void' WHERE ticket_id = ? AND tenant_id = ? AND status = 'quoted'").run(ticket.id, input.tenantId);
    return { validationId: Number(inserted.lastInsertRowid), ticket, agreement };
  })();
}

/**
 * Validacion desde la pantalla publica del comercio: solo codigo y patente, sin sesion.
 * La respuesta no revela datos del cliente (la patente sale enmascarada).
 */
export async function validateFromMerchant(code: string, plate: string) {
  const agreement = await db.prepare("SELECT * FROM agreements WHERE code = ?").get(code.trim().toUpperCase()) as AgreementRow | undefined;
  if (!agreement || agreement.status !== "active") throw new AgreementError("El código no existe o el convenio no está vigente", 404, "AGREEMENT_NOT_FOUND");

  return await runWithTenant(agreement.tenant_id, async () => {
    const normalized = plate.replace(/[\s-]/g, "").toUpperCase();
    const ticket = await db.prepare(`
      SELECT id, plate, branch_id FROM visitor_tickets
      WHERE tenant_id = ? AND status = 'active' AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = ?
      ORDER BY entry_time DESC, id DESC LIMIT 1
    `).get(agreement.tenant_id, normalized) as { id: number; plate: string; branch_id: number | null } | undefined;
    if (!ticket) throw new AgreementError("No hay un ticket activo con esa patente", 404, "TICKET_NOT_FOUND");
    if (agreement.branch_id && ticket.branch_id && agreement.branch_id !== ticket.branch_id) {
      throw new AgreementError("Este convenio no aplica a la sucursal del ticket", 409, "WRONG_BRANCH");
    }
    await validateTicketWithAgreement({ tenantId: agreement.tenant_id, ticketId: ticket.id, agreementId: agreement.id, validatedBy: "merchant" });
    return { ok: true as const, merchant: agreement.name, benefit: describe(agreement), plate: maskPlate(ticket.plate), tenantId: agreement.tenant_id, ticketId: ticket.id, agreementId: agreement.id };
  });
}

export async function listTicketValidationsForStaff(tenantId: number, ticketId: number) {
  return await db.prepare(`
    SELECT v.id, v.validated_by, v.created_at, a.name, a.code, a.kind, a.value, a.cap_amount
    FROM ticket_validations v JOIN agreements a ON a.id = v.agreement_id
    WHERE v.ticket_id = ? AND v.tenant_id = ? ORDER BY v.id
  `).all(ticketId, tenantId);
}

/**
 * Ticket perdido: no hay multa fija. Se cobra el tiempo real registrado y queda constancia de
 * quien lo autorizo, como se verifico al dueño y, opcionalmente, la foto de la cedula o del padron.
 */
export async function registerLostTicket(input: { tenantId: number; ticketId: number; staffId: number | null; values: LostTicketValues }) {
  const ticket = await db.prepare("SELECT id, status, lost_ticket FROM visitor_tickets WHERE id = ? AND tenant_id = ?")
    .get(input.ticketId, input.tenantId) as { id: number; status: string; lost_ticket: number } | undefined;
  if (!ticket) throw new AgreementError("Ticket no encontrado", 404, "TICKET_NOT_FOUND");
  if (ticket.status !== "active") throw new AgreementError("Solo se puede registrar como perdido un ticket abierto", 409, "TICKET_CLOSED");

  const stored = input.values.evidence
    ? storeDocumentFile({ ...input.values.evidence, folder: "lost-ticket-evidence", tenantId: input.tenantId })
    : null;
  await db.prepare(`
    UPDATE visitor_tickets
    SET lost_ticket = 1, lost_ticket_note = ?, lost_ticket_evidence_path = COALESCE(?, lost_ticket_evidence_path),
        lost_ticket_evidence_name = COALESCE(?, lost_ticket_evidence_name), lost_ticket_by_staff_id = ?
    WHERE id = ? AND tenant_id = ?
  `).run(input.values.note, stored?.filePath ?? null, stored?.fileName ?? null, input.staffId, input.ticketId, input.tenantId);
  return { ticketId: input.ticketId, evidence: stored ? { fileName: stored.fileName } : null };
}

export async function resolveLostTicketEvidence(tenantId: number, ticketId: number) {
  const row = await db.prepare("SELECT lost_ticket_evidence_path AS path, lost_ticket_evidence_name AS name FROM visitor_tickets WHERE id = ? AND tenant_id = ?")
    .get(ticketId, tenantId) as { path: string | null; name: string | null } | undefined;
  if (!row?.path) return null;
  return { absolutePath: resolveStoredFile(row.path), fileName: row.name || "evidencia" };
}
