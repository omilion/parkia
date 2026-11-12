import { cancelContractReceivablesAfter, generateContractReceivables, reconcileContractFutureReceivables } from "../../billing";
import { db } from "../../db";
import { likeValue, type PaginationParams } from "../../pagination";

export async function getPrintableContractFromDb(contractId: string | number, tenantId: number) {
  return await db.prepare(`
    SELECT c.*,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.email as client_email,
           cl.phone as client_phone,
           s.name as space_name,
           s.type as space_type
    FROM contracts c
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
    JOIN spaces s ON c.space_id = s.id AND s.tenant_id = c.tenant_id
    WHERE c.id = ?
      AND c.tenant_id = ?
      AND s.type = 'parking'
  `).get(contractId, tenantId) as any;
}

export async function findContractBasic(contractId: string | number, tenantId: number) {
  return await db.prepare("SELECT id, space_id, status, end_date FROM contracts WHERE id = ? AND tenant_id = ?").get(contractId, tenantId) as { id: number; space_id: number; status: string; end_date: string | null } | undefined;
}

export async function findContractEditable(contractId: string | number, tenantId: number) {
  return await db.prepare(`
    SELECT id, client_id, space_id, start_date, end_date, monthly_fee, billing_day,
           deposit_amount, billing_document_type, notes, status
    FROM contracts
    WHERE id = ? AND tenant_id = ?
  `).get(contractId, tenantId) as any | undefined;
}

export async function renewContractInDb(contractId: number, tenantId: number, newEndDate: string) {
  const transaction = db.transaction(async () => {
    await db.prepare("UPDATE contracts SET end_date = ? WHERE id = ? AND tenant_id = ?").run(newEndDate, contractId, tenantId);
    return await reconcileContractFutureReceivables(contractId);
  });
  return await transaction();
}

export async function updateContractStatusInDb(contractId: string | number, tenantId: number, status: string) {
  await db.prepare("UPDATE contracts SET status = ? WHERE id = ? AND tenant_id = ?").run(status, contractId, tenantId);
}

export async function terminateContractInDb(contractId: number, spaceId: number, tenantId: number, effectiveDate: string) {
  const transaction = db.transaction(async () => {
    await db.prepare("UPDATE contracts SET status = 'terminated', end_date = ? WHERE id = ? AND tenant_id = ?").run(effectiveDate, contractId, tenantId);
    await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND tenant_id = ?").run(spaceId, tenantId);
    return await cancelContractReceivablesAfter(contractId, effectiveDate);
  });
  return await transaction();
}

export async function listContractsFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status: string;
  expiring: boolean;
  search: string;
  pagination: PaginationParams;
}) {
  const { tenantId, branchId, status, expiring, search, pagination } = params;
  const sqlParams: any[] = [tenantId];
  let where = "WHERE c.tenant_id = ? AND s.type = 'parking'";
  if (branchId) {
    where += " AND c.branch_id = ?";
    sqlParams.push(branchId);
  }
  if (status && status !== "all") {
    where += " AND c.status = ?";
    sqlParams.push(status);
  }
  if (expiring) {
    where += " AND c.status = 'active' AND c.end_date IS NOT NULL AND date(c.end_date) BETWEEN date('now') AND date('now', '+30 days')";
  }
  if (search) {
    const like = likeValue(search);
    where += `
      AND (
        cl.name LIKE ? OR cl.rut LIKE ? OR s.name LIKE ? OR CAST(c.id AS TEXT) LIKE ?
        OR EXISTS (SELECT 1 FROM vehicles v WHERE v.client_id = c.client_id AND v.tenant_id = c.tenant_id AND COALESCE(v.status, 'active') = 'active' AND v.plate LIKE ?)
      )
    `;
    sqlParams.push(like, like, like, like, like);
  }

  const fromSql = `
    FROM contracts c
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
    JOIN spaces s ON c.space_id = s.id AND s.tenant_id = c.tenant_id
    LEFT JOIN branches b ON b.id = c.branch_id AND b.tenant_id = c.tenant_id
    ${where}
  `;
  const total = Number((await db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...sqlParams) as { count: number }).count || 0);
  let listQuery = `
    SELECT c.*, cl.name as client_name, s.name as space_name, b.name as branch_name, b.code as branch_code,
    (SELECT plate FROM vehicles WHERE client_id = c.client_id AND tenant_id = c.tenant_id AND COALESCE(status, 'active') = 'active' ORDER BY id LIMIT 1) as plate,
    (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND tenant_id = c.tenant_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates
    ${fromSql}
    ORDER BY c.start_date DESC
  `;
  const listParams = [...sqlParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const contracts = await db.prepare(listQuery).all(...listParams);
  return { contracts, total };
}

export async function getContractDetailFromDb(contractId: string | number, tenantId: number) {
  const contract = await db.prepare(`
    SELECT c.*,
      cl.name as client_name,
      cl.rut as client_rut,
      cl.email as client_email,
      cl.phone as client_phone,
      cl.type as client_type,
      cl.address as client_address,
      cl.business_activity as client_business_activity,
      cl.billing_contact_name,
      cl.billing_contact_email,
      cl.billing_contact_phone,
      s.name as space_name,
      s.type as space_type,
      s.price as space_price,
      b.name as branch_name,
      b.code as branch_code,
      (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND tenant_id = c.tenant_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates
    FROM contracts c
    JOIN clients cl ON c.client_id = cl.id AND cl.tenant_id = c.tenant_id
    JOIN spaces s ON c.space_id = s.id AND s.tenant_id = c.tenant_id
    LEFT JOIN branches b ON b.id = c.branch_id AND b.tenant_id = c.tenant_id
    WHERE c.id = ?
      AND c.tenant_id = ?
      AND s.type = 'parking'
  `).get(contractId, tenantId);
  if (!contract) return null;

  const payments = await db.prepare(`
    SELECT p.*,
      COALESCE(alloc.allocated_amount, 0) as allocated_amount,
      CASE WHEN p.status IN ('pending', 'overdue')
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0
      END as remaining_amount
    FROM payments p
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) alloc ON alloc.payment_id = p.id
    WHERE p.contract_id = ?
      AND p.tenant_id = ?
    ORDER BY date(p.due_date) DESC, p.id DESC
  `).all(tenantId, contractId, tenantId);

  const documents = await db.prepare(`
    SELECT id, entity_type, entity_id, label, document_type, status, expires_at, notes,
           file_name, mime_type, size_bytes, created_at
    FROM documents
    WHERE entity_type = 'contract' AND entity_id = ? AND tenant_id = ?
    ORDER BY created_at DESC
  `).all(contractId, tenantId);

  const audit = await db.prepare(`
    SELECT a.*, s.name as staff_name, s.email as staff_email
    FROM audit_events a
    LEFT JOIN staff s ON s.id = a.staff_id
    WHERE a.entity_type = 'contract' AND a.entity_id = ? AND a.tenant_id = ?
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 20
  `).all(contractId, tenantId);

  return { contract, payments, documents, audit };
}

export async function updateContractInDb(
  contractId: number,
  tenantId: number,
  next: {
    start_date: string;
    end_date: string | null;
    monthly_fee: number;
    billing_day: number;
    deposit_amount: number;
    billing_document_type: string;
    notes: string | null;
  },
  financialFieldsChanged: boolean
) {
  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE contracts
      SET start_date = ?,
          end_date = ?,
          monthly_fee = ?,
          billing_day = ?,
          deposit_amount = ?,
          billing_document_type = ?,
          notes = ?
      WHERE id = ?
        AND tenant_id = ?
    `).run(
      next.start_date,
      next.end_date,
      next.monthly_fee,
      next.billing_day,
      next.deposit_amount,
      next.billing_document_type,
      next.notes,
      contractId,
      tenantId
    );

    return financialFieldsChanged ? await reconcileContractFutureReceivables(contractId) : null;
  });

  return await transaction();
}

export async function insertContractGeneratedDocumentInDb(
  contractId: number,
  tenantId: number,
  stored: { filePath: string; fileName: string; mimeType: string; sizeBytes: number }
) {
  const result = await db.prepare(`
    INSERT INTO documents (
      entity_type, entity_id, label, document_type, status, notes,
      file_path, file_name, mime_type, size_bytes, tenant_id
    )
    VALUES ('contract', ?, ?, 'contract', 'received', ?, ?, ?, ?, ?, ?)
  `).run(
    contractId,
    `Contrato generado ${String(contractId).padStart(3, "0")}`,
    "PDF generado automáticamente desde el sistema",
    stored.filePath,
    stored.fileName,
    stored.mimeType,
    stored.sizeBytes,
    tenantId
  );
  return result.lastInsertRowid;
}

export async function createContractInDb(
  tenantId: number,
  input: {
    client_id?: number;
    space_id?: number;
    start_date?: string;
    end_date?: string | null;
    monthly_fee?: number;
    billing_day?: number;
    deposit_amount?: number;
    billing_document_type?: string;
    notes?: string | null;
  }
) {
  const transaction = db.transaction(async () => {
    const client = await db.prepare("SELECT id, status FROM clients WHERE id = ? AND tenant_id = ?").get(input.client_id, tenantId) as { id: number; status: string | null } | undefined;
    if (!client) throw new Error("Cliente no encontrado");
    if (client.status === "archived") throw new Error("No se puede crear un contrato para un cliente archivado");

    const space = await db.prepare("SELECT id, status, branch_id, type FROM spaces WHERE id = ? AND tenant_id = ?").get(input.space_id, tenantId) as { id: number; status: string; branch_id: number | null; type: string } | undefined;
    if (!space) throw new Error("Espacio no encontrado");
    if (space.type !== "parking") throw new Error("Solo se pueden contratar estacionamientos");
    if (space.status !== "available") throw new Error("El espacio no está disponible");

    const activeContract = await db.prepare("SELECT id FROM contracts WHERE space_id = ? AND status = 'active' AND tenant_id = ?").get(input.space_id, tenantId);
    if (activeContract) throw new Error("El espacio ya tiene un contrato activo");

    const result = await db.prepare(`
      INSERT INTO contracts (
        client_id,
        space_id,
        start_date,
        end_date,
        monthly_fee,
        billing_day,
        deposit_amount,
        billing_document_type,
        notes,
        branch_id,
        tenant_id
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.client_id,
      input.space_id,
      input.start_date,
      input.end_date ?? null,
      input.monthly_fee,
      input.billing_day ?? 5,
      input.deposit_amount ?? 0,
      input.billing_document_type ?? "boleta",
      input.notes ?? null,
      space.branch_id || null,
      tenantId
    );

    await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ? AND tenant_id = ?").run(input.space_id, tenantId);

    const contractId = Number(result.lastInsertRowid);
    const receivables = await generateContractReceivables(contractId);

    return { id: contractId, branch_id: space.branch_id || null, receivables };
  });

  return await transaction();
}

