import { db } from "./db";

export type TenantSettings = {
  tenant_id: number;
  grace_days: number;
  late_interest: number;
  overdue_recovery_rate: number;
  company_name: string | null;
  company_rut: string | null;
  company_address: string | null;
  sii_api_key: string | null;
  bank_api_key: string | null;
  sii_provider: string;
  sii_mode: string;
  sii_environment: string;
  created_at: string | null;
  updated_at: string | null;
};

export const TENANT_SETTINGS_FIELDS = [
  "grace_days",
  "late_interest",
  "overdue_recovery_rate",
  "company_name",
  "company_rut",
  "company_address",
  "sii_api_key",
  "bank_api_key",
  "sii_provider",
  "sii_mode",
  "sii_environment",
] as const;

export type TenantSettingsField = typeof TENANT_SETTINGS_FIELDS[number];

function readTenantSettings(tenantId: number) {
  return db.prepare("SELECT * FROM tenant_settings WHERE tenant_id = ?").get(tenantId) as TenantSettings | undefined;
}

/**
 * Configuracion de un tenant. Si el tenant aun no tiene fila (empresa nueva),
 * se crea on-demand con los defaults de la tabla y su propia razon social/RUT.
 */
export function getTenantSettings(tenantId: number): TenantSettings {
  const existing = readTenantSettings(tenantId);
  if (existing) return existing;

  db.prepare(`
    INSERT OR IGNORE INTO tenant_settings (tenant_id, company_name, company_rut)
    SELECT id, name, rut FROM tenants WHERE id = ?
  `).run(tenantId);

  const created = readTenantSettings(tenantId);
  if (!created) throw new Error("Tenant no encontrado para leer su configuracion");
  return created;
}

export function updateTenantSettings(tenantId: number, changes: Partial<Record<TenantSettingsField, unknown>>) {
  const fields = TENANT_SETTINGS_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(changes, field));
  getTenantSettings(tenantId);
  if (fields.length === 0) return [];

  const sets = fields.map(field => `${field} = ?`).join(", ");
  const values = fields.map(field => changes[field] ?? null);
  db.prepare(`UPDATE tenant_settings SET ${sets}, updated_at = datetime('now') WHERE tenant_id = ?`).run(...values, tenantId);
  return fields;
}
