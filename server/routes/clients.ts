import type { Express } from "express";
import { z } from "zod";
import { requireAnyRole } from "../auth/sessions";
import { recordAuditEvent } from "../audit";
import { db } from "../db";
import { likeValue, paginatedResponse, parsePagination, queryText } from "../pagination";
import { optionalTextSchema, parseBody } from "../validation";

const createClientSchema = z.object({
  name: z.string().trim().min(1),
  email: optionalTextSchema,
  phone: optionalTextSchema,
  rut: z.string().trim().min(1),
  type: z.enum(["natural", "company"]).default("natural"),
  plate: optionalTextSchema,
  address: optionalTextSchema,
  commune: optionalTextSchema,
  city: optionalTextSchema,
  business_activity: optionalTextSchema,
  legal_representative_name: optionalTextSchema,
  legal_representative_rut: optionalTextSchema,
  billing_contact_name: optionalTextSchema,
  billing_contact_email: optionalTextSchema,
  billing_contact_phone: optionalTextSchema,
  notes: optionalTextSchema,
});

const updateClientSchema = createClientSchema.omit({ plate: true }).partial();

const updateClientStatusSchema = z.object({
  status: z.enum(["active", "archived"]),
  reason: z.string().trim().min(3).max(500),
});

const upsertVehicleSchema = z.object({
  plate: z.string().trim().min(2),
  brand: optionalTextSchema,
  model: optionalTextSchema,
  color: optionalTextSchema,
  notes: optionalTextSchema,
});

const archiveVehicleSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const importClientsSchema = z.object({
  csvText: z.string().min(1),
  dryRun: z.boolean().optional(),
});

function validateRut(rut: string) {
  const cleanRut = rut.replace(/\./g, "").replace(/-/g, "").toUpperCase();
  if (cleanRut.length < 2) return false;

  const body = cleanRut.slice(0, -1);
  const dv = cleanRut.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index--) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const result = 11 - (sum % 11);
  const expectedDv = result === 11 ? "0" : result === 10 ? "K" : String(result);
  return expectedDv === dv;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeImportHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const clientImportHeaderAliases: Record<string, string> = {
  name: "name",
  nombre: "name",
  cliente: "name",
  rut: "rut",
  email: "email",
  correo: "email",
  correoelectronico: "email",
  phone: "phone",
  telefono: "phone",
  type: "type",
  tipo: "type",
  tipocliente: "type",
  plate: "plate",
  patente: "plate",
  address: "address",
  direccion: "address",
  commune: "commune",
  comuna: "commune",
  city: "city",
  ciudad: "city",
  businessactivity: "business_activity",
  giro: "business_activity",
  actividadcomercial: "business_activity",
  legalrepresentativename: "legal_representative_name",
  representantelegal: "legal_representative_name",
  nombrerepresentantelegal: "legal_representative_name",
  legalrepresentativerut: "legal_representative_rut",
  rutrepresentantelegal: "legal_representative_rut",
  billingcontactname: "billing_contact_name",
  contactofacturacion: "billing_contact_name",
  nombrecontactofacturacion: "billing_contact_name",
  billingcontactemail: "billing_contact_email",
  correofacturacion: "billing_contact_email",
  emailfacturacion: "billing_contact_email",
  billingcontactphone: "billing_contact_phone",
  telefonofacturacion: "billing_contact_phone",
  notes: "notes",
  notas: "notes",
  observaciones: "notes",
};

const clientTypeAliases: Record<string, "natural" | "company"> = {
  natural: "natural",
  persona: "natural",
  personanatural: "natural",
  particular: "natural",
  company: "company",
  empresa: "company",
  compania: "company",
  personajuridica: "company",
};

function normalizeClientType(value: string) {
  const key = normalizeImportHeader(value || "natural");
  return clientTypeAliases[key];
}

function parseClientsCsv(csvText: string) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length < 2) throw new Error("El CSV debe incluir encabezados y al menos un cliente");

  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map(header => clientImportHeaderAliases[normalizeImportHeader(header)] || normalizeImportHeader(header));
  const requiredHeaders = ["name", "rut"];
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) {
      const label = header === "name" ? "Nombre" : "RUT";
      throw new Error(`Falta columna requerida: ${label}`);
    }
  }

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      row[header] = values[headerIndex]?.trim() || "";
    });
    return { rowNumber: index + 2, row };
  });
}

function normalizePlate(plate: string) {
  return plate.trim().toUpperCase();
}

function getClientSummary(clientId: string | number) {
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
      WHERE reversed_at IS NULL
      GROUP BY payment_id
    ) alloc ON alloc.payment_id = p.id
    WHERE c.client_id = ?
  `).get(clientId) as { total_debt: number, pending_debt: number, overdue_debt: number };

  const activeContracts = db.prepare("SELECT COUNT(*) as count FROM contracts WHERE client_id = ? AND status = 'active'").get(clientId) as { count: number };
  const documents = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('pending', 'rejected') THEN 1 ELSE 0 END) as pending_documents,
      SUM(CASE WHEN status = 'expired' OR (expires_at IS NOT NULL AND date(expires_at) < date('now')) THEN 1 ELSE 0 END) as expired_documents
    FROM documents
    WHERE entity_type = 'client' AND entity_id = ?
  `).get(clientId) as { pending_documents: number | null, expired_documents: number | null };

  return {
    activeContracts: activeContracts.count,
    totalDebt: Number(debt.total_debt || 0),
    pendingDebt: Number(debt.pending_debt || 0),
    overdueDebt: Number(debt.overdue_debt || 0),
    pendingDocuments: Number(documents.pending_documents || 0),
    expiredDocuments: Number(documents.expired_documents || 0),
  };
}

export function registerClientsRoutes(app: Express) {
  app.use("/api/clients", requireAnyRole(["admin", "finance"]));

  app.get("/api/clients", (req, res) => {
    const requestedStatus = queryText(req.query.status);
    const includeArchived = req.query.includeArchived === "true" || requestedStatus === "archived";
    const requestedType = queryText(req.query.type);
    const search = queryText(req.query.search);
    const pagination = parsePagination(req.query as Record<string, unknown>);

    const baseParams: any[] = [includeArchived ? 1 : 0];
    let baseWhere = "WHERE (? = 1 OR COALESCE(c.status, 'active') != 'archived')";
    if (requestedType && requestedType !== "all") {
      baseWhere += " AND c.type = ?";
      baseParams.push(requestedType);
    }
    if (search) {
      const like = likeValue(search);
      baseWhere += `
        AND (
          c.name LIKE ? OR c.rut LIKE ? OR COALESCE(c.email, '') LIKE ? OR COALESCE(c.phone, '') LIKE ?
          OR EXISTS (SELECT 1 FROM vehicles v WHERE v.client_id = c.id AND COALESCE(v.status, 'active') = 'active' AND v.plate LIKE ?)
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
          WHERE con.client_id = c.id AND con.status = 'active'
          ORDER BY s.name
        )
      ) as products,
      (SELECT COUNT(*) FROM contracts con WHERE con.client_id = c.id AND con.status = 'active') as active_contract_count,
      (SELECT plate FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active' ORDER BY id LIMIT 1) as plate,
      (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates,
      (SELECT COUNT(*) FROM vehicles WHERE client_id = c.id AND COALESCE(status, 'active') = 'active') as vehicles_count,
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
        WHERE con.client_id = c.id
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
    res.json(pagination.requested ? paginatedResponse(clients, total, pagination) : clients);
  });

  app.get("/api/clients/:id", (req, res) => {
    const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });

    const vehicles = db.prepare(`
      SELECT id, plate, brand, model, color, notes, status, archived_at, archive_reason
      FROM vehicles
      WHERE client_id = ?
        AND COALESCE(status, 'active') = 'active'
      ORDER BY id ASC
    `).all(req.params.id);

    const contracts = db.prepare(`
      SELECT c.*, s.name as space_name, s.type as space_type,
      (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates,
      COALESCE((
        SELECT SUM(CASE WHEN p.status IN ('pending', 'overdue')
          THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
          ELSE 0 END)
        FROM payments p
        LEFT JOIN (
          SELECT payment_id, SUM(amount) as allocated_amount
          FROM payment_allocations
          WHERE reversed_at IS NULL
          GROUP BY payment_id
        ) alloc ON alloc.payment_id = p.id
        WHERE p.contract_id = c.id
      ), 0) as pending_amount,
      (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'contract' AND d.entity_id = c.id) as documents_count
      FROM contracts c
      JOIN spaces s ON c.space_id = s.id
      WHERE c.client_id = ?
      ORDER BY
        CASE c.status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END,
        c.start_date DESC
    `).all(req.params.id);

    const payments = db.prepare(`
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
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) alloc ON alloc.payment_id = p.id
      WHERE c.client_id = ?
      ORDER BY date(p.due_date) DESC, p.id DESC
    `).all(req.params.id);

    const access = db.prepare(`
      SELECT a.*, s.name as space_name 
      FROM access_logs a 
      JOIN spaces s ON a.space_id = s.id 
      WHERE a.client_id = ?
      ORDER BY timestamp DESC LIMIT 20
    `).all(req.params.id);

    const documents = db.prepare(`
      SELECT id, entity_type, entity_id, label, document_type, status, expires_at, notes,
             file_name, mime_type, size_bytes, created_at
      FROM documents
      WHERE entity_type = 'client' AND entity_id = ?
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
    `).all(req.params.id);

    res.json({ client, vehicles, summary: getClientSummary(req.params.id), contracts, payments, access, documents });
  });

  app.post("/api/clients", (req, res) => {
    const body = parseBody(createClientSchema, req.body, res);
    if (!body) return;

    const {
      name,
      email,
      phone,
      rut,
      type,
      plate,
      address,
      commune,
      city,
      business_activity,
      legal_representative_name,
      legal_representative_rut,
      billing_contact_name,
      billing_contact_email,
      billing_contact_phone,
      notes,
    } = body;
    try {
      const transaction = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO clients (
            name, email, phone, rut, type, address, commune, city, business_activity,
            legal_representative_name, legal_representative_rut,
            billing_contact_name, billing_contact_email, billing_contact_phone, notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          name,
          email,
          phone,
          rut,
          type,
          address,
          commune,
          city,
          business_activity,
          legal_representative_name,
          legal_representative_rut,
          billing_contact_name,
          billing_contact_email,
          billing_contact_phone,
          notes,
        );
        const clientId = result.lastInsertRowid;

        if (plate && plate.trim() !== '') {
          db.prepare("INSERT INTO vehicles (client_id, plate) VALUES (?, ?)").run(clientId, normalizePlate(plate));
        }

        return clientId;
      });
      const id = transaction();
      recordAuditEvent(req, {
        action: "client.created",
        entityType: "client",
        entityId: id,
        metadata: { rut, type, has_vehicle: Boolean(plate) },
      });
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/clients/:id", (req, res) => {
    const body = parseBody(updateClientSchema, req.body, res);
    if (!body) return;

    const client = db.prepare("SELECT * FROM clients WHERE id = ?").get(req.params.id) as any;
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

    const fields = Object.keys(body);
    if (fields.length === 0) return res.status(400).json({ error: "No hay campos validos para actualizar" });

    try {
      const sets = fields.map(field => `${field} = ?`).join(", ");
      const values = fields.map(field => (body as any)[field]);
      db.prepare(`UPDATE clients SET ${sets} WHERE id = ?`).run(...values, req.params.id);

      recordAuditEvent(req, {
        action: "client.updated",
        entityType: "client",
        entityId: req.params.id,
        metadata: { fields },
      });

      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/clients/:id/status", (req, res) => {
    const body = parseBody(updateClientStatusSchema, req.body, res);
    if (!body) return;

    const client = db.prepare("SELECT id, status FROM clients WHERE id = ?").get(req.params.id) as { id: number, status: string | null } | undefined;
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

    if (body.status === "archived") {
      const activeContracts = db.prepare("SELECT COUNT(*) as count FROM contracts WHERE client_id = ? AND status IN ('active', 'suspended')").get(req.params.id) as { count: number };
      if (activeContracts.count > 0) {
        return res.status(400).json({ error: "No se puede archivar un cliente con contratos activos o suspendidos" });
      }
    }

    db.prepare("UPDATE clients SET status = ? WHERE id = ?").run(body.status, req.params.id);
    recordAuditEvent(req, {
      action: "client.status_updated",
      entityType: "client",
      entityId: req.params.id,
      metadata: { previous_status: client.status || "active", status: body.status, reason: body.reason },
    });
    res.json({ success: true });
  });

  app.post("/api/clients/:id/vehicles", (req, res) => {
    const body = parseBody(upsertVehicleSchema, req.body, res);
    if (!body) return;

    const client = db.prepare("SELECT id FROM clients WHERE id = ?").get(req.params.id);
    if (!client) return res.status(404).json({ error: "Cliente no encontrado" });

    try {
      const plate = normalizePlate(body.plate);
      const archivedVehicle = db.prepare("SELECT id, client_id, status FROM vehicles WHERE plate = ?").get(plate) as { id: number, client_id: number, status: string | null } | undefined;
      if (archivedVehicle && archivedVehicle.status === "archived") {
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
          WHERE id = ?
        `).run(req.params.id, body.brand, body.model, body.color, body.notes, archivedVehicle.id);

        recordAuditEvent(req, {
          action: "client.vehicle_reactivated",
          entityType: "vehicle",
          entityId: archivedVehicle.id,
          metadata: { previous_client_id: archivedVehicle.client_id, client_id: req.params.id, plate },
        });
        return res.json({ success: true, id: archivedVehicle.id, reactivated: true });
      }

      const result = db.prepare(`
        INSERT INTO vehicles (client_id, plate, brand, model, color, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.params.id, plate, body.brand, body.model, body.color, body.notes);

      recordAuditEvent(req, {
        action: "client.vehicle_created",
        entityType: "vehicle",
        entityId: result.lastInsertRowid,
        metadata: { client_id: req.params.id, plate },
      });

      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/clients/:id/vehicles/:vehicleId", (req, res) => {
    const parsed = archiveVehicleSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "Motivo de baja invalido" });

    const vehicle = db.prepare("SELECT id, plate, client_id, status FROM vehicles WHERE id = ? AND client_id = ?").get(req.params.vehicleId, req.params.id) as { id: number, plate: string, client_id: number, status: string | null } | undefined;
    if (!vehicle) return res.status(404).json({ error: "Vehiculo no encontrado" });
    if (vehicle.status === "archived") return res.status(400).json({ error: "Vehiculo ya dado de baja" });

    db.prepare(`
      UPDATE vehicles
      SET status = 'archived',
          archived_at = datetime('now'),
          archive_reason = ?
      WHERE id = ?
    `).run(parsed.data.reason || "Baja solicitada desde ficha de cliente", vehicle.id);
    recordAuditEvent(req, {
      action: "client.vehicle_archived",
      entityType: "vehicle",
      entityId: vehicle.id,
      metadata: { client_id: vehicle.client_id, plate: vehicle.plate, reason: parsed.data.reason || null },
    });

    res.json({ success: true });
  });

  app.post("/api/clients/import", (req, res) => {
    const body = parseBody(importClientsSchema, req.body, res);
    if (!body) return;

    try {
      const rows = parseClientsCsv(body.csvText);
      const errors: { row: number, error: string }[] = [];
      const clientsToInsert: {
        name: string,
        email: string | null,
        phone: string | null,
        rut: string,
        type: "natural" | "company",
        plate: string | null,
        address: string | null,
        commune: string | null,
        city: string | null,
        business_activity: string | null,
        legal_representative_name: string | null,
        legal_representative_rut: string | null,
        billing_contact_name: string | null,
        billing_contact_email: string | null,
        billing_contact_phone: string | null,
        notes: string | null,
      }[] = [];
      const seenRuts = new Set<string>();

      for (const { rowNumber, row } of rows) {
        const name = row.name?.trim();
        const rut = row.rut?.trim();
        const type = normalizeClientType(row.type?.trim() || "natural");
        const email = row.email?.trim() || null;
        const phone = row.phone?.trim() || null;
        const plate = row.plate ? normalizePlate(row.plate) : null;
        const address = row.address?.trim() || null;
        const commune = row.commune?.trim() || null;
        const city = row.city?.trim() || null;
        const business_activity = row.business_activity?.trim() || null;
        const legal_representative_name = row.legal_representative_name?.trim() || null;
        const legal_representative_rut = row.legal_representative_rut?.trim() || null;
        const billing_contact_name = row.billing_contact_name?.trim() || null;
        const billing_contact_email = row.billing_contact_email?.trim() || null;
        const billing_contact_phone = row.billing_contact_phone?.trim() || null;
        const notes = row.notes?.trim() || null;

        if (!name) {
          errors.push({ row: rowNumber, error: "Nombre requerido" });
          continue;
        }
        if (!rut || !validateRut(rut)) {
          errors.push({ row: rowNumber, error: "RUT inválido" });
          continue;
        }
        if (!type) {
          errors.push({ row: rowNumber, error: "Tipo inválido" });
          continue;
        }
        const normalizedRut = rut.replace(/\./g, "").replace(/-/g, "").toUpperCase();
        if (seenRuts.has(normalizedRut)) {
          errors.push({ row: rowNumber, error: "RUT duplicado en archivo" });
          continue;
        }
        seenRuts.add(normalizedRut);

        const existing = db.prepare("SELECT id FROM clients WHERE rut = ?").get(rut);
        if (existing) {
          errors.push({ row: rowNumber, error: "RUT ya existe" });
          continue;
        }
        if (plate) {
          const existingPlate = db.prepare("SELECT id FROM vehicles WHERE plate = ?").get(plate);
          if (existingPlate) {
            errors.push({ row: rowNumber, error: "Patente ya existe" });
            continue;
          }
        }

        clientsToInsert.push({
          name,
          email,
          phone,
          rut,
          type,
          plate,
          address,
          commune,
          city,
          business_activity,
          legal_representative_name,
          legal_representative_rut,
          billing_contact_name,
          billing_contact_email,
          billing_contact_phone,
          notes,
        });
      }

      if (body.dryRun) {
        return res.json({
          success: true,
          dryRun: true,
          valid: clientsToInsert.length,
          skipped: errors.length,
          preview: clientsToInsert.slice(0, 20),
          errors,
        });
      }

      if (clientsToInsert.length === 0) {
        return res.status(400).json({ error: "No hay clientes válidos para importar", errors });
      }

      const transaction = db.transaction(() => {
        for (const client of clientsToInsert) {
          const result = db.prepare(`
            INSERT INTO clients (
              name, email, phone, rut, type, address, commune, city, business_activity,
              legal_representative_name, legal_representative_rut,
              billing_contact_name, billing_contact_email, billing_contact_phone, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          );
          if (client.plate) {
            db.prepare("INSERT INTO vehicles (client_id, plate) VALUES (?, ?)").run(result.lastInsertRowid, client.plate);
          }
        }
      });
      transaction();

      recordAuditEvent(req, {
        action: "clients.imported",
        entityType: "client_import",
        entityId: null,
        metadata: { imported: clientsToInsert.length, skipped: errors.length },
      });

      res.json({ success: true, imported: clientsToInsert.length, skipped: errors.length, errors });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo importar clientes" });
    }
  });
}
