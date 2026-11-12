import { db } from "../../db";

export async function insertSpaceHistoryRow(params: {
  spaceId: string | number;
  staffId: number | null;
  previousStatus: string | null;
  status: string;
  reason: string | null;
  source: string;
  tenantId: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO space_status_history (space_id, staff_id, previous_status, status, reason, source, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.spaceId,
    params.staffId,
    params.previousStatus,
    params.status,
    params.reason,
    params.source,
    params.tenantId,
  );
}

export async function queryAvailableSpaces(tenantId: number, branchId?: number): Promise<Record<string, any>[]> {
  const params: Array<string | number> = [tenantId];
  let where = "WHERE s.status = 'available' AND s.type = 'parking' AND s.tenant_id = ?";
  if (branchId) {
    where += " AND s.branch_id = ?";
    params.push(branchId);
  }

  return await db.prepare(`
    SELECT s.*, b.name as branch_name, b.code as branch_code
    FROM spaces s
    LEFT JOIN branches b ON b.id = s.branch_id
    ${where}
    ORDER BY b.name ASC, s.name ASC
  `).all(...params) as Record<string, any>[];
}

export async function queryAllSpacesWithOccupancy(tenantId: number, branchId?: number): Promise<Record<string, any>[]> {
  const params: Array<string | number> = [tenantId];
  let where = "WHERE s.type = 'parking' AND s.tenant_id = ?";
  if (branchId) {
    where += " AND s.branch_id = ?";
    params.push(branchId);
  }

  return await db.prepare(`
    SELECT s.*, 
    b.name as branch_name, b.code as branch_code,
    cl.id as client_id, cl.name as client_name, cl.rut as client_rut, cl.financial_status,
    (SELECT access_type FROM access_logs WHERE space_id = s.id AND tenant_id = s.tenant_id ORDER BY timestamp DESC LIMIT 1) as last_access_type,
    (SELECT timestamp FROM access_logs WHERE space_id = s.id AND tenant_id = s.tenant_id ORDER BY timestamp DESC LIMIT 1) as last_access_time,
    (SELECT plate FROM access_logs WHERE space_id = s.id AND tenant_id = s.tenant_id ORDER BY timestamp DESC LIMIT 1) as last_access_plate
    FROM spaces s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contracts c ON s.id = c.space_id AND c.status = 'active'
    LEFT JOIN clients cl ON c.client_id = cl.id
    ${where}
    ORDER BY b.name ASC, s.name ASC
  `).all(...params) as Record<string, any>[];
}

export async function findSpaceDetailById(spaceId: string | number, tenantId: number): Promise<Record<string, any> | undefined> {
  return await db.prepare(`
    SELECT s.*,
           b.name as branch_name,
           b.code as branch_code,
           cl.id as client_id,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.financial_status
    FROM spaces s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN contracts c ON s.id = c.space_id AND c.status = 'active'
    LEFT JOIN clients cl ON c.client_id = cl.id
    WHERE s.id = ?
      AND s.type = 'parking'
      AND s.tenant_id = ?
  `).get(spaceId, tenantId) as Record<string, any> | undefined;
}

export async function querySpaceAccessLogs(spaceId: string | number, tenantId: number): Promise<Record<string, any>[]> {
  return await db.prepare(`
    SELECT a.*, c.name as client_name, COALESCE(v.name, 'Visita Temporal') as visitor_name
    FROM access_logs a
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN visitor_passes v ON v.id = a.visitor_id
    WHERE a.space_id = ?
      AND a.tenant_id = ?
    ORDER BY a.timestamp DESC
    LIMIT 30
  `).all(spaceId, tenantId) as Record<string, any>[];
}

export async function querySpaceStatusHistory(spaceId: string | number, tenantId: number): Promise<Record<string, any>[]> {
  return await db.prepare(`
    SELECT h.*, s.name as staff_name, s.email as staff_email
    FROM space_status_history h
    LEFT JOIN staff s ON s.id = h.staff_id
    WHERE h.space_id = ?
      AND h.tenant_id = ?
    ORDER BY h.created_at DESC, h.id DESC
    LIMIT 30
  `).all(spaceId, tenantId) as Record<string, any>[];
}

export async function insertSpaceRow(params: {
  name: string;
  type: "parking";
  status: "available" | "occupied" | "maintenance";
  price: number;
  location: string | null;
  level: string | null;
  width_m: number | null;
  length_m: number | null;
  height_m: number | null;
  features: string | null;
  notes: string | null;
  branchId: number;
  tenantId: number;
}): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO spaces (name, type, status, price, location, level, width_m, length_m, height_m, features, notes, branch_id, tenant_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    params.name,
    params.type,
    params.status,
    params.price,
    params.location,
    params.level,
    params.width_m,
    params.length_m,
    params.height_m,
    params.features,
    params.notes,
    params.branchId,
    params.tenantId,
  );
  return Number(result.lastInsertRowid);
}

export async function findParkingSpaceById(spaceId: string | number, tenantId: number): Promise<Record<string, any> | undefined> {
  return await db
    .prepare("SELECT * FROM spaces WHERE id = ? AND type = 'parking' AND tenant_id = ?")
    .get(spaceId, tenantId) as Record<string, any> | undefined;
}

export async function updateSpaceFieldsById(
  spaceId: string | number,
  tenantId: number,
  fields: string[],
  values: unknown[],
): Promise<void> {
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  await db.prepare(`UPDATE spaces SET ${sets}, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`).run(
    ...values,
    spaceId,
    tenantId,
  );
}

export async function updateSpaceStatusRow(params: {
  spaceId: string | number;
  tenantId: number;
  status: "available" | "occupied" | "maintenance";
  notes: string | null;
}): Promise<number> {
  const result = await db
    .prepare(
      "UPDATE spaces SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ? AND type = 'parking' AND tenant_id = ?",
    )
    .run(params.status, params.notes, params.spaceId, params.tenantId);
  return result.changes;
}

export async function executeForceReleaseTransaction(params: {
  spaceId: string | number;
  tenantId: number;
  reason: string;
  staffId: number | null;
  staffName: string | null;
}): Promise<void> {
  const tx = db.transaction(async () => {
    const current = await db
      .prepare("SELECT status, branch_id FROM spaces WHERE id = ? AND type = 'parking' AND tenant_id = ?")
      .get(params.spaceId, params.tenantId) as { status: string; branch_id: number | null } | undefined;
    if (!current) throw new Error("Espacio no encontrado");

    const spaceUpdate = await db
      .prepare(
        "UPDATE spaces SET status = 'available', updated_at = datetime('now') WHERE id = ? AND type = 'parking' AND tenant_id = ?",
      )
      .run(params.spaceId, params.tenantId);
    if (spaceUpdate.changes === 0) throw new Error("Espacio no encontrado");

    await insertSpaceHistoryRow({
      spaceId: params.spaceId,
      staffId: params.staffId,
      previousStatus: current.status,
      status: "available",
      reason: params.reason,
      source: "force_release",
      tenantId: params.tenantId,
    });

    const lastEntry = await db
      .prepare("SELECT * FROM access_logs WHERE space_id = ? AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1")
      .get(params.spaceId, params.tenantId) as Record<string, any> | undefined;

    if (lastEntry && lastEntry.access_type === "entry") {
      const releaseLog = await db.prepare(`
        INSERT INTO access_logs (client_id, visitor_id, space_id, branch_id, access_type, status, method, reason, plate, tenant_id) 
        VALUES (?, ?, ?, ?, 'exit', 'authorized', 'manual', 'Liberacion manual forzada', ?, ?)
      `).run(
        lastEntry.client_id || null,
        lastEntry.visitor_id || null,
        params.spaceId,
        current.branch_id || null,
        lastEntry.plate || "FORZADA",
        params.tenantId,
      );
      await db.prepare("UPDATE access_logs SET reason = ?, authorized_by = ? WHERE id = ?").run(
        params.reason,
        params.staffName,
        releaseLog.lastInsertRowid,
      );

      if (lastEntry.visitor_id) {
        await db.prepare(
          "UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ? AND tenant_id = ?",
        ).run(lastEntry.visitor_id, params.tenantId);
      }
    }
  });
  await tx();
}

export async function findActiveContractForSpace(
  spaceId: string | number,
  tenantId: number,
): Promise<{ client_id: number } | undefined> {
  return await db
    .prepare("SELECT client_id FROM contracts WHERE space_id = ? AND status = 'active' AND tenant_id = ?")
    .get(spaceId, tenantId) as { client_id: number } | undefined;
}

export async function insertManualSpaceEntryAccessLog(params: {
  clientId: number;
  spaceId: string | number;
  branchId: number | null;
  tenantId: number;
}): Promise<void> {
  await db.prepare(`
    INSERT INTO access_logs (client_id, space_id, branch_id, access_type, status, method, tenant_id)
    VALUES (?, ?, ?, 'entry', 'authorized', 'manual', ?)
  `).run(params.clientId, params.spaceId, params.branchId, params.tenantId);
}

