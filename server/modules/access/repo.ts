import { db } from "../../db";

export async function findSpaceBranchId(spaceId?: number | string | null, tenantId?: number | null): Promise<number | null> {
  if (!spaceId) return null;
  const space = tenantId
    ? (await db.prepare("SELECT branch_id FROM spaces WHERE id = ? AND tenant_id = ?").get(spaceId, tenantId) as
        | { branch_id: number | null }
        | undefined)
    : (await db.prepare("SELECT branch_id FROM spaces WHERE id = ?").get(spaceId) as { branch_id: number | null } | undefined);
  return space?.branch_id ? Number(space.branch_id) : null;
}

export async function clientExistsInTenant(clientId: number, tenantId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM clients WHERE id = ? AND tenant_id = ?").get(clientId, tenantId));
}

export async function spaceExistsInTenant(spaceId: number, tenantId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM spaces WHERE id = ? AND tenant_id = ?").get(spaceId, tenantId));
}

export async function insertAccessLogRow(params: {
  clientId: number | null;
  visitorId: number | null;
  spaceId: number | null;
  branchId: number;
  accessType: "entry" | "exit";
  status: "authorized" | "denied";
  method: string;
  reason: string | null;
  authorizedBy: string | null;
  plate?: string | null;
  tenantId: number;
}): Promise<number> {
  const result = await db.prepare(`
    INSERT INTO access_logs (client_id, visitor_id, space_id, branch_id, access_type, status, method, reason, authorized_by, plate, tenant_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.clientId,
    params.visitorId,
    params.spaceId,
    params.branchId,
    params.accessType,
    params.status,
    params.method,
    params.reason,
    params.authorizedBy,
    params.plate ?? null,
    params.tenantId,
  );
  return Number(result.lastInsertRowid);
}

export async function findActiveClientVehicleByNormalizedPlate(normalizedPlate: string, tenantId: number) {
  return await db.prepare(`
    SELECT v.*, c.name as client_name 
    FROM vehicles v 
    JOIN clients c ON v.client_id = c.id 
    WHERE REPLACE(plate, '-', '') = ?
      AND v.tenant_id = ?
      AND c.tenant_id = v.tenant_id
      AND COALESCE(v.status, 'active') = 'active'
  `).get(normalizedPlate, tenantId) as Record<string, any> | undefined;
}

export async function findLastAccessLogForPlate(normalizedPlate: string, tenantId: number) {
  return await db.prepare(`
    SELECT access_type, space_id, visitor_id, branch_id FROM access_logs 
    WHERE REPLACE(plate, '-', '') = ? 
      AND tenant_id = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(normalizedPlate, tenantId) as
    | { access_type: string; space_id: number; visitor_id: number; branch_id: number | null }
    | undefined;
}

export async function findVisitorTicketStatusAndBranch(visitorId: number, tenantId: number) {
  return await db
    .prepare("SELECT status, entry_time, branch_id FROM visitor_tickets WHERE id = ? AND tenant_id = ?")
    .get(visitorId, tenantId) as { status: string; entry_time: string; branch_id: number | null } | undefined;
}

export async function completeVisitorExitAndFreeSpace(params: {
  visitorId: number;
  spaceId: number;
  branchId: number;
  plate: string;
  tenantId: number;
}): Promise<void> {
  await db.prepare("UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ? AND tenant_id = ?").run(
    params.visitorId,
    params.tenantId,
  );
  await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND tenant_id = ?").run(params.spaceId, params.tenantId);
  await db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, plate, tenant_id) 
    VALUES (?, ?, ?, 'exit', 'authorized', 'qr', 'Salida Visita', ?, ?)
  `).run(params.visitorId, params.spaceId, params.branchId, params.plate, params.tenantId);
}

export async function findActiveContractSpaceForClient(clientId: number, tenantId: number) {
  return await db.prepare(`
    SELECT c.space_id, COALESCE(c.branch_id, s.branch_id) as branch_id
    FROM contracts c
    LEFT JOIN spaces s ON s.id = c.space_id AND s.tenant_id = c.tenant_id
    WHERE c.client_id = ? AND c.status = 'active' AND c.tenant_id = ?
  `).get(clientId, tenantId) as { space_id: number; branch_id: number | null } | undefined;
}

export async function findFirstAvailableSpaceForTenant(tenantId: number) {
  return await db
    .prepare("SELECT id, branch_id FROM spaces WHERE type = 'parking' AND status = 'available' AND tenant_id = ? LIMIT 1")
    .get(tenantId) as { id: number; branch_id: number | null } | undefined;
}

export async function occupySpaceAndCreateTotemTicket(params: {
  spaceId: number;
  branchId: number;
  plate: string;
  tenantId: number;
}) {
  await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ? AND tenant_id = ?").run(params.spaceId, params.tenantId);
  const ticket = await db
    .prepare("INSERT INTO visitor_tickets (plate, space_id, branch_id, entry_method, tenant_id) VALUES (?, ?, ?, 'totem', ?)")
    .run(params.plate, params.spaceId, params.branchId, params.tenantId);
  await db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, branch_id, access_type, status, method, reason, plate, tenant_id) 
    VALUES (?, ?, ?, 'entry', 'authorized', 'qr', 'Visita Temporal', ?, ?)
  `).run(ticket.lastInsertRowid, params.spaceId, params.branchId, params.plate, params.tenantId);
  return ticket.lastInsertRowid;
}

export async function queryLiveAccessLogs(tenantId: number, branchId: number | null) {
  const where = branchId ? "WHERE a.tenant_id = ? AND a.branch_id = ?" : "WHERE a.tenant_id = ?";
  const params = branchId ? [tenantId, branchId] : [tenantId];
  return await db.prepare(`
    SELECT a.*,
           c.name as client_name,
           s.name as space_name,
           COALESCE(v.name, 'Visita Temporal') as visitor_name,
           b.name as branch_name,
           b.code as branch_code
    FROM access_logs a
    LEFT JOIN clients c ON a.client_id = c.id AND c.tenant_id = a.tenant_id
    LEFT JOIN spaces s ON a.space_id = s.id AND s.tenant_id = a.tenant_id
    LEFT JOIN visitor_passes v ON a.visitor_id = v.id AND v.tenant_id = a.tenant_id
    LEFT JOIN branches b ON b.id = a.branch_id AND b.tenant_id = a.tenant_id
    ${where}
    ORDER BY timestamp DESC LIMIT 20
  `).all(...params);
}

export async function queryAuditAccessLogs(params: {
  tenantId: number;
  branchId: number | null;
  start?: unknown;
  end?: unknown;
  type?: unknown;
  user?: unknown;
  pageSize?: number;
  offset?: number;
  paginated: boolean;
}) {
  let query = `
    SELECT a.*,
           c.name as client_name,
           s.name as space_name,
           COALESCE(v.name, 'Visita Temporal') as visitor_name,
           b.name as branch_name,
           b.code as branch_code
    FROM access_logs a
    LEFT JOIN clients c ON a.client_id = c.id AND c.tenant_id = a.tenant_id
    LEFT JOIN spaces s ON a.space_id = s.id AND s.tenant_id = a.tenant_id
    LEFT JOIN visitor_passes v ON a.visitor_id = v.id AND v.tenant_id = a.tenant_id
    LEFT JOIN branches b ON b.id = a.branch_id AND b.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
  `;
  const sqlParams: unknown[] = [params.tenantId];

  if (params.branchId) {
    query += " AND a.branch_id = ?";
    sqlParams.push(params.branchId);
  }
  if (params.start) {
    query += " AND timestamp >= ?";
    sqlParams.push(params.start);
  }
  if (params.end) {
    query += " AND timestamp <= ?";
    sqlParams.push(params.end);
  }
  if (params.type) {
    query += " AND a.status = ?";
    sqlParams.push(params.type);
  }
  if (params.user) {
    query += " AND (c.name LIKE ? OR v.name LIKE ? OR c.rut LIKE ? OR v.rut LIKE ? OR a.plate LIKE ?)";
    const p = `%${params.user}%`;
    sqlParams.push(p, p, p, p, p);
  }

  const total = Number(
    (await db.prepare(`SELECT COUNT(*) as count FROM (${query}) audit_rows`).get(...sqlParams) as { count: number }).count || 0,
  );
  query += " ORDER BY timestamp DESC";
  const listParams = [...sqlParams];
  if (params.paginated) {
    query += " LIMIT ? OFFSET ?";
    listParams.push(params.pageSize, params.offset);
  }
  const logs = await db.prepare(query).all(...listParams);
  return { logs, total };
}

export async function findDeniedAccessLogById(deniedLogId: number, tenantId: number) {
  return await db.prepare(`
    SELECT *
    FROM access_logs
    WHERE id = ? AND status = 'denied' AND tenant_id = ?
  `).get(deniedLogId, tenantId) as Record<string, any> | undefined;
}

export async function applyManualOverrideEffectsInDb(params: {
  resolvedAccessType: string;
  resolvedVisitorId: number | null;
  resolvedSpaceId: number;
  deniedLogId: number | null;
  newAccessLogId: number;
  reason: string | null;
  tenantId: number;
}): Promise<void> {
  if (params.resolvedAccessType === "exit" && params.resolvedVisitorId) {
    await db.prepare(
      "UPDATE visitor_tickets SET status = 'completed', exit_time = datetime('now') WHERE id = ? AND tenant_id = ?",
    ).run(params.resolvedVisitorId, params.tenantId);
    await db.prepare("UPDATE spaces SET status = 'available' WHERE id = ? AND tenant_id = ?").run(
      params.resolvedSpaceId,
      params.tenantId,
    );
  }

  if (params.resolvedAccessType === "entry" && params.resolvedVisitorId) {
    await db.prepare("UPDATE visitor_tickets SET status = 'active' WHERE id = ? AND tenant_id = ?").run(
      params.resolvedVisitorId,
      params.tenantId,
    );
    await db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ? AND tenant_id = ?").run(
      params.resolvedSpaceId,
      params.tenantId,
    );
  }

  if (params.deniedLogId) {
    await db.prepare(`
      UPDATE access_logs
      SET resolved_by_access_log_id = ?,
          resolved_at = datetime('now'),
          resolution_note = ?
      WHERE id = ? AND tenant_id = ?
    `).run(params.newAccessLogId, params.reason, params.deniedLogId, params.tenantId);
  }
}

export async function queryAccessRatesForTenant(tenantId: number) {
  return await db.prepare("SELECT * FROM access_rates WHERE tenant_id = ?").all(tenantId);
}

export async function findAccessRateByIdAndTenant(rateId: string | number, tenantId: number) {
  return await db.prepare("SELECT * FROM access_rates WHERE id = ? AND tenant_id = ?").get(rateId, tenantId) as
    | Record<string, any>
    | undefined;
}

export async function updateAccessRateRow(params: {
  rateId: string | number;
  tenantId: number;
  ratePerMinute: number;
  gracePeriodMins: number;
}): Promise<void> {
  await db.prepare(`
    UPDATE access_rates
    SET rate_per_minute = ?,
        rate_per_hour = ?,
        grace_period_mins = ?,
        billing_mode = 'per_minute'
    WHERE id = ? AND tenant_id = ?
  `).run(
    params.ratePerMinute,
    params.ratePerMinute * 60,
    params.gracePeriodMins,
    params.rateId,
    params.tenantId,
  );
}

