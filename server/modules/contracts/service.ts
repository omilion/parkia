import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getBranchOrDefault } from "../../branches";
import type { PaginationParams } from "../../pagination";
import { createContractPdfBuffer } from "../../pdf";
import { storeDocumentBuffer } from "../../storage";
import {
  createContractInDb,
  findContractBasic,
  findContractEditable,
  getContractDetailFromDb,
  getPrintableContractFromDb,
  insertContractGeneratedDocumentInDb,
  listContractsFromDb,
  renewContractInDb,
  terminateContractInDb,
  updateContractInDb,
  updateContractStatusInDb,
} from "./repo";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export function parseBranchIdQuery(value: unknown) {
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

export function renewContract(
  req: Request,
  contractId: string,
  tenantId: number,
  newEndDate: string
): { ok: true; receivables: any } | { ok: false; status: number; error: string } {
  const contract = findContractBasic(contractId, tenantId);
  if (!contract) return { ok: false, status: 404, error: "Contrato no encontrado" };
  if (contract.status !== "active") return { ok: false, status: 400, error: "Solo se pueden renovar contratos activos" };
  if (contract.end_date && newEndDate <= contract.end_date) {
    return { ok: false, status: 400, error: "La nueva fecha debe ser posterior al vencimiento actual" };
  }

  const receivables = renewContractInDb(contract.id, tenantId, newEndDate);
  recordAuditEvent(req, {
    action: "contract.renewed",
    entityType: "contract",
    entityId: contractId,
    metadata: { previous_end_date: contract.end_date, new_end_date: newEndDate, receivables },
  });
  return { ok: true, receivables };
}

export function suspendContract(
  req: Request,
  contractId: string,
  tenantId: number,
  body: { reason?: string; effective_date?: string }
): { ok: true } | { ok: false; status: number; error: string } {
  const contract = findContractBasic(contractId, tenantId);
  if (!contract) return { ok: false, status: 404, error: "Contrato no encontrado" };
  if (contract.status === "terminated") return { ok: false, status: 400, error: "No se puede suspender un contrato terminado" };
  if (contract.status === "suspended") return { ok: false, status: 400, error: "El contrato ya está suspendido" };

  updateContractStatusInDb(contractId, tenantId, "suspended");
  recordAuditEvent(req, {
    action: "contract.suspended",
    entityType: "contract",
    entityId: contractId,
    metadata: { reason: body.reason, effective_date: body.effective_date || null },
  });
  return { ok: true };
}

export function reactivateContract(
  req: Request,
  contractId: string,
  tenantId: number,
  body: { reason?: string; effective_date?: string }
): { ok: true } | { ok: false; status: number; error: string } {
  const contract = findContractBasic(contractId, tenantId);
  if (!contract) return { ok: false, status: 404, error: "Contrato no encontrado" };
  if (contract.status === "terminated") return { ok: false, status: 400, error: "No se puede reactivar un contrato terminado" };
  if (contract.status === "active") return { ok: false, status: 400, error: "El contrato ya está activo" };

  updateContractStatusInDb(contractId, tenantId, "active");
  recordAuditEvent(req, {
    action: "contract.reactivated",
    entityType: "contract",
    entityId: contractId,
    metadata: { reason: body.reason, effective_date: body.effective_date || null },
  });
  return { ok: true };
}

export function terminateContract(
  req: Request,
  contractId: string,
  tenantId: number,
  body: { reason?: string; effective_date?: string }
): { ok: true; receivables: any } | { ok: false; status: number; error: string } {
  const contract = findContractBasic(contractId, tenantId);
  if (!contract) return { ok: false, status: 404, error: "Contrato no encontrado" };
  if (contract.status === "terminated") return { ok: false, status: 400, error: "El contrato ya está terminado" };

  const effectiveDate = body.effective_date || todayDateString();
  const receivables = terminateContractInDb(contract.id, contract.space_id, tenantId, effectiveDate);
  recordAuditEvent(req, {
    action: "contract.terminated",
    entityType: "contract",
    entityId: contractId,
    metadata: { reason: body.reason, effective_date: effectiveDate, space_id: contract.space_id, receivables },
  });
  return { ok: true, receivables };
}

export function listContracts(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  expiring: boolean;
  search: string;
  pagination: PaginationParams;
}) {
  const branchId = params.rawBranchId ? getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return listContractsFromDb({
    tenantId: params.tenantId,
    branchId,
    status: params.status,
    expiring: params.expiring,
    search: params.search,
    pagination: params.pagination,
  });
}

export function getContractDetail(contractId: string, tenantId: number) {
  return getContractDetailFromDb(contractId, tenantId);
}

export function updateContract(
  req: Request,
  contractId: string,
  tenantId: number,
  body: {
    start_date?: string;
    end_date?: string | null;
    monthly_fee?: number;
    billing_day?: number;
    deposit_amount?: number;
    billing_document_type?: "boleta" | "factura_exenta" | "factura_afecta";
    notes?: string | null;
    reason?: string;
  }
): { ok: true; changes: Record<string, { previous: unknown; next: unknown }>; receivables: any } | { ok: false; status: number; error: string } {
  const existing = findContractEditable(contractId, tenantId);
  if (!existing) return { ok: false, status: 404, error: "Contrato no encontrado" };
  if (existing.status === "terminated") return { ok: false, status: 400, error: "No se puede editar un contrato terminado" };

  const next = {
    start_date: body.start_date ?? existing.start_date,
    end_date: body.end_date === undefined ? existing.end_date : body.end_date,
    monthly_fee: body.monthly_fee ?? existing.monthly_fee,
    billing_day: body.billing_day ?? existing.billing_day,
    deposit_amount: body.deposit_amount ?? existing.deposit_amount,
    billing_document_type: body.billing_document_type ?? existing.billing_document_type,
    notes: body.notes === undefined ? existing.notes : body.notes,
  };

  if (next.end_date && next.start_date > next.end_date) {
    return { ok: false, status: 400, error: "La fecha de termino no puede ser anterior al inicio" };
  }

  const fields = [
    "start_date",
    "end_date",
    "monthly_fee",
    "billing_day",
    "deposit_amount",
    "billing_document_type",
    "notes",
  ] as const;
  const changes = fields.reduce<Record<string, { previous: unknown; next: unknown }>>((acc, field) => {
    if (next[field] !== existing[field]) acc[field] = { previous: existing[field], next: next[field] };
    return acc;
  }, {});

  if (Object.keys(changes).length === 0) return { ok: false, status: 400, error: "No hay cambios para guardar" };

  const financialFieldsChanged = ["start_date", "end_date", "monthly_fee", "billing_day"].some(field => field in changes);
  const receivables = updateContractInDb(existing.id, tenantId, next, financialFieldsChanged);
  recordAuditEvent(req, {
    action: "contract.updated",
    entityType: "contract",
    entityId: contractId,
    metadata: { reason: body.reason, changes, receivables },
  });
  return { ok: true, changes, receivables };
}

export function renderPrintableContractHtml(req: Request, contractId: string, tenantId: number) {
  const contract = getPrintableContractFromDb(contractId, tenantId);
  if (!contract) return null;

  recordAuditEvent(req, {
    action: "contract.printed",
    entityType: "contract",
    entityId: contractId,
    metadata: { client_id: contract.client_id, space_id: contract.space_id },
  });

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Contrato CON-2026-${String(contract.id).padStart(3, "0")}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 40px; line-height: 1.5; }
    header { border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 28px; }
    h1 { font-size: 24px; margin: 0; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    td:first-child { width: 220px; color: #64748b; font-weight: bold; }
    .muted { color: #64748b; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 72px; }
    .signature { border-top: 1px solid #0f172a; text-align: center; padding-top: 10px; font-size: 13px; }
    @media print { body { margin: 24mm; } button { display: none; } }
  </style>
</head>
<body>
  <header>
    <h1>Contrato de Arriendo CON-2026-${String(contract.id).padStart(3, "0")}</h1>
    <p class="muted">Parkia - Documento generado para revision y firma</p>
  </header>

  <h2>Cliente</h2>
  <table>
    <tr><td>Nombre / Razón Social</td><td>${escapeHtml(contract.client_name)}</td></tr>
    <tr><td>RUT</td><td>${escapeHtml(contract.client_rut)}</td></tr>
    <tr><td>Correo</td><td>${escapeHtml(contract.client_email || "No informado")}</td></tr>
    <tr><td>Teléfono</td><td>${escapeHtml(contract.client_phone || "No informado")}</td></tr>
  </table>

  <h2>Arriendo</h2>
  <table>
    <tr><td>Espacio</td><td>${escapeHtml(contract.space_name)} (Estacionamiento)</td></tr>
    <tr><td>Fecha de inicio</td><td>${escapeHtml(contract.start_date)}</td></tr>
    <tr><td>Fecha de término</td><td>${escapeHtml(contract.end_date || "Indefinido")}</td></tr>
    <tr><td>Tarifa mensual</td><td>${escapeHtml(formatCurrency(contract.monthly_fee))}</td></tr>
    <tr><td>Día de cobro</td><td>${escapeHtml(contract.billing_day)}</td></tr>
    <tr><td>Garantía / Depósito</td><td>${escapeHtml(formatCurrency(contract.deposit_amount || 0))}</td></tr>
    <tr><td>Documento de cobro</td><td>${escapeHtml(contract.billing_document_type)}</td></tr>
    <tr><td>Estado</td><td>${escapeHtml(contract.status)}</td></tr>
  </table>

  <h2>Condiciones</h2>
  <p>El cliente declara recibir el espacio individualizado y se obliga al pago mensual indicado, ademas de cumplir las normas operacionales y administrativas establecidas por Parkia.</p>
  <p>${escapeHtml(contract.notes || "Sin notas internas registradas.")}</p>

  <div class="signatures">
    <div class="signature">Arrendador</div>
    <div class="signature">Cliente</div>
  </div>
</body>
</html>`;
}

export function buildContractPdfDownload(req: Request, contractId: string, tenantId: number) {
  const contract = getPrintableContractFromDb(contractId, tenantId);
  if (!contract) return null;

  const pdfBuffer = createContractPdfBuffer(contract);
  recordAuditEvent(req, {
    action: "contract.pdf.downloaded",
    entityType: "contract",
    entityId: contractId,
    metadata: { client_id: contract.client_id, space_id: contract.space_id },
  });

  return {
    fileName: `CON-2026-${String(contract.id).padStart(3, "0")}.pdf`,
    buffer: pdfBuffer,
  };
}

export function generateAndStoreContractPdf(req: Request, contractId: string, tenantId: number) {
  const contract = getPrintableContractFromDb(contractId, tenantId);
  if (!contract) return null;

  const pdfBuffer = createContractPdfBuffer(contract);
  const fileName = `CON-2026-${String(contract.id).padStart(3, "0")}.pdf`;
  const stored = storeDocumentBuffer({
    fileName,
    mimeType: "application/pdf",
    buffer: pdfBuffer,
    folder: "contract-documents",
    tenantId,
  });

  const documentId = insertContractGeneratedDocumentInDb(contract.id, tenantId, stored);
  recordAuditEvent(req, {
    action: "contract.pdf.generated",
    entityType: "contract",
    entityId: contractId,
    metadata: { document_id: documentId, file_name: stored.fileName },
  });

  return documentId;
}

export function createContract(
  req: Request,
  tenantId: number,
  body: {
    client_id?: number;
    space_id?: number;
    start_date?: string;
    end_date?: string | null;
    monthly_fee?: number;
    billing_day?: number;
    deposit_amount?: number;
    billing_document_type?: "boleta" | "factura_exenta" | "factura_afecta";
    notes?: string | null;
  }
) {
  const result = createContractInDb(tenantId, body);
  recordAuditEvent(req, {
    action: "contract.created",
    entityType: "contract",
    entityId: result.id,
    metadata: {
      client_id: body.client_id,
      space_id: body.space_id,
      branch_id: result.branch_id,
      monthly_fee: body.monthly_fee,
      billing_day: body.billing_day,
      deposit_amount: body.deposit_amount,
      billing_document_type: body.billing_document_type,
      receivables: result.receivables,
    },
  });
  recordAuditEvent(req, {
    action: "contract.receivables.generated",
    entityType: "contract",
    entityId: result.id,
    metadata: result.receivables,
  });
  return result;
}
