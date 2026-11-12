import type { Request } from "express";
import { recordAuditEvent } from "../../../audit";
import { getBranchOrDefault } from "../../../branches";
import type { PaginationParams } from "../../../pagination";
import { normalizeRut } from "../shared";
import {
  allocateBankMovementInDb,
  autoReconcilePendingBankMovementsInDb,
  findBankMovementWithRemainingInDb,
  importBankMovementsIntoDb,
  listBankMovementsFromDb,
  listCandidatePaymentsForBankMovementFromDb,
  markBankMovementPartialInDb,
  reconcileBankMovementInDb,
  updateBankMovementInDb,
} from "./repo";

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === ";") && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseBankDate(value: string) {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function parseBankAmount(value: string) {
  const text = value.replace(/[$\s]/g, "");
  if (!text) return null;

  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(text)
      ? text.replace(/\./g, "")
      : text.replace(/,/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function parseBankMovementsCsv(dataBase64: string) {
  const csv = Buffer.from(dataBase64, "base64").toString("utf8").replace(/^\uFEFF/, "");
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("El archivo no tiene movimientos para importar");

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const findIndex = (names: string[]) => headers.findIndex(header => names.includes(header));
  const dateIndex = findIndex(["date", "fecha", "fechamovimiento"]);
  const descriptionIndex = findIndex(["description", "descripcion", "glosa", "detalle", "movimiento"]);
  const rutIndex = findIndex(["rut", "run", "rutcliente", "rutpagador"]);
  const amountIndex = findIndex(["amount", "monto", "abono", "deposito", "cargoabono"]);

  if ([dateIndex, descriptionIndex, rutIndex, amountIndex].some(index => index < 0)) {
    throw new Error("El CSV debe incluir columnas fecha, descripción, rut y monto");
  }

  const rows: { date: string; description: string; rut: string; amount: number }[] = [];
  const skippedRows: { row: number; reason: string }[] = [];

  lines.slice(1).forEach((line, index) => {
    const rowNumber = index + 2;
    const cells = parseCsvLine(line);
    const date = parseBankDate(cells[dateIndex] || "");
    const description = (cells[descriptionIndex] || "").trim();
    const rut = (cells[rutIndex] || "").trim();
    const amount = parseBankAmount(cells[amountIndex] || "");

    if (!date) {
      skippedRows.push({ row: rowNumber, reason: "Fecha inválida" });
    } else if (!description) {
      skippedRows.push({ row: rowNumber, reason: "Descripción vacía" });
    } else if (!rut) {
      skippedRows.push({ row: rowNumber, reason: "RUT vacío" });
    } else if (!amount) {
      skippedRows.push({ row: rowNumber, reason: "Monto inválido" });
    } else {
      rows.push({ date, description, rut, amount });
    }
  });

  return { rows, skippedRows };
}

function scoreMovementSuggestion(movement: any, payment: any) {
  let score = 0;
  const reasons: string[] = [];
  const movementAmount = Number(movement.remaining_amount ?? movement.amount ?? 0);
  const paymentAmount = Number(payment.remaining_amount ?? payment.amount ?? 0);
  const amountDiff = Math.abs(movementAmount - paymentAmount);

  if (amountDiff === 0) {
    score += 60;
    reasons.push("Monto exacto");
  } else if (amountDiff <= Math.max(1000, movementAmount * 0.05)) {
    score += 20;
    reasons.push("Monto cercano");
  }

  if (normalizeRut(movement.rut) && normalizeRut(movement.rut) === normalizeRut(payment.client_rut)) {
    score += 40;
    reasons.push("RUT coincidente");
  }

  const clientTokens = String(payment.client_name || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token: string) => token.length >= 4);
  const description = String(movement.description || "").toLowerCase();
  if (clientTokens.some((token: string) => description.includes(token))) {
    score += 10;
    reasons.push("Nombre aparece en glosa");
  }

  return { score: Math.min(score, 100), reasons };
}

export async function listBankMovements(params: {
  tenantId: number;
  rawBranchId: number | null;
  status: string;
  month: string;
  search: string;
  pagination: PaginationParams;
}) {
  const branchId = params.rawBranchId ? await getBranchOrDefault(params.rawBranchId, params.tenantId) : null;
  return await listBankMovementsFromDb({
    ...params,
    branchId,
  });
}

export async function getBankMovementSuggestions(movementId: string, tenantId: number) {
  const movement = await findBankMovementWithRemainingInDb(movementId, tenantId);
  if (!movement) return null;

  const payments = await listCandidatePaymentsForBankMovementFromDb(tenantId, movement.branch_id || null);
  const suggestions = payments
    .map(payment => {
      const scored = scoreMovementSuggestion(movement, payment);
      return {
        payment_id: payment.id,
        payment,
        score: scored.score,
        reasons: scored.reasons,
      };
    })
    .filter(suggestion => suggestion.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.payment.due_date > b.payment.due_date) - Number(a.payment.due_date < b.payment.due_date))
    .slice(0, 8);

  return { movement_id: movement.id, suggestions };
}

export async function importBankMovements(
  req: Request,
  tenantId: number,
  body: { fileName?: string; dataBase64?: string; branch_id?: number | null }
) {
  const branchId = body.branch_id ? await getBranchOrDefault(body.branch_id, tenantId) : null;
  const parsed = parseBankMovementsCsv(body.dataBase64 || "");
  const { imported, duplicated } = await importBankMovementsIntoDb(tenantId, branchId, parsed.rows);

  await recordAuditEvent(req, {
    action: "bank_movements.imported",
    entityType: "bank_movement",
    entityId: body.fileName,
    metadata: {
      file_name: body.fileName,
      branch_id: branchId,
      imported,
      duplicated,
      skipped: parsed.skippedRows.length,
    },
  });

  return {
    success: true,
    imported,
    duplicated,
    skipped: parsed.skippedRows.length,
    skippedRows: parsed.skippedRows,
  };
}

export async function updateBankMovement(
  req: Request,
  movementId: string,
  tenantId: number,
  body: {
    date?: string;
    description?: string | null;
    rut?: string | null;
    amount?: number;
    notes?: string | null;
  }
) {
  const result = await updateBankMovementInDb(movementId, tenantId, body);
  await recordAuditEvent(req, {
    action: "bank_movement.updated",
    entityType: "bank_movement",
    entityId: movementId,
    metadata: result,
  });
}

export async function markBankMovementPartial(req: Request, movementId: string, tenantId: number, note: string) {
  const previous = await markBankMovementPartialInDb(movementId, tenantId, note);
  await recordAuditEvent(req, {
    action: "bank_movement.marked_partial",
    entityType: "bank_movement",
    entityId: movementId,
    metadata: {
      previous_status: previous.status,
      note,
    },
  });
}

export async function allocateBankMovement(
  req: Request,
  movementId: string,
  tenantId: number,
  body: { payment_id?: number; amount?: number; note?: string }
) {
  const result = await allocateBankMovementInDb(movementId, tenantId, body);
  await recordAuditEvent(req, {
    action: "bank_movement.allocated",
    entityType: "bank_movement",
    entityId: movementId,
    metadata: result,
  });
  return result;
}

export async function reconcileBankMovement(
  req: Request,
  movementId: string,
  tenantId: number,
  body: { payment_id?: number; note?: string }
) {
  const result = await reconcileBankMovementInDb(movementId, tenantId, body);
  await recordAuditEvent(req, {
    action: "bank_movement.reconciled",
    entityType: "bank_movement",
    entityId: movementId,
    metadata: {
      payment_id: result.paymentId,
      folio: result.folio,
      amount: result.amount,
      client_id: result.clientId,
      contract_id: result.contractId,
      note: body.note,
      reference: result.reference,
      allocated_amount: result.allocatedAmount,
    },
  });
  return result;
}

export async function syncImportedBankMovements(req: Request, tenantId: number) {
  const result = await autoReconcilePendingBankMovementsInDb(tenantId);
  await recordAuditEvent(req, {
    action: "bank_movements.imported_auto_reconciled",
    entityType: "bank_movement",
    entityId: null,
    metadata: {
      mode: "imported_movements_only",
      provider_connected: false,
      total: result.total,
      reconciled: result.autoConciliated,
      unmatched: result.unmatched.length,
    },
  });
  return {
    success: true,
    mode: "imported_movements_only",
    provider_connected: false,
    message: "Conciliacion automatica ejecutada sobre movimientos importados; no se contacto un banco externo.",
    count: result.autoConciliated,
    unmatched: result.unmatched.length,
    total: result.total,
  };
}

