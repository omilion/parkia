import { mkdirSync, readdirSync, statSync } from "fs";
import Database from "better-sqlite3";
import path from "path";
import type { Request } from "express";
import { recordAuditEvent } from "../../audit";
import { getParkiaEnv } from "../../env";
import { getTenantIdFromRequest } from "../../tenant";
import { getTenantSettings, updateTenantSettings } from "../../tenantSettings";
import {
  backupDatabaseFileInDb,
  listTotemsFromDb,
  updateTotemMaintenanceInDb,
} from "./repo";

export const importTemplates = [
  {
    id: "clients",
    label: "Clientes y vehiculos",
    description: "Base comercial para personas, empresas, facturacion y patente principal.",
    columns: [
      "Nombre",
      "RUT",
      "Correo",
      "Teléfono",
      "Tipo",
      "Patente",
      "Dirección",
      "Comuna",
      "Ciudad",
      "Giro",
      "Representante legal",
      "RUT representante legal",
      "Contacto facturación",
      "Correo facturación",
      "Teléfono facturación",
      "Notas",
    ],
    rows: [
      ["Cliente Ejemplo", "11.111.111-1", "cliente@example.com", "+56911111111", "Persona natural", "ABCD-11", "Av. Ejemplo 123", "Santiago", "Santiago", "", "", "", "Cliente Ejemplo", "cliente@example.com", "+56911111111", "Cliente inicial"],
      ["Empresa Ejemplo SpA", "22.222.222-2", "empresa@example.com", "+56922222222", "Empresa", "", "Av. Empresa 456", "Providencia", "Santiago", "Servicios", "Representante Legal", "12.345.678-9", "Finanzas Empresa", "finanzas@empresa.cl", "+56922222222", "Empresa inicial"],
    ],
  },
  {
    id: "spaces",
    label: "Plazas de estacionamiento",
    description: "Inventario inicial de plazas por sucursal, estado, tarifa mensual y ubicacion.",
    columns: ["Sucursal", "Nombre", "Estado", "Precio mensual", "Ubicacion", "Nivel", "Ancho m", "Largo m", "Alto m", "Caracteristicas", "Notas"],
    rows: [
      ["Sucursal Principal", "A-01", "Disponible", "65000", "Sector norte", "1", "2.5", "5", "2.2", "Techado, camara", "Plaza inicial"],
      ["Sucursal Principal", "E-12", "Mantencion", "65000", "Patio exterior", "0", "2.5", "5", "", "Descubierto", "Revisar demarcacion"],
    ],
  },
  {
    id: "subscribers",
    label: "Abonados",
    description: "Carga base para clientes con contrato mensual, vehiculo principal y plaza asignada.",
    columns: ["RUT cliente", "Nombre cliente", "Correo", "Telefono", "Patente", "Sucursal", "Plaza", "Fecha inicio", "Fecha termino", "Mensualidad", "Dia facturacion", "Garantia", "Documento facturacion", "Notas"],
    rows: [
      ["11.111.111-1", "Cliente Abonado", "abonado@example.com", "+56911111111", "ABCD-11", "Sucursal Principal", "A-01", "2026-06-01", "", "65000", "5", "65000", "boleta", "Abonado mensual"],
    ],
  },
  {
    id: "contracts",
    label: "Contratos",
    description: "Contratos vigentes vinculados por RUT de cliente y nombre de espacio.",
    columns: ["RUT cliente", "Espacio", "Fecha inicio", "Fecha término", "Mensualidad", "Día facturación", "Garantía", "Documento facturación", "Notas"],
    rows: [
      ["11.111.111-1", "Estacionamiento A-01", "2026-05-01", "", "65000", "5", "65000", "boleta", "Contrato mensual"],
    ],
  },
  {
    id: "payments",
    label: "Saldos y pagos",
    description: "Cuotas pendientes o historicas para dejar la cobranza al dia.",
    columns: ["Contrato", "RUT cliente", "Monto", "Fecha de vencimiento", "Estado", "Fecha de pago", "Método", "Referencia"],
    rows: [
      ["", "11.111.111-1", "85000", "2026-05-05", "Pendiente", "", "", "Saldo inicial mayo"],
      ["", "22.222.222-2", "65000", "2026-04-05", "Pagado", "2026-04-04", "Transferencia", "TRX-123"],
    ],
  },
  {
    id: "expenses",
    label: "Gastos",
    description: "Gastos por pagar o pagados para iniciar finanzas con costos reales.",
    columns: ["Fecha", "Categoría", "Proveedor", "RUT proveedor", "Descripción", "Monto neto", "Impuesto", "Monto total", "Tipo documento", "Número documento", "Método de pago", "Estado de pago", "Fecha de pago", "Fecha de vencimiento", "Notas"],
    rows: [
      ["2026-05-10", "Mantención", "Proveedor Mantencion", "76.111.222-3", "Mantencion porton", "100000", "19000", "119000", "Factura", "F-123", "Transferencia", "Pendiente", "", "2026-05-30", "Carga inicial"],
    ],
  },
  {
    id: "bank-movements",
    label: "Cartola bancaria",
    description: "Movimientos bancarios para conciliacion manual o automatica.",
    columns: ["Fecha", "Glosa", "RUT", "Monto", "Notas"],
    rows: [
      ["2026-05-12", "TRANSFERENCIA CLIENTE EJEMPLO", "11.111.111-1", "85000", "Carga inicial cartola"],
      ["2026-05-13", "PAGO PROVEEDOR MANTENCION", "76.111.222-3", "-119000", "Gasto"],
    ],
  },
  {
    id: "rates",
    label: "Tarifas de visitas",
    description: "Tarifas operativas para cobro por minuto, periodo de gracia y estacionamiento de visitantes.",
    columns: ["Tipo", "Tarifa por minuto", "Minutos de gracia", "Sucursal", "Notas"],
    rows: [
      ["visitor", "50", "10", "Sucursal Principal", "Tarifa general de visita"],
      ["overnight", "35", "0", "Sucursal Principal", "Tarifa nocturna referencial"],
    ],
  },
];

export const importEndpointsByTemplateId: Record<string, string> = {
  clients: "/api/clients/import",
  "bank-movements": "/api/finance/bank-movements/import",
};

export function getBackupRoot() {
  return path.resolve(getParkiaEnv("PARKIA_BACKUP_PATH", "TIOLUCHIN_BACKUP_PATH", path.join(process.cwd(), "backups")));
}

export function isBackupFileName(fileName: string) {
  return /^(parkia|tioluchin)-.+\.sqlite(\.gz)?$/.test(fileName) || /^parkia-full-.+\.tar\.gz$/.test(fileName);
}

export function getBackupPath(fileName: string) {
  if (!isBackupFileName(fileName)) throw new Error("Nombre de respaldo inválido");
  const backupRoot = getBackupRoot();
  const resolved = path.resolve(backupRoot, fileName);
  if (!resolved.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Ruta de respaldo inválida");
  return resolved;
}

export function getDatabasePath() {
  return path.resolve(getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"));
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export async function getConfigForTenant(tenantId: number) {
  return await getTenantSettings(tenantId);
}

export async function patchConfigForTenant(req: Request, body: Record<string, unknown>) {
  const fields = Object.keys(body);
  if (fields.length === 0) {
    return { ok: false as const, status: 400, error: "No valid config fields provided" };
  }

  const tenantId = await getTenantIdFromRequest(req);
  const updatedFields = await updateTenantSettings(tenantId, body);
  await recordAuditEvent(req, {
    action: "config.updated",
    entityType: "tenant_settings",
    entityId: tenantId,
    metadata: { fields: updatedFields },
  });
  return { ok: true as const };
}

export async function listTotemsForTenant(tenantId: number) {
  return await listTotemsFromDb(tenantId);
}

export async function patchTotemMaintenanceForTenant(req: Request, totemId: string, maintenanceMode: boolean) {
  const tenantId = await getTenantIdFromRequest(req);
  const changes = await updateTotemMaintenanceInDb(totemId, tenantId, maintenanceMode);
  if (changes === 0) return { ok: false as const, status: 404, error: "Totem no encontrado" };
  await recordAuditEvent(req, {
    action: "totem.maintenance_updated",
    entityType: "totem",
    entityId: totemId,
    metadata: { maintenance_mode: maintenanceMode },
  });
  return { ok: true as const };
}

export function listDatabaseBackups() {
  const backupRoot = getBackupRoot();
  mkdirSync(backupRoot, { recursive: true });
  return readdirSync(backupRoot)
    .filter(isBackupFileName)
    .map((fileName) => {
      const stats = statSync(path.join(backupRoot, fileName));
      return {
        fileName,
        path: path.join(backupRoot, fileName),
        sizeBytes: stats.size,
        createdAt: stats.birthtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}

export async function createDatabaseBackupForPlatform(req: Request) {
  const backupRoot = getBackupRoot();
  mkdirSync(backupRoot, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `parkia-${timestamp}.sqlite`;
  const backupPath = path.join(backupRoot, filename);
  await backupDatabaseFileInDb(backupPath);
  const stats = statSync(backupPath);

  await recordAuditEvent(req, {
    action: "database.backup_created",
    entityType: "database_backup",
    entityId: filename,
    metadata: {
      path: backupPath,
      sizeBytes: stats.size,
    },
  });

  return {
    fileName: filename,
    path: backupPath,
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
  };
}

export async function restoreDatabaseBackupForPlatform(req: Request, fileName: string, confirm: string) {
  const backupPath = getBackupPath(fileName);
  if (!backupPath.endsWith(".sqlite")) {
    return { ok: false as const, status: 400, error: "Solo se pueden restaurar respaldos SQLite generados por el sistema" };
  }
  if (confirm !== fileName) {
    return { ok: false as const, status: 400, error: "Confirmacion invalida para restaurar respaldo" };
  }

  statSync(backupPath);
  const source = new Database(backupPath, { readonly: true, fileMustExist: true });
  const integrity = source.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (integrity.integrity_check !== "ok") {
    source.close();
    return { ok: false as const, status: 400, error: "El respaldo no paso la verificacion de integridad" };
  }

  const backupRoot = getBackupRoot();
  mkdirSync(backupRoot, { recursive: true });
  const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyFileName = `parkia-pre-restore-${safetyTimestamp}.sqlite`;
  const safetyPath = path.join(backupRoot, safetyFileName);
  await backupDatabaseFileInDb(safetyPath);

  const databasePath = getDatabasePath();
  await source.backup(databasePath);
  source.close();
  const stats = statSync(backupPath);
  const safetyStats = statSync(safetyPath);

  await recordAuditEvent(req, {
    action: "database.backup_restored",
    entityType: "database_backup",
    entityId: fileName,
    metadata: {
      restored_from: backupPath,
      restored_size_bytes: stats.size,
      safety_backup: safetyPath,
      safety_size_bytes: safetyStats.size,
      restart_recommended: true,
    },
  });

  return {
    ok: true as const,
    restored: {
      fileName,
      path: backupPath,
      sizeBytes: stats.size,
    },
    safetyBackup: {
      fileName: safetyFileName,
      path: safetyPath,
      sizeBytes: safetyStats.size,
      createdAt: safetyStats.birthtime.toISOString(),
    },
    restartRecommended: true,
  };
}
