import type Database from "better-sqlite3";
import type { Db } from "../../db/engine/types";

/**
 * Tablas del modulo DTE (docs/PARKIA_PLAN_V2.md, seccion 3.3), version SQLite.
 *
 * Registrada en server/db/schema.ts como migracion "050_dte_module". Cuando la base pase a
 * PostgreSQL esta definicion se porta a Drizzle junto con el resto de los modulos.
 * Es idempotente. Todos los secretos (pfx, clave, CAF) se guardan cifrados con server/platform/secrets.ts.
 */
export const DTE_MIGRATION_ID = "dte_module_v1";

export function applyDteMigration(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dte_settings (
      tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id),
      environment TEXT NOT NULL DEFAULT 'certificacion' CHECK(environment IN ('certificacion', 'produccion')),
      status TEXT NOT NULL DEFAULT 'unconfigured' CHECK(status IN ('unconfigured', 'testing', 'certified', 'production')),
      rut_emisor TEXT,
      razon_social TEXT,
      giro TEXT,
      acteco_json TEXT,
      direccion TEXT,
      comuna TEXT,
      ciudad TEXT,
      codigo_sucursal_sii INTEGER,
      resolucion_numero INTEGER,
      resolucion_fecha TEXT,
      rut_envia TEXT,
      -- Unidad del SII que figura en la boleta impresa ("S.I.I. - SANTIAGO CENTRO").
      sii_unidad TEXT,
      auto_emit_boleta INTEGER NOT NULL DEFAULT 1,
      -- Desde cuando se emiten boletas reales: los tickets cobrados antes no se emiten.
      live_since DATETIME,
      connection_ok INTEGER,
      connection_checked_at DATETIME,
      connection_message TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dte_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      pfx_encrypted TEXT NOT NULL,
      password_encrypted TEXT NOT NULL,
      subject_rut TEXT,
      subject_name TEXT,
      issuer TEXT,
      serial_number TEXT,
      fingerprint TEXT NOT NULL,
      valid_from DATETIME NOT NULL,
      valid_to DATETIME NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      uploaded_by_staff_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS idx_dte_certificates_tenant_active ON dte_certificates(tenant_id, active);

    CREATE TABLE IF NOT EXISTS dte_cafs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      environment TEXT NOT NULL CHECK(environment IN ('certificacion', 'produccion')),
      dte_type INTEGER NOT NULL,
      folio_from INTEGER NOT NULL,
      folio_to INTEGER NOT NULL,
      next_folio INTEGER NOT NULL,
      caf_xml_encrypted TEXT NOT NULL,
      authorized_at TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'exhausted', 'expired', 'voided')),
      uploaded_by_staff_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, environment, dte_type, folio_from)
    );
    CREATE INDEX IF NOT EXISTS idx_dte_cafs_lookup ON dte_cafs(tenant_id, environment, dte_type, status);

    CREATE TABLE IF NOT EXISTS dte_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      branch_id INTEGER,
      environment TEXT NOT NULL CHECK(environment IN ('certificacion', 'produccion')),
      dte_type INTEGER NOT NULL,
      folio INTEGER NOT NULL,
      caf_id INTEGER REFERENCES dte_cafs(id),
      issued_at TEXT NOT NULL,
      -- Receptor opcional: la boleta de estacionamiento se emite sin cliente.
      client_id INTEGER,
      receptor_rut TEXT,
      receptor_razon TEXT,
      receptor_giro TEXT,
      receptor_direccion TEXT,
      receptor_comuna TEXT,
      neto INTEGER NOT NULL DEFAULT 0,
      exento INTEGER NOT NULL DEFAULT 0,
      iva INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      references_json TEXT,
      dte_xml TEXT,
      ted_xml TEXT,
      pdf_key TEXT,
      source_type TEXT CHECK(source_type IN ('ticket', 'payment', 'manual', 'subscription', 'credit_note')),
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'signed', 'queued', 'sent', 'accepted', 'accepted_with_objections', 'rejected', 'voided')),
      status_detail TEXT,
      envio_id INTEGER,
      track_id TEXT,
      created_by_staff_id INTEGER,
      send_attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, environment, dte_type, folio)
    );
    -- Un mismo origen (ticket, cuota) genera un solo documento de cada tipo.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dte_documents_source ON dte_documents(tenant_id, environment, source_type, source_id, dte_type)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_dte_documents_status ON dte_documents(tenant_id, status, created_at);

    CREATE TABLE IF NOT EXISTS dte_envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      environment TEXT NOT NULL CHECK(environment IN ('certificacion', 'produccion')),
      kind TEXT NOT NULL CHECK(kind IN ('EnvioDTE', 'EnvioBOLETA')),
      xml_signed TEXT NOT NULL,
      document_count INTEGER NOT NULL,
      track_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploaded', 'accepted', 'accepted_with_objections', 'rejected', 'failed')),
      sii_status_code TEXT,
      sii_response_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dte_envios_pending ON dte_envios(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS dte_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      document_id INTEGER REFERENCES dte_documents(id),
      envio_id INTEGER REFERENCES dte_envios(id),
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      payload_json TEXT,
      staff_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_dte_events_document ON dte_events(tenant_id, document_id, created_at);
  `);
}

/**
 * Toma el siguiente folio de forma atomica. Llamar dentro de una transaccion (db.transaction):
 * better-sqlite3 serializa las escrituras, asi que dos cobros simultaneos nunca reciben el mismo folio.
 * En PostgreSQL esto sera SELECT ... FOR UPDATE.
 */
export async function takeNextFolio(db: Db, input: { tenantId: number; environment: string; dteType: number }) {
  const caf = await db.prepare(`
    SELECT id, next_folio, folio_to
    FROM dte_cafs
    WHERE tenant_id = ? AND environment = ? AND dte_type = ? AND status = 'active'
      AND (expires_at IS NULL OR expires_at >= date('now'))
    ORDER BY folio_from ASC
    LIMIT 1
  `).get(input.tenantId, input.environment, input.dteType) as { id: number; next_folio: number; folio_to: number } | undefined;
  if (!caf) throw new Error(`No hay folios disponibles para documentos tipo ${input.dteType}: cargue un CAF`);

  const folio = caf.next_folio;
  const exhausted = folio >= caf.folio_to;
  const result = await db.prepare("UPDATE dte_cafs SET next_folio = ?, status = ? WHERE id = ? AND next_folio = ?")
    .run(folio + 1, exhausted ? "exhausted" : "active", caf.id, folio);
  if (result.changes !== 1) throw new Error("Conflicto al asignar folio: reintentar");
  return { cafId: caf.id, folio, remaining: caf.folio_to - folio };
}
