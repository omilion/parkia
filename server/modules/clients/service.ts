import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import type { PaginationParams } from "../../pagination";
import {
  archiveVehicleById,
  bulkInsertImportedClients,
  countClientActiveOrSuspendedContracts,
  findClientById,
  findClientByRut,
  findVehicleByIdAndClient,
  findVehicleByPlate,
  getClientSummaryFromDb,
  insertClientWithOptionalVehicle,
  insertVehicle,
  listClientAccessLogs,
  listClientActiveVehicles,
  listClientContracts,
  listClientDocuments,
  listClientPayments,
  listClientsFromDb,
  reactivateVehicle,
  updateClientFields,
  updateClientStatus,
} from "./repo";

export function validateRut(rut: string) {
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

export function normalizePlate(plate: string) {
  return plate.trim().toUpperCase();
}

export async function listClients(params: {
  tenantId: number;
  includeArchived: boolean;
  requestedStatus: string;
  requestedType: string;
  search: string;
  pagination: PaginationParams;
}) {
  return await listClientsFromDb(params);
}

export async function getClientDetail(clientId: string | number, tenantId: number) {
  const client = await findClientById(clientId, tenantId);
  if (!client) return null;

  const vehicles = await listClientActiveVehicles(clientId, tenantId);
  const contracts = await listClientContracts(clientId, tenantId);
  const payments = await listClientPayments(clientId, tenantId);
  const access = await listClientAccessLogs(clientId, tenantId);
  const documents = await listClientDocuments(clientId, tenantId);
  const summary = await getClientSummaryFromDb(clientId, tenantId);

  return { client, vehicles, summary, contracts, payments, access, documents };
}

export async function createClient(
  req: Request,
  tenantId: number,
  body: {
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
  }
) {
  const normalizedPlate = body.plate && body.plate.trim() !== "" ? normalizePlate(body.plate) : null;
  const id = await insertClientWithOptionalVehicle(tenantId, body, normalizedPlate);
  await recordAuditEvent(req, {
    action: "client.created",
    entityType: "client",
    entityId: id,
    metadata: { rut: body.rut, type: body.type, has_vehicle: Boolean(body.plate) },
  });
  return id;
}

export async function updateClient(
  req: Request,
  clientId: string | number,
  tenantId: number,
  body: Record<string, any>
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const client = await findClientById(clientId, tenantId);
  if (!client) return { ok: false, status: 404, error: "Cliente no encontrado" };

  const fields = Object.keys(body);
  if (fields.length === 0) return { ok: false, status: 400, error: "No hay campos validos para actualizar" };

  const values = fields.map(field => body[field]);
  await updateClientFields(clientId, tenantId, fields, values);

  await recordAuditEvent(req, {
    action: "client.updated",
    entityType: "client",
    entityId: clientId,
    metadata: { fields },
  });

  return { ok: true };
}

export async function changeClientStatus(
  req: Request,
  clientId: string | number,
  tenantId: number,
  body: { status?: "active" | "archived"; reason?: string }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const client = await findClientById(clientId, tenantId);
  if (!client) return { ok: false, status: 404, error: "Cliente no encontrado" };

  if (body.status === "archived") {
    const activeCount = await countClientActiveOrSuspendedContracts(clientId, tenantId);
    if (activeCount > 0) {
      return { ok: false, status: 400, error: "No se puede archivar un cliente con contratos activos o suspendidos" };
    }
  }

  await updateClientStatus(clientId, tenantId, body.status || "active");
  await recordAuditEvent(req, {
    action: "client.status_updated",
    entityType: "client",
    entityId: clientId,
    metadata: { previous_status: client.status || "active", status: body.status, reason: body.reason },
  });
  return { ok: true };
}

export async function upsertClientVehicle(
  req: Request,
  clientId: string | number,
  tenantId: number,
  body: { plate?: string; brand?: string | null; model?: string | null; color?: string | null; notes?: string | null }
): Promise<{ ok: true; id: number | bigint; reactivated?: boolean } | { ok: false; status: number; error: string }> {
  const client = await findClientById(clientId, tenantId);
  if (!client) return { ok: false, status: 404, error: "Cliente no encontrado" };

  const plate = normalizePlate(body.plate || "");
  const archivedVehicle = await findVehicleByPlate(plate, tenantId);
  if (archivedVehicle && archivedVehicle.status === "archived") {
    await reactivateVehicle(archivedVehicle.id, clientId, tenantId, body);
    await recordAuditEvent(req, {
      action: "client.vehicle_reactivated",
      entityType: "vehicle",
      entityId: archivedVehicle.id,
      metadata: { previous_client_id: archivedVehicle.client_id, client_id: clientId, plate },
    });
    return { ok: true, id: archivedVehicle.id, reactivated: true };
  }

  const id = await insertVehicle(clientId, plate, tenantId, body);
  await recordAuditEvent(req, {
    action: "client.vehicle_created",
    entityType: "vehicle",
    entityId: id,
    metadata: { client_id: clientId, plate },
  });
  return { ok: true, id };
}

export async function archiveClientVehicle(
  req: Request,
  clientId: string | number,
  vehicleId: string | number,
  tenantId: number,
  reason?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const vehicle = await findVehicleByIdAndClient(vehicleId, clientId, tenantId);
  if (!vehicle) return { ok: false, status: 404, error: "Vehiculo no encontrado" };
  if (vehicle.status === "archived") return { ok: false, status: 400, error: "Vehiculo ya dado de baja" };

  await archiveVehicleById(vehicle.id, tenantId, reason || "Baja solicitada desde ficha de cliente");
  await recordAuditEvent(req, {
    action: "client.vehicle_archived",
    entityType: "vehicle",
    entityId: vehicle.id,
    metadata: { client_id: vehicle.client_id, plate: vehicle.plate, reason: reason || null },
  });
  return { ok: true };
}

export async function importClientsFromCsv(
  req: Request,
  tenantId: number,
  body: { csvText?: string; dryRun?: boolean }
) {
  const rows = parseClientsCsv(body.csvText || "");
  const errors: { row: number; error: string }[] = [];
  const clientsToInsert: {
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

    if (await findClientByRut(rut, tenantId)) {
      errors.push({ row: rowNumber, error: "RUT ya existe" });
      continue;
    }
    if (plate) {
      if (await findVehicleByPlate(plate, tenantId)) {
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
    return {
      ok: true as const,
      payload: {
        success: true,
        dryRun: true,
        valid: clientsToInsert.length,
        skipped: errors.length,
        preview: clientsToInsert.slice(0, 20),
        errors,
      },
    };
  }

  if (clientsToInsert.length === 0) {
    return {
      ok: false as const,
      status: 400,
      payload: { error: "No hay clientes válidos para importar", errors },
    };
  }

  await bulkInsertImportedClients(tenantId, clientsToInsert);

  await recordAuditEvent(req, {
    action: "clients.imported",
    entityType: "client_import",
    entityId: null,
    metadata: { imported: clientsToInsert.length, skipped: errors.length },
  });

  return {
    ok: true as const,
    payload: { success: true, imported: clientsToInsert.length, skipped: errors.length, errors },
  };
}

