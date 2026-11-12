import { db } from "../../db";
import { likeValue, type PaginationParams } from "../../pagination";

export interface ClientSummaryRow {
  total_debt: number;
  pending_debt: number;
  overdue_debt: number;
}

export function getClientSummaryFromDb(clientId: string | number, tenantId?: number | null) {
  const tenantFilter = tenantId ? " AND tenant_id = ?" : "";
  const tenantParams = tenantId ? [tenantId] : [];
  const debt = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.status IN ('pending', 'overdue')
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0 END), 0) as total_debt,
      COALESCE(SUM(CASE WHEN p.status = 'pending'
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0 END), 0) as pending_debt,
      COALESCE(SUM(CASE WHEN p.status = 'overdue'
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0 END), 0) as overdue_debt
    FROM payments p
    JOIN contracts c ON c.id = p.contract_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL${tenantFilter}
      GROUP BY payment_id
    ) alloc ON alloc.payment_id = p.id
    WHERE c.client_id = ?
      ${tenantFilter.replace("tenant_id", "c.tenant_id")}
  `).get(...tenantParams, clientId, ...tenantParams) as ClientSummaryRow;

  const activeContracts = db.prepare(`SELECT COUNT(*) as count FROM contracts WHERE client_id = ? AND status = 'active'${tenantFilter}`).get(...[clientId, ...tenantParams]) as { count: number };
  const documents = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('pending', 'rejected') THEN 1 ELSE 0 END) as pending_documents,
      SUM(CASE WHEN status = 'expired' OR (expires_at IS NOT NULL AND date(expires_at) < date('now')) THEN 1 ELSE 0 END) as expired_documents
  FROM documents
    WHERE entity_type = 'client' AND entity_id = ?${tenantFilter}
  `).get(...[clientId, ...tenantParams]) as { pending_documents: number | null; expired_documents: number | null };

  return {
    activeContracts: activeContracts.count,
    totalDebt: Number(debt.total_debt || 0),
    pendingDebt: Number(debt.pending_debt || 0),
    overdueDebt: Number(debt.overdue_debt || 0),
    pendingDocuments: Number(documents.pending_documents || 0),
    expiredDocuments: Number(documents.expired_documents || 0),
  };
}

export function listClientsFromDb(params: {
  tenantId: number;
  includeArchived: boolean;
  requestedStatus: string;
  requestedType: string;
  search: string;
  pagination: PaginationParams;
}) {
  const { tenantId, includeArchived, requestedStatus, requestedType, search, pagination } = params;
  const baseParams: any[] = [tenantId, includeArchived ? 1 : 0];
  let baseWhere = "WHERE c.tenant_id = ? AND (? = 1 OR COALESCE(c.status, 'active') != 'archived')";
  if (requestedType && requestedType !== "all") {
    baseWhere += " AND c.type = ?";
    baseParams.push(requestedType);
  }
  if (search) {
    const like = likeValue(search);
    baseWhere += `
      AND (
        c.name LIKE ? OR c.rut LIKE ? OR COALESCE(c.email, '') LIKE ? OR COALESCE(c.phone, '') LIKE ?
        OR EXISTS (SELECT 1 FROM vehicles v WHERE v.client_id = c.id AND v.tenant_id = c.tenant_id AND COALESCE(v.status, 'active') = 'active' AND v.plate LIKE ?)
      )
    `;
    baseParams.push(like, like, like, like, like);
  }

  let rowWhere = "WHERE 1=1";
  const rowParams: any[] = [];
  if (requestedStatus === "active") {
    rowWhere += " AND active_contract_count > 0";
  } else if (requestedStatus === "inactive") {
    rowWhere += " AND active_contract_count = 0";
  } else if (requestedStatus === "overdue") {
    rowWhere += " AND total_debt > 0";
  } else if (requestedStatus === "archived") {
    rowWhere += " AND COALESCE(status, 'active') = 'archived'";
  }

  const query = `
    WITH client_rows AS (
    SELECT c.*,
    (
      SELECT GROUP_CONCAT(name)
      FROM (
        SELECT DISTINCT s.name
        FROM contracts con
        JOIN spaces s ON con.space_id = s.id
        WHERE con.client_id = c.id AND con.status = 'active' AND con.tenant_id = c.tenant_id
        ORDER BY s.name
      )
    ) as products,
    (SELECT COUNT(*) FROM contracts con WHERE con.client_id = c.id AND con.status = 'active' AND con.tenant_id = c.tenant_id) as active_contract_count,
    (SELECT plate FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active' AND tenant_id = c.tenant_id ORDER BY id LIMIT 1) as plate,
    (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active' AND tenant_id = c.tenant_id ORDER BY id) as plates,
    (SELECT COUNT(*) FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active' AND tenant_id = c.tenant_id) as vehicles_count,
    COALESCE((
      SELECT SUM(CASE WHEN p.status IN ('pending', 'overdue')
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0 END)
      FROM contracts con
      JOIN payments p ON p.contract_id = con.id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) alloc ON alloc.payment_id = p.id
      WHERE con.client_id = c.id AND con.tenant_id = c.tenant_id
    ), 0) as total_debt
    FROM clients c
    ${baseWhere}
    )
  `;
  const total = Number((db.prepare(`${query} SELECT COUNT(*) as count FROM client_rows ${rowWhere}`).get(...baseParams, ...rowParams) as { count: number }).count || 0);
  let listQuery = `${query} SELECT * FROM client_rows ${rowWhere} ORDER BY name ASC`;
  const listParams = [...baseParams, ...rowParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const clients = db.prepare(listQuery).all(...listParams);
  return { clients, total };
}

export function findClientById(id: string | number, tenantId: number) {
  return db.prepare("SELECT * FROM clients WHERE id = ? AND tenant_id = ?").get(id, tenantId) as any;
}

export function findClientByRut(rut: string, tenantId: number) {
  return db.prepare("SELECT id FROM clients WHERE rut = ? AND tenant_id = ?").get(rut, tenantId) as { id: number } | undefined;
}

export function listClientActiveVehicles(clientId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT id, plate, brand, model, color, notes, status, archived_at, archive_reason
    FROM vehicles
    WHERE client_id = ?
      AND tenant_id = ?
      AND COALESCE(status, 'active') = 'active'
    ORDER BY id ASC
  `).all(clientId, tenantId);
}

export function listClientContracts(clientId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT c.*, s.name as space_name, s.type as space_type,
    (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND tenant_id = c.tenant_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates,
    COALESCE((
      SELECT SUM(CASE WHEN p.status IN ('pending', 'overdue')
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0 END)
      FROM payments p
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL AND tenant_id = ?
        GROUP BY payment_id
      ) alloc ON alloc.payment_id = p.id
      WHERE p.contract_id = c.id AND p.tenant_id = c.tenant_id
    ), 0) as pending_amount,
    (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'contract' AND d.entity_id = c.id AND d.tenant_id = c.tenant_id) as documents_count
    FROM contracts c
    JOIN spaces s ON c.space_id = s.id
    WHERE c.client_id = ? AND c.tenant_id = ?
    ORDER BY
      CASE c.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,
      c.start_date DESC
  `).all(tenantId, clientId, tenantId);
}

export function listClientPayments(clientId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT p.*,
      c.id as contract_id_display,
      s.name as space_name,
      COALESCE(alloc.allocated_amount, 0) as allocated_amount,
      CASE WHEN p.status IN ('pending', 'overdue')
        THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
        ELSE 0
      END as remaining_amount
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id
    JOIN spaces s ON s.id = c.space_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) alloc ON alloc.payment_id = p.id
    WHERE c.client_id = ? AND p.tenant_id = ? AND c.tenant_id = ?
    ORDER BY date(p.due_date) DESC, p.id DESC
  `).all(tenantId, clientId, tenantId, tenantId);
}

export function listClientAccessLogs(clientId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT a.*, s.name as space_name 
    FROM access_logs a 
    JOIN spaces s ON a.space_id = s.id 
    WHERE a.client_id = ? AND a.tenant_id = ?
    ORDER BY timestamp DESC LIMIT 20
  `).all(clientId, tenantId);
}

export function listClientDocuments(clientId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT id, entity_type, entity_id, label, document_type, status, expires_at, notes,
           file_name, mime_type, size_bytes, created_at
    FROM documents
    WHERE entity_type = 'client' AND entity_id = ? AND tenant_id = ?
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'rejected' THEN 1
        WHEN 'expired' THEN 2
        ELSE 3
      END,
      expires_at IS NULL,
      expires_at ASC,
      created_at DESC
  `).all(clientId, tenantId);
}

export function insertClientWithOptionalVehicle(
  tenantId: number,
  input: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    rut?: string;
    type?: string;
    plate?: string | null;
    address?: string | null;
    commune?: string | null;
    city?: string | null;
    business_activity?: string | null;
    legal_representative_name?: string | null;
    legal_representative_rut?: string | null;
    billing_contact_name?: string | null;
    billing_contact_email?: string | null;
    billing_contact_phone?: string | null;
    notes?: string | null;
  },
  normalizedPlate: string | null
) {
  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO clients (
        name, email, phone, rut, type, address, commune, city, business_activity,
        legal_representative_name, legal_representative_rut,
        billing_contact_name, billing_contact_email, billing_contact_phone, notes, tenant_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      input.email ?? null,
      input.phone ?? null,
      input.rut,
      input.type ?? "natural",
      input.address ?? null,
      input.commune ?? null,
      input.city ?? null,
      input.business_activity ?? null,
      input.legal_representative_name ?? null,
      input.legal_representative_rut ?? null,
      input.billing_contact_name ?? null,
      input.billing_contact_email ?? null,
      input.billing_contact_phone ?? null,
      input.notes ?? null,
      tenantId
    );
    const clientId = result.lastInsertRowid;

    if (normalizedPlate && normalizedPlate.trim() !== "") {
      db.prepare("INSERT INTO vehicles (client_id, plate, tenant_id) VALUES (?, ?, ?)").run(clientId, normalizedPlate, tenantId);
    }

    return clientId;
  });
  return transaction();
}

export function updateClientFields(id: string | number, tenantId: number, fields: string[], values: any[]) {
  const sets = fields.map(field => `${field} = ?`).join(", ");
  db.prepare(`UPDATE clients SET ${sets} WHERE id = ? AND tenant_id = ?`).run(...values, id, tenantId);
}

export function countClientActiveOrSuspendedContracts(clientId: string | number, tenantId: number) {
  const row = db.prepare("SELECT COUNT(*) as count FROM contracts WHERE client_id = ? AND status IN ('active', 'suspended') AND tenant_id = ?").get(clientId, tenantId) as { count: number };
  return row.count;
}

export function updateClientStatus(clientId: string | number, tenantId: number, status: string) {
  db.prepare("UPDATE clients SET status = ? WHERE id = ? AND tenant_id = ?").run(status, clientId, tenantId);
}

export function findVehicleByPlate(plate: string, tenantId: number) {
  return db.prepare("SELECT id, client_id, status FROM vehicles WHERE plate = ? AND tenant_id = ?").get(plate, tenantId) as { id: number; client_id: number; status: string | null } | undefined;
}

export function findVehicleByIdAndClient(vehicleId: string | number, clientId: string | number, tenantId: number) {
  return db.prepare("SELECT id, plate, client_id, status FROM vehicles WHERE id = ? AND client_id = ? AND tenant_id = ?").get(vehicleId, clientId, tenantId) as { id: number; plate: string; client_id: number; status: string | null } | undefined;
}

export function reactivateVehicle(
  vehicleId: number,
  clientId: string | number,
  tenantId: number,
  input: { brand?: string | null; model?: string | null; color?: string | null; notes?: string | null }
) {
  db.prepare(`
    UPDATE vehicles
    SET client_id = ?,
        brand = ?,
        model = ?,
        color = ?,
        notes = ?,
        status = 'active',
        archived_at = NULL,
        archive_reason = NULL
    WHERE id = ? AND tenant_id = ?
  `).run(clientId, input.brand ?? null, input.model ?? null, input.color ?? null, input.notes ?? null, vehicleId, tenantId);
}

export function insertVehicle(
  clientId: string | number,
  plate: string,
  tenantId: number,
  input: { brand?: string | null; model?: string | null; color?: string | null; notes?: string | null }
) {
  const result = db.prepare(`
    INSERT INTO vehicles (client_id, plate, brand, model, color, notes, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(clientId, plate, input.brand ?? null, input.model ?? null, input.color ?? null, input.notes ?? null, tenantId);
  return result.lastInsertRowid;
}

export function archiveVehicleById(vehicleId: number, tenantId: number, reason: string) {
  db.prepare(`
    UPDATE vehicles
    SET status = 'archived',
        archived_at = datetime('now'),
        archive_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).run(reason, vehicleId, tenantId);
}

export function bulkInsertImportedClients(
  tenantId: number,
  clientsToInsert: {
    name: string;
    email: string | null;
    phone: string | null;
    rut: string;
    type: "natural" | "company";
    plate: string | null;
    address: string | null;
    commune: string | null;
    city: string | null;
    business_activity: string | null;
    legal_representative_name: string | null;
    legal_representative_rut: string | null;
    billing_contact_name: string | null;
    billing_contact_email: string | null;
    billing_contact_phone: string | null;
    notes: string | null;
  }[]
) {
  const transaction = db.transaction(() => {
    for (const client of clientsToInsert) {
      const result = db.prepare(`
        INSERT INTO clients (
          name, email, phone, rut, type, address, commune, city, business_activity,
          legal_representative_name, legal_representative_rut,
          billing_contact_name, billing_contact_email, billing_contact_phone, notes, tenant_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        client.name,
        client.email,
        client.phone,
        client.rut,
        client.type,
        client.address,
        client.commune,
        client.city,
        client.business_activity,
        client.legal_representative_name,
        client.legal_representative_rut,
        client.billing_contact_name,
        client.billing_contact_email,
        client.billing_contact_phone,
        client.notes,
        tenantId
      );
      if (client.plate) {
        db.prepare("INSERT INTO vehicles (client_id, plate, tenant_id) VALUES (?, ?, ?)").run(result.lastInsertRowid, client.plate, tenantId);
      }
    }
  });
  transaction();
}

