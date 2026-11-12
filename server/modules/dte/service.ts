import type Database from "better-sqlite3";
import { decryptSecret, decryptSecretString, encryptSecret } from "../../platform/secrets";
import { localDate } from "../../platform/timezone";
import { takeNextFolio } from "./migration";
import { SiiDteProvider } from "./providers/sii";
import { buildDte, DteValidationError, documentId } from "./providers/sii/builder";
import { parseCaf, readCafFile, cafRemaining } from "./providers/sii/caf";
import { loadPfx, type LoadedCertificate } from "./providers/sii/cert";
import { getSiiEndpoints } from "./providers/sii/endpoints";
import type { SiiHttpOptions } from "./providers/sii/http";
import { getSiiToken } from "./providers/sii/auth";
import { isValidRut, normalizeRut } from "./providers/sii/rut";
import { isBoleta, type DteItem, type DteReceptor, type DteReferencia, type DteType, type SignedDte, type SiiEnvironment } from "./types";

/**
 * Servicio del modulo DTE: configuracion por empresa, certificado, CAF, emision con folio,
 * envio al SII y consulta de estado. No conoce Express: recibe la base de datos por parametro
 * para poder probarlo con una base en memoria y una red simulada.
 *
 * Reglas de oro:
 *  - Todo es por empresa (tenant): nada se comparte entre clientes.
 *  - Los secretos (certificado, clave, CAF) viven cifrados y nunca salen en una respuesta.
 *  - Produccion solo se toca si el servidor lo habilita (PARKIA_SII_ALLOW_PRODUCTION=true)
 *    y la empresa completo el paso a produccion.
 */

export type DteSettingsRow = {
  tenant_id: number;
  environment: SiiEnvironment;
  status: "unconfigured" | "testing" | "certified" | "production";
  rut_emisor: string | null;
  razon_social: string | null;
  giro: string | null;
  acteco_json: string | null;
  direccion: string | null;
  comuna: string | null;
  ciudad: string | null;
  codigo_sucursal_sii: number | null;
  resolucion_numero: number | null;
  resolucion_fecha: string | null;
  rut_envia: string | null;
  sii_unidad: string | null;
  auto_emit_boleta: number;
  live_since: string | null;
  connection_ok: number | null;
  connection_checked_at: string | null;
  connection_message: string | null;
};

export type DteDocumentRow = {
  id: number;
  tenant_id: number;
  branch_id: number | null;
  environment: SiiEnvironment;
  dte_type: DteType;
  folio: number;
  issued_at: string;
  client_id: number | null;
  receptor_rut: string | null;
  receptor_razon: string | null;
  receptor_giro: string | null;
  receptor_direccion: string | null;
  receptor_comuna: string | null;
  neto: number;
  exento: number;
  iva: number;
  total: number;
  items_json: string;
  references_json: string | null;
  dte_xml: string | null;
  ted_xml: string | null;
  source_type: string | null;
  source_id: string | null;
  status: string;
  status_detail: string | null;
  envio_id: number | null;
  track_id: string | null;
  send_attempts: number;
  next_attempt_at: string | null;
  created_at: string;
};

export type IssueInput = {
  dteType: DteType;
  items: DteItem[];
  receptor?: DteReceptor | null;
  referencias?: DteReferencia[];
  formaPago?: 1 | 2 | 3;
  source?: { type: "ticket" | "payment" | "manual" | "subscription" | "credit_note"; id: string };
  branchId?: number | null;
  clientId?: number | null;
  staffId?: number | null;
};

export class DteServiceError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message);
    this.name = "DteServiceError";
  }
}

export type DteServiceDeps = {
  db: Database.Database;
  /** Inyeccion de red para pruebas. */
  http?: SiiHttpOptions;
  now?: () => Date;
  /** Por defecto lee PARKIA_SII_ALLOW_PRODUCTION. */
  allowProduction?: () => boolean;
};

const BATCH_SIZE = 100;
const POLL_MIN_SECONDS = 60;
const POLL_MAX_SECONDS = 1800;
const SEND_RETRY_MAX_SECONDS = 3600;
const ACCEPTED_STATES = ["accepted", "accepted_with_objections"];

/** Casos de ejemplo para probar el flujo. El set oficial lo entrega el SII por empresa. */
export const SAMPLE_CERTIFICATION_CASES = [
  { id: "1", items: [{ nombre: "Estacionamiento por hora", cantidad: 2, precio: 2400 }] },
  { id: "2", items: [{ nombre: "Estacionamiento medio dia", cantidad: 1, precio: 6000 }, { nombre: "Lavado de vehiculo", cantidad: 1, precio: 8000 }] },
  { id: "3", items: [{ nombre: "Estacionamiento nocturno", cantidad: 1, precio: 5000 }] },
  { id: "4", items: [{ nombre: "Estacionamiento diario", cantidad: 3, precio: 9000 }] },
  { id: "5", items: [{ nombre: "Pase mensual visita", cantidad: 1, precio: 35000 }] },
];

function sqlTime(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function createDteService(deps: DteServiceDeps) {
  const { db } = deps;
  const now = deps.now || (() => new Date());
  const productionAllowed = deps.allowProduction || (() => process.env.PARKIA_SII_ALLOW_PRODUCTION === "true");

  // ---------------------------------------------------------------- eventos y configuracion

  function recordEvent(tenantId: number, event: { documentId?: number | null; envioId?: number | null; type: string; status?: string | null; message?: string | null; payload?: unknown; staffId?: number | null }) {
    db.prepare(`
      INSERT INTO dte_events (tenant_id, document_id, envio_id, event_type, status, message, payload_json, staff_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, event.documentId ?? null, event.envioId ?? null, event.type, event.status ?? null, event.message ?? null,
      event.payload === undefined ? null : JSON.stringify(event.payload), event.staffId ?? null);
  }

  function getSettings(tenantId: number): DteSettingsRow {
    const row = db.prepare("SELECT * FROM dte_settings WHERE tenant_id = ?").get(tenantId) as DteSettingsRow | undefined;
    return row || {
      tenant_id: tenantId, environment: "certificacion", status: "unconfigured", rut_emisor: null, razon_social: null, giro: null,
      acteco_json: null, direccion: null, comuna: null, ciudad: null, codigo_sucursal_sii: null, resolucion_numero: null,
      resolucion_fecha: null, rut_envia: null, sii_unidad: null, auto_emit_boleta: 1, live_since: null, connection_ok: null,
      connection_checked_at: null, connection_message: null,
    };
  }

  function isEmisorComplete(settings: DteSettingsRow) {
    return Boolean(settings.rut_emisor && settings.razon_social && settings.giro && settings.direccion && settings.comuna && settings.sii_unidad && settings.acteco_json);
  }

  function saveSettings(tenantId: number, values: {
    rut_emisor: string; razon_social: string; giro: string; acteco?: number[]; direccion: string; comuna: string;
    ciudad?: string | null; sii_unidad: string; codigo_sucursal_sii?: number | null; rut_envia?: string | null; auto_emit_boleta?: boolean;
  }, staffId?: number | null) {
    if (!isValidRut(values.rut_emisor)) throw new DteServiceError("El RUT del emisor no es valido", "INVALID_RUT");
    if (values.rut_envia && !isValidRut(values.rut_envia)) throw new DteServiceError("El RUT de quien envia no es valido", "INVALID_RUT");
    if (!values.acteco?.length) throw new DteServiceError("Ingresa al menos un codigo de actividad economica", "NO_ACTECO");
    const current = getSettings(tenantId);
    // Cambiar el RUT emisor invalida los CAF, que pertenecen a un RUT.
    if (current.rut_emisor && normalizeRut(current.rut_emisor) !== normalizeRut(values.rut_emisor)) {
      const cafs = db.prepare("SELECT COUNT(*) AS n FROM dte_cafs WHERE tenant_id = ?").get(tenantId) as { n: number };
      if (cafs.n > 0) throw new DteServiceError("No se puede cambiar el RUT del emisor mientras existan folios (CAF) cargados", "RUT_LOCKED");
    }
    db.prepare(`
      INSERT INTO dte_settings (tenant_id, status, rut_emisor, razon_social, giro, acteco_json, direccion, comuna, ciudad,
        sii_unidad, codigo_sucursal_sii, rut_envia, auto_emit_boleta, updated_at)
      VALUES (?, 'testing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(tenant_id) DO UPDATE SET
        status = CASE WHEN dte_settings.status = 'unconfigured' THEN 'testing' ELSE dte_settings.status END,
        rut_emisor = excluded.rut_emisor, razon_social = excluded.razon_social, giro = excluded.giro,
        acteco_json = excluded.acteco_json, direccion = excluded.direccion, comuna = excluded.comuna, ciudad = excluded.ciudad,
        sii_unidad = excluded.sii_unidad, codigo_sucursal_sii = excluded.codigo_sucursal_sii, rut_envia = excluded.rut_envia,
        auto_emit_boleta = excluded.auto_emit_boleta, updated_at = CURRENT_TIMESTAMP
    `).run(tenantId, normalizeRut(values.rut_emisor), values.razon_social, values.giro, JSON.stringify(values.acteco), values.direccion,
      values.comuna, values.ciudad || null, values.sii_unidad, values.codigo_sucursal_sii ?? null,
      values.rut_envia ? normalizeRut(values.rut_envia) : null, values.auto_emit_boleta === false ? 0 : 1);
    recordEvent(tenantId, { type: "settings_saved", staffId });
    return getSettings(tenantId);
  }

  // ---------------------------------------------------------------- certificado

  type CertificateRow = { id: number; pfx_encrypted: string; password_encrypted: string; subject_rut: string | null; subject_name: string | null; issuer: string | null; fingerprint: string; valid_from: string; valid_to: string };

  function activeCertificateRow(tenantId: number) {
    return db.prepare("SELECT * FROM dte_certificates WHERE tenant_id = ? AND active = 1 ORDER BY id DESC LIMIT 1").get(tenantId) as CertificateRow | undefined;
  }

  function certificateSummary(row: CertificateRow | undefined) {
    if (!row) return null;
    const daysLeft = Math.floor((new Date(row.valid_to).getTime() - now().getTime()) / 86_400_000);
    return {
      subjectName: row.subject_name, subjectRut: row.subject_rut, issuer: row.issuer,
      validFrom: row.valid_from, validTo: row.valid_to, daysLeft, expired: daysLeft < 0,
      fingerprint: row.fingerprint.slice(0, 16),
    };
  }

  /** Descifra y carga el certificado activo. El resultado vive solo en memoria. */
  function loadActiveCertificate(tenantId: number): LoadedCertificate {
    const row = activeCertificateRow(tenantId);
    if (!row) throw new DteServiceError("La empresa aun no ha cargado su certificado digital", "NO_CERTIFICATE");
    const pfx = decryptSecret(row.pfx_encrypted, { tenantId, purpose: "dte.certificate.pfx" });
    const password = decryptSecretString(row.password_encrypted, { tenantId, purpose: "dte.certificate.password" });
    return loadPfx(pfx, password, { now: now() });
  }

  function uploadCertificate(tenantId: number, input: { pfxBase64: string; password: string }, staffId?: number | null) {
    const pfx = Buffer.from(input.pfxBase64, "base64");
    if (!pfx.length) throw new DteServiceError("El archivo del certificado esta vacio", "INVALID_FILE");
    const cert = loadPfx(pfx, input.password, { now: now() });
    const settings = getSettings(tenantId);
    const warnings: string[] = [];
    if (!cert.subjectRut && !settings.rut_envia) {
      warnings.push("No se pudo leer el RUT del titular del certificado: ingresalo en 'RUT de quien envia' en los datos del emisor.");
    }

    db.transaction(() => {
      db.prepare("UPDATE dte_certificates SET active = 0 WHERE tenant_id = ?").run(tenantId);
      db.prepare("DELETE FROM dte_certificates WHERE tenant_id = ? AND fingerprint = ?").run(tenantId, cert.fingerprintSha256);
      db.prepare(`
        INSERT INTO dte_certificates (tenant_id, pfx_encrypted, password_encrypted, subject_rut, subject_name, issuer, serial_number,
          fingerprint, valid_from, valid_to, active, uploaded_by_staff_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        tenantId,
        encryptSecret(pfx, { tenantId, purpose: "dte.certificate.pfx" }),
        encryptSecret(input.password, { tenantId, purpose: "dte.certificate.password" }),
        cert.subjectRut, cert.subjectName, cert.issuerName, cert.serialNumber, cert.fingerprintSha256,
        cert.validFrom.toISOString(), cert.validTo.toISOString(), staffId ?? null,
      );
      // La conexion probada con el certificado anterior ya no vale.
      db.prepare("UPDATE dte_settings SET connection_ok = NULL, connection_message = NULL WHERE tenant_id = ?").run(tenantId);
      recordEvent(tenantId, { type: "certificate_uploaded", message: cert.subjectName, staffId });
    })();
    return { certificate: certificateSummary(activeCertificateRow(tenantId)), warnings };
  }

  function removeCertificate(tenantId: number, staffId?: number | null) {
    db.prepare("DELETE FROM dte_certificates WHERE tenant_id = ?").run(tenantId);
    db.prepare("UPDATE dte_settings SET connection_ok = NULL, connection_message = NULL WHERE tenant_id = ?").run(tenantId);
    recordEvent(tenantId, { type: "certificate_removed", staffId });
  }

  // ---------------------------------------------------------------- CAF

  function uploadCaf(tenantId: number, input: { content: string }, staffId?: number | null) {
    const settings = getSettings(tenantId);
    if (!settings.rut_emisor) throw new DteServiceError("Primero completa los datos del emisor: el CAF debe corresponder a su RUT", "NO_EMISOR");
    const caf = parseCaf(input.content, { rutEmisor: settings.rut_emisor });

    const overlap = db.prepare(`
      SELECT folio_from, folio_to FROM dte_cafs
      WHERE tenant_id = ? AND environment = ? AND dte_type = ? AND status != 'voided' AND folio_from <= ? AND folio_to >= ?
    `).get(tenantId, caf.environment, caf.type, caf.folioTo, caf.folioFrom) as { folio_from: number; folio_to: number } | undefined;
    if (overlap) throw new DteServiceError(`Este CAF se traslapa con el rango ${overlap.folio_from}-${overlap.folio_to} ya cargado`, "CAF_OVERLAP");

    db.prepare(`
      INSERT INTO dte_cafs (tenant_id, environment, dte_type, folio_from, folio_to, next_folio, caf_xml_encrypted, authorized_at, expires_at, uploaded_by_staff_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, caf.environment, caf.type, caf.folioFrom, caf.folioTo, caf.folioFrom,
      encryptSecret(readCafFile(input.content), { tenantId, purpose: "dte.caf" }), caf.authorizedAt, caf.expiresAt, staffId ?? null);
    recordEvent(tenantId, { type: "caf_uploaded", message: `Tipo ${caf.type}: ${caf.folioFrom}-${caf.folioTo} (${caf.environment})`, staffId });
    return { type: caf.type, environment: caf.environment, folioFrom: caf.folioFrom, folioTo: caf.folioTo, authorizedAt: caf.authorizedAt, expiresAt: caf.expiresAt };
  }

  function listCafs(tenantId: number) {
    const rows = db.prepare(`
      SELECT id, environment, dte_type, folio_from, folio_to, next_folio, authorized_at, expires_at, status
      FROM dte_cafs WHERE tenant_id = ? ORDER BY environment, dte_type, folio_from
    `).all(tenantId) as Array<{ id: number; environment: SiiEnvironment; dte_type: number; folio_from: number; folio_to: number; next_folio: number; authorized_at: string; expires_at: string | null; status: string }>;
    return rows.map(row => ({ ...row, remaining: Math.max(row.folio_to - row.next_folio + 1, 0) }));
  }

  // ---------------------------------------------------------------- emision

  function buildEmisor(settings: DteSettingsRow) {
    return {
      rut: normalizeRut(settings.rut_emisor as string),
      razonSocial: settings.razon_social as string,
      giro: settings.giro as string,
      acteco: settings.acteco_json ? (JSON.parse(settings.acteco_json) as number[]) : undefined,
      direccion: settings.direccion as string,
      comuna: settings.comuna as string,
      ciudad: settings.ciudad || undefined,
      codigoSucursalSii: settings.codigo_sucursal_sii || undefined,
    };
  }

  function findBySource(tenantId: number, environment: string, source: { type: string; id: string }, dteType: number) {
    return db.prepare(`
      SELECT * FROM dte_documents WHERE tenant_id = ? AND environment = ? AND source_type = ? AND source_id = ? AND dte_type = ?
    `).get(tenantId, environment, source.type, source.id, dteType) as DteDocumentRow | undefined;
  }

  function branchTimezone(tenantId: number, branchId?: number | null) {
    if (!branchId) return null;
    const row = db.prepare("SELECT timezone FROM branches WHERE id = ? AND tenant_id = ?").get(branchId, tenantId) as { timezone?: string } | undefined;
    return row?.timezone || null;
  }

  /**
   * Toma un folio, arma y timbra el documento y lo deja en cola para enviarse al SII.
   * Es atomico: si algo falla despues de tomar el folio, el folio vuelve a quedar libre.
   * Si se indica un origen (ticket, cuota), el mismo origen nunca genera dos documentos.
   */
  function issueDocument(tenantId: number, input: IssueInput): { document: DteDocumentRow; created: boolean } {
    const settings = getSettings(tenantId);
    if (!isEmisorComplete(settings)) throw new DteServiceError("Faltan los datos del emisor: completa el paso 1 del asistente", "NO_EMISOR");
    const environment = settings.environment;
    if (environment === "produccion" && !productionAllowed()) {
      throw new DteServiceError("La emision en produccion no esta habilitada en este servidor", "PRODUCTION_BLOCKED", 403);
    }

    if (input.source) {
      const existing = findBySource(tenantId, environment, input.source, input.dteType);
      if (existing) return { document: existing, created: false };
    }

    try {
      const document = db.transaction(() => {
        const taken = takeNextFolio(db, { tenantId, environment, dteType: input.dteType });
        const cafRow = db.prepare("SELECT caf_xml_encrypted FROM dte_cafs WHERE id = ?").get(taken.cafId) as { caf_xml_encrypted: string };
        const cafXml = decryptSecretString(cafRow.caf_xml_encrypted, { tenantId, purpose: "dte.caf" });
        const caf = parseCaf(cafXml, { rutEmisor: settings.rut_emisor as string, type: input.dteType });

        const issuedAt = localDate(branchTimezone(tenantId, input.branchId), now());
        const signed = buildDte({
          type: input.dteType, folio: taken.folio, fechaEmision: issuedAt, emisor: buildEmisor(settings),
          receptor: input.receptor || null, items: input.items, referencias: input.referencias, formaPago: input.formaPago,
        }, caf, { now: now() });

        const result = db.prepare(`
          INSERT INTO dte_documents (tenant_id, branch_id, environment, dte_type, folio, caf_id, issued_at, client_id,
            receptor_rut, receptor_razon, receptor_giro, receptor_direccion, receptor_comuna, neto, exento, iva, total,
            items_json, references_json, dte_xml, ted_xml, source_type, source_id, status, created_by_staff_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
        `).run(
          tenantId, input.branchId ?? null, environment, input.dteType, taken.folio, taken.cafId, issuedAt, input.clientId ?? null,
          input.receptor?.rut ?? null, input.receptor?.razonSocial ?? null, input.receptor?.giro ?? null,
          input.receptor?.direccion ?? null, input.receptor?.comuna ?? null,
          signed.totals.neto, signed.totals.exento, signed.totals.iva, signed.totals.total,
          JSON.stringify(input.items), input.referencias ? JSON.stringify(input.referencias) : null,
          signed.dteXml, signed.tedXml, input.source?.type ?? null, input.source?.id ?? null, input.staffId ?? null,
        );
        const id = Number(result.lastInsertRowid);
        recordEvent(tenantId, { documentId: id, type: "issued", status: "queued", message: `Tipo ${input.dteType} folio ${taken.folio}`, staffId: input.staffId });
        return db.prepare("SELECT * FROM dte_documents WHERE id = ?").get(id) as DteDocumentRow;
      })();
      return { document, created: true };
    } catch (error) {
      // Dos cobros simultaneos del mismo origen: gana el primero y el segundo devuelve ese documento.
      if (input.source && error instanceof Error && /UNIQUE/.test(error.message)) {
        const existing = findBySource(tenantId, environment, input.source, input.dteType);
        if (existing) return { document: existing, created: false };
      }
      if (error instanceof DteValidationError) {
        throw new DteServiceError(`El documento no cumple las reglas del SII: ${error.message}`, "VALIDATION");
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- boleta automatica de estacionamiento

  /**
   * Boleta de un ticket cobrado. Va sin cliente: el estacionamiento vende a consumidor final.
   * Nunca hace fallar el cobro: si no se puede emitir, queda registrado y se reintenta en el envio.
   */
  function issueBoletaForTicket(tenantId: number, ticket: { ticketId: number | string; plate?: string | null; amount: number; durationMins?: number | null; branchId?: number | null; staffId?: number | null }) {
    const settings = getSettings(tenantId);
    if (settings.status !== "production" || settings.environment !== "produccion") return { skipped: "La empresa aun no esta en produccion" } as const;
    if (!settings.auto_emit_boleta) return { skipped: "La emision automatica esta desactivada" } as const;
    const amount = Math.round(Number(ticket.amount || 0));
    if (amount <= 0) return { skipped: "Cobro sin monto: no se emite boleta" } as const;

    try {
      const description = [ticket.plate ? `Patente ${ticket.plate}` : null, ticket.durationMins ? `${Math.round(Number(ticket.durationMins))} min` : null].filter(Boolean).join(" - ");
      const { document, created } = issueDocument(tenantId, {
        dteType: 39,
        items: [{ nombre: "Servicio de estacionamiento", descripcion: description || undefined, monto: amount }],
        source: { type: "ticket", id: String(ticket.ticketId) },
        branchId: ticket.branchId, staffId: ticket.staffId,
      });
      return { document, created } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordEvent(tenantId, { type: "issue_failed", status: "error", message, payload: { ticketId: ticket.ticketId } });
      return { error: message } as const;
    }
  }

  /** Emite las boletas de tickets cobrados que se quedaron sin documento (por ejemplo, sin folios en ese momento). */
  function reconcileTicketBoletas(tenantId: number, limit = 200) {
    const settings = getSettings(tenantId);
    if (settings.status !== "production" || !settings.live_since || !settings.auto_emit_boleta) return 0;
    const rows = db.prepare(`
      SELECT t.id, t.plate, t.amount, t.branch_id,
             CAST((julianday(t.paid_at) - julianday(t.entry_time)) * 1440 AS INTEGER) AS mins
      FROM visitor_tickets t
      WHERE t.tenant_id = ? AND t.status IN ('paid', 'completed') AND t.amount > 0 AND t.paid_at IS NOT NULL AND t.paid_at >= ?
        AND NOT EXISTS (
          SELECT 1 FROM dte_documents d
          WHERE d.tenant_id = t.tenant_id AND d.environment = ? AND d.source_type = 'ticket' AND d.source_id = CAST(t.id AS TEXT) AND d.dte_type = 39
        )
      ORDER BY t.id LIMIT ?
    `).all(tenantId, settings.live_since, settings.environment, limit) as Array<{ id: number; plate: string | null; amount: number; branch_id: number | null; mins: number | null }>;
    let issued = 0;
    for (const row of rows) {
      const result = issueBoletaForTicket(tenantId, { ticketId: row.id, plate: row.plate, amount: row.amount, durationMins: row.mins, branchId: row.branch_id });
      if ("document" in result && result.created) issued += 1;
      // Sin folios no tiene sentido seguir insistiendo con el resto.
      if ("error" in result) break;
    }
    return issued;
  }

  /** Reconcilia las boletas de todas las empresas que ya estan en produccion. */
  function reconcileAllTenants() {
    const tenants = db.prepare("SELECT tenant_id FROM dte_settings WHERE status = 'production'").all() as Array<{ tenant_id: number }>;
    return tenants.map(({ tenant_id }) => ({ tenantId: tenant_id, issued: reconcileTicketBoletas(tenant_id) }));
  }

  // ---------------------------------------------------------------- envio y estados

  function buildProvider(tenantId: number, settings: DteSettingsRow, certificate: LoadedCertificate) {
    if (!settings.resolucion_fecha) throw new DteServiceError("Falta la fecha de resolucion del SII en los datos del emisor", "NO_RESOLUTION");
    return new SiiDteProvider({
      environment: settings.environment,
      allowProduction: settings.environment === "produccion" && productionAllowed(),
      rutEmisor: normalizeRut(settings.rut_emisor as string),
      rutEnvia: settings.rut_envia || undefined,
      fechaResolucion: settings.resolucion_fecha,
      numeroResolucion: Number(settings.resolucion_numero ?? 0),
      certificate,
      resolveCaf: () => { throw new Error("El envio no emite documentos nuevos"); },
      http: deps.http,
    });
  }

  function rowToSigned(row: DteDocumentRow): SignedDte {
    return {
      type: row.dte_type, folio: row.folio, documentId: documentId(row.dte_type, row.folio),
      dteXml: row.dte_xml as string, tedXml: row.ted_xml as string, tedBarcode: row.ted_xml as string,
      totals: { neto: row.neto, exento: row.exento, iva: row.iva, total: row.total, tasaIva: 19 },
      timestampFirma: row.created_at,
    };
  }

  function backoffSeconds(attempts: number, cap: number) {
    return Math.min(60 * 2 ** Math.max(attempts - 1, 0), cap);
  }

  function failSend(tenantId: number, rows: DteDocumentRow[], error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const update = db.prepare("UPDATE dte_documents SET send_attempts = send_attempts + 1, next_attempt_at = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    for (const row of rows) {
      const wait = backoffSeconds(row.send_attempts + 1, SEND_RETRY_MAX_SECONDS);
      update.run(sqlTime(new Date(now().getTime() + wait * 1000)), message.slice(0, 300), row.id);
      recordEvent(tenantId, { documentId: row.id, type: "send_failed", status: "queued", message });
    }
  }

  /** Envia al SII los documentos en cola de una empresa (o de todas). Nunca lanza: devuelve un resumen. */
  async function sendPending(options: { tenantId?: number } = {}) {
    const summary: Array<{ tenantId: number; environment: string; sent: number; failed: number; error?: string }> = [];
    const groups = db.prepare(`
      SELECT DISTINCT tenant_id, environment FROM dte_documents
      WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ${options.tenantId ? "AND tenant_id = ?" : ""}
    `).all(...(options.tenantId ? [sqlTime(now()), options.tenantId] : [sqlTime(now())])) as Array<{ tenant_id: number; environment: SiiEnvironment }>;

    for (const group of groups) {
      const tenantId = group.tenant_id;
      const entry = { tenantId, environment: group.environment, sent: 0, failed: 0 } as (typeof summary)[number];
      summary.push(entry);
      const queued = db.prepare(`
        SELECT * FROM dte_documents WHERE tenant_id = ? AND environment = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY folio ASC LIMIT 1000
      `).all(tenantId, group.environment, sqlTime(now())) as DteDocumentRow[];
      try {
        const settings = getSettings(tenantId);
        if (settings.environment !== group.environment) throw new DteServiceError("Los documentos en cola son de otro ambiente", "ENV_MISMATCH");
        const provider = buildProvider(tenantId, settings, loadActiveCertificate(tenantId));
        for (const kind of ["boleta", "dte"] as const) {
          const rows = queued.filter(row => isBoleta(row.dte_type) === (kind === "boleta"));
          for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
            const chunk = rows.slice(offset, offset + BATCH_SIZE);
            try {
              const result = await provider.sendBatch(chunk.map(rowToSigned));
              db.transaction(() => {
                const envio = db.prepare(`
                  INSERT INTO dte_envios (tenant_id, environment, kind, xml_signed, document_count, track_id, status, attempts, next_attempt_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 0, ?)
                `).run(tenantId, group.environment, kind === "boleta" ? "EnvioBOLETA" : "EnvioDTE", result.envioXml, chunk.length, result.trackId,
                  sqlTime(new Date(now().getTime() + POLL_MIN_SECONDS * 1000)));
                const envioId = Number(envio.lastInsertRowid);
                const mark = db.prepare("UPDATE dte_documents SET status = 'sent', envio_id = ?, track_id = ?, status_detail = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
                for (const row of chunk) {
                  mark.run(envioId, result.trackId, row.id);
                  recordEvent(tenantId, { documentId: row.id, envioId, type: "sent", status: "sent", message: `Track ${result.trackId}` });
                }
              })();
              entry.sent += chunk.length;
            } catch (error) {
              failSend(tenantId, chunk, error);
              entry.failed += chunk.length;
              entry.error = error instanceof Error ? error.message : String(error);
            }
          }
        }
      } catch (error) {
        failSend(tenantId, queued, error);
        entry.failed += queued.length;
        entry.error = error instanceof Error ? error.message : String(error);
      }
    }
    return summary;
  }

  type EnvioRow = { id: number; tenant_id: number; environment: SiiEnvironment; kind: "EnvioDTE" | "EnvioBOLETA"; track_id: string; attempts: number };

  /** Consulta al SII el resultado de los envios pendientes y actualiza sus documentos. */
  async function pollStatuses(options: { tenantId?: number } = {}) {
    const summary: Array<{ tenantId: number; checked: number; accepted: number; rejected: number; pending: number; error?: string }> = [];
    const envios = db.prepare(`
      SELECT id, tenant_id, environment, kind, track_id, attempts FROM dte_envios
      WHERE status = 'uploaded' AND track_id IS NOT NULL AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ${options.tenantId ? "AND tenant_id = ?" : ""}
      ORDER BY id LIMIT 200
    `).all(...(options.tenantId ? [sqlTime(now()), options.tenantId] : [sqlTime(now())])) as EnvioRow[];

    const byTenant = new Map<number, EnvioRow[]>();
    for (const envio of envios) byTenant.set(envio.tenant_id, [...(byTenant.get(envio.tenant_id) || []), envio]);

    for (const [tenantId, list] of byTenant) {
      const entry = { tenantId, checked: 0, accepted: 0, rejected: 0, pending: 0 } as (typeof summary)[number];
      summary.push(entry);
      try {
        const settings = getSettings(tenantId);
        const provider = buildProvider(tenantId, settings, loadActiveCertificate(tenantId));
        for (const envio of list) {
          entry.checked += 1;
          try {
            const status = await provider.queryStatus(envio.track_id, envio.kind === "EnvioBOLETA" ? "boleta" : "dte");
            if (status.state === "pending") {
              entry.pending += 1;
              db.prepare("UPDATE dte_envios SET attempts = attempts + 1, sii_status_code = ?, next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                .run(status.code, sqlTime(new Date(now().getTime() + backoffSeconds(envio.attempts + 1, POLL_MAX_SECONDS) * 1000)), envio.id);
              continue;
            }
            applyEnvioResult(tenantId, envio.id, status);
            if (status.state === "rejected") entry.rejected += 1; else entry.accepted += 1;
          } catch (error) {
            entry.pending += 1;
            const message = error instanceof Error ? error.message : String(error);
            entry.error = message;
            db.prepare("UPDATE dte_envios SET attempts = attempts + 1, next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
              .run(sqlTime(new Date(now().getTime() + backoffSeconds(envio.attempts + 1, POLL_MAX_SECONDS) * 1000)), envio.id);
            recordEvent(tenantId, { envioId: envio.id, type: "poll_failed", message });
          }
        }
      } catch (error) {
        entry.error = error instanceof Error ? error.message : String(error);
      }
    }
    return summary;
  }

  function applyEnvioResult(tenantId: number, envioId: number, status: { code: string; state: "accepted" | "accepted_with_objections" | "rejected" | "pending"; message: string; raw: unknown }) {
    const docStatus = status.state === "rejected" ? "rejected" : status.state === "accepted_with_objections" ? "accepted_with_objections" : "accepted";
    db.transaction(() => {
      db.prepare("UPDATE dte_envios SET status = ?, sii_status_code = ?, sii_response_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(docStatus, status.code, JSON.stringify(status.raw ?? null), envioId);
      const documents = db.prepare("SELECT id, source_type, source_id FROM dte_documents WHERE envio_id = ?").all(envioId) as Array<{ id: number; source_type: string | null; source_id: string | null }>;
      const update = db.prepare("UPDATE dte_documents SET status = ?, status_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      for (const doc of documents) {
        update.run(docStatus, status.message.slice(0, 300), doc.id);
        recordEvent(tenantId, { documentId: doc.id, envioId, type: "sii_result", status: docStatus, message: `${status.code}: ${status.message}` });
        // Las facturas de contratos (suscripcion) reflejan el resultado en su fila de facturacion.
        if (doc.source_type === "subscription" && doc.source_id) {
          const invoiceStatus = docStatus === "rejected" ? "rejected" : "accepted";
          db.prepare(`
            UPDATE invoices SET status_sii = ?, status_detail = ?, rejection_reason = ?, accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE accepted_at END,
              rejected_at = CASE WHEN ? = 'rejected' THEN datetime('now') ELSE rejected_at END, last_sync_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ? AND tenant_id = ?
          `).run(invoiceStatus, status.message.slice(0, 300), invoiceStatus === "rejected" ? status.message.slice(0, 300) : null, invoiceStatus, invoiceStatus, Number(doc.source_id), tenantId);
        }
      }
    })();
  }

  // ---------------------------------------------------------------- conexion, certificacion y produccion

  async function testConnection(tenantId: number) {
    const settings = getSettings(tenantId);
    const results: Array<{ service: "facturas" | "boletas"; ok: boolean; message: string }> = [];
    try {
      const certificate = loadActiveCertificate(tenantId);
      const endpoints = getSiiEndpoints(settings.environment, { allowProduction: settings.environment === "produccion" && productionAllowed() });
      for (const [kind, service] of [["dte", "facturas"], ["boleta", "boletas"]] as const) {
        try {
          await getSiiToken({ kind, endpoints, cert: certificate, http: deps.http, forceRefresh: true });
          results.push({ service, ok: true, message: "Autenticacion correcta" });
        } catch (error) {
          results.push({ service, ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      results.push({ service: "facturas", ok: false, message: error instanceof Error ? error.message : String(error) });
    }
    const ok = results.length > 0 && results.every(result => result.ok);
    const message = ok ? "El SII autentico el certificado" : results.filter(result => !result.ok).map(result => `${result.service}: ${result.message}`).join(" | ");
    db.prepare(`
      INSERT INTO dte_settings (tenant_id, connection_ok, connection_checked_at, connection_message) VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET connection_ok = excluded.connection_ok, connection_checked_at = CURRENT_TIMESTAMP, connection_message = excluded.connection_message
    `).run(tenantId, ok ? 1 : 0, message.slice(0, 500));
    recordEvent(tenantId, { type: "connection_tested", status: ok ? "ok" : "error", message });
    return { ok, results, message };
  }

  function saveCertificationEnvironment(tenantId: number, values: { resolucion_fecha: string; resolucion_numero?: number }) {
    const settings = getSettings(tenantId);
    if (settings.environment !== "certificacion") throw new DteServiceError("Solo se puede editar la resolucion de certificacion antes de pasar a produccion", "NOT_CERTIFICATION");
    db.prepare("UPDATE dte_settings SET resolucion_fecha = ?, resolucion_numero = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?")
      .run(values.resolucion_fecha, values.resolucion_numero ?? 0, tenantId);
    return getSettings(tenantId);
  }

  /**
   * Genera los documentos del set de pruebas: boletas con la referencia SET que pide el SII.
   * Si se omiten los casos se usan los de ejemplo; el set oficial se pega desde el portal del SII.
   * Quedan en cola y se envian al ambiente de certificacion.
   */
  function generateCertificationSet(tenantId: number, cases: Array<{ id: string; items: Array<{ nombre: string; cantidad?: number; precio: number }> }> | undefined, staffId?: number | null) {
    const settings = getSettings(tenantId);
    if (settings.environment !== "certificacion") throw new DteServiceError("El set de pruebas solo se genera en el ambiente de certificacion", "NOT_CERTIFICATION");
    const today = localDate(null, now());
    const documents: DteDocumentRow[] = [];
    for (const testCase of cases?.length ? cases : SAMPLE_CERTIFICATION_CASES) {
      const runs = db.prepare("SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? AND environment = 'certificacion' AND source_type = 'manual' AND source_id LIKE ?")
        .get(tenantId, `cert:${testCase.id}:%`) as { n: number };
      const { document } = issueDocument(tenantId, {
        dteType: 39,
        items: testCase.items.map(item => {
          const quantity = item.cantidad ?? 1;
          return { nombre: item.nombre, cantidad: quantity, precioUnitario: item.precio, monto: Math.round(quantity * item.precio) };
        }),
        referencias: [{ tipoDocumento: "SET", folio: testCase.id, fecha: today, razon: `CASO ${testCase.id}` }],
        source: { type: "manual", id: `cert:${testCase.id}:${runs.n + 1}` },
        staffId,
      });
      documents.push(document);
    }
    recordEvent(tenantId, { type: "certification_set_generated", message: `${documents.length} documentos`, staffId });
    return documents;
  }

  function goLive(tenantId: number, values: { resolucion_numero: number; resolucion_fecha: string }, staffId?: number | null) {
    const settings = getSettings(tenantId);
    if (settings.environment === "produccion") throw new DteServiceError("La empresa ya esta en produccion", "ALREADY_LIVE");
    if (!productionAllowed()) throw new DteServiceError("La produccion del SII no esta habilitada en este servidor (PARKIA_SII_ALLOW_PRODUCTION)", "PRODUCTION_BLOCKED", 403);
    const accepted = db.prepare(`
      SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? AND environment = 'certificacion' AND dte_type = 39 AND status IN ('accepted', 'accepted_with_objections')
    `).get(tenantId) as { n: number };
    if (accepted.n === 0) throw new DteServiceError("Antes de pasar a produccion el SII debe aceptar al menos una boleta de prueba en certificacion", "NOT_CERTIFIED");
    if (!activeCertificateRow(tenantId)) throw new DteServiceError("Falta el certificado digital", "NO_CERTIFICATE");
    const cafs = db.prepare("SELECT COUNT(*) AS n FROM dte_cafs WHERE tenant_id = ? AND environment = 'produccion' AND dte_type = 39 AND status = 'active'").get(tenantId) as { n: number };
    if (cafs.n === 0) throw new DteServiceError("Carga un CAF de boletas (tipo 39) de produccion antes de pasar a produccion", "NO_PRODUCTION_CAF");

    db.prepare(`
      UPDATE dte_settings SET environment = 'produccion', status = 'production', resolucion_numero = ?, resolucion_fecha = ?,
        live_since = ?, connection_ok = NULL, connection_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?
    `).run(values.resolucion_numero, values.resolucion_fecha, sqlTime(now()), tenantId);
    recordEvent(tenantId, { type: "went_live", message: `Resolucion ${values.resolucion_numero} del ${values.resolucion_fecha}`, staffId });
    return getSettings(tenantId);
  }

  // ---------------------------------------------------------------- consulta

  function listDocuments(tenantId: number, options: { status?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const filter = options.status && options.status !== "all" ? "AND status = ?" : "";
    const params = options.status && options.status !== "all" ? [tenantId, options.status] : [tenantId];
    const rows = db.prepare(`
      SELECT id, environment, dte_type, folio, issued_at, receptor_rut, receptor_razon, total, status, status_detail, track_id, source_type, source_id, send_attempts, created_at
      FROM dte_documents WHERE tenant_id = ? ${filter} ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? ${filter}`).get(...params) as { n: number }).n;
    return { items: rows, total, limit, offset };
  }

  function getDocument(tenantId: number, id: number) {
    return db.prepare("SELECT * FROM dte_documents WHERE id = ? AND tenant_id = ?").get(id, tenantId) as DteDocumentRow | undefined;
  }

  function documentEvents(tenantId: number, id: number) {
    return db.prepare("SELECT event_type, status, message, created_at FROM dte_events WHERE tenant_id = ? AND document_id = ? ORDER BY id").all(tenantId, id);
  }

  /** Estado del asistente de configuracion: pasos, alertas y contadores. */
  function getOnboarding(tenantId: number) {
    const settings = getSettings(tenantId);
    const certificate = certificateSummary(activeCertificateRow(tenantId));
    const cafs = listCafs(tenantId);
    const boletaCafs = cafs.filter(caf => caf.dte_type === 39 && caf.environment === settings.environment && caf.status === "active");
    const boletaRemaining = boletaCafs.reduce((sum, caf) => sum + caf.remaining, 0);
    const counts = Object.fromEntries((db.prepare("SELECT status, COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? GROUP BY status").all(tenantId) as Array<{ status: string; n: number }>).map(row => [row.status, row.n]));
    const certAccepted = (db.prepare(`
      SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? AND environment = 'certificacion' AND dte_type = 39 AND status IN ('accepted', 'accepted_with_objections')
    `).get(tenantId) as { n: number }).n;
    const certSent = (db.prepare("SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? AND environment = 'certificacion'").get(tenantId) as { n: number }).n;

    const alerts: Array<{ level: "error" | "warning"; code: string; message: string }> = [];
    if (certificate?.expired) alerts.push({ level: "error", code: "CERT_EXPIRED", message: "El certificado digital esta vencido: sube uno nuevo para poder enviar documentos." });
    else if (certificate && certificate.daysLeft <= 30) alerts.push({ level: "warning", code: "CERT_EXPIRING", message: `El certificado digital vence en ${certificate.daysLeft} dias.` });
    if (settings.status !== "unconfigured" && boletaCafs.length === 0) alerts.push({ level: settings.status === "production" ? "error" : "warning", code: "NO_CAF", message: "No hay folios (CAF) de boletas disponibles." });
    else if (boletaCafs.length && boletaRemaining <= 20) alerts.push({ level: "warning", code: "CAF_LOW", message: `Quedan ${boletaRemaining} folios de boletas: solicita un nuevo CAF al SII.` });
    const stuck = (db.prepare("SELECT COUNT(*) AS n FROM dte_documents WHERE tenant_id = ? AND status = 'queued' AND created_at <= ?").get(tenantId, sqlTime(new Date(now().getTime() - 24 * 3600 * 1000))) as { n: number }).n;
    if (stuck > 0) alerts.push({ level: "error", code: "QUEUE_STUCK", message: `${stuck} documentos llevan mas de 24 horas sin poder enviarse al SII.` });
    if (counts.rejected) alerts.push({ level: "warning", code: "REJECTED", message: `${counts.rejected} documentos fueron rechazados por el SII.` });

    const emisorDone = isEmisorComplete(settings);
    const steps = [
      { key: "emisor", done: emisorDone },
      { key: "certificate", done: Boolean(certificate && !certificate.expired) },
      { key: "connection", done: settings.connection_ok === 1 },
      { key: "caf", done: boletaRemaining > 0 },
      { key: "test_document", done: certAccepted > 0 },
      { key: "production", done: settings.status === "production" },
    ];
    return {
      status: settings.status,
      environment: settings.environment,
      productionAllowed: productionAllowed(),
      settings: {
        rut_emisor: settings.rut_emisor, razon_social: settings.razon_social, giro: settings.giro,
        acteco: settings.acteco_json ? (JSON.parse(settings.acteco_json) as number[]) : [], direccion: settings.direccion,
        comuna: settings.comuna, ciudad: settings.ciudad, sii_unidad: settings.sii_unidad, codigo_sucursal_sii: settings.codigo_sucursal_sii,
        rut_envia: settings.rut_envia, auto_emit_boleta: Boolean(settings.auto_emit_boleta),
        resolucion_numero: settings.resolucion_numero, resolucion_fecha: settings.resolucion_fecha, live_since: settings.live_since,
      },
      connection: { ok: settings.connection_ok === null ? null : settings.connection_ok === 1, checkedAt: settings.connection_checked_at, message: settings.connection_message },
      certificate,
      cafs,
      certification: { sent: certSent, accepted: certAccepted },
      counts,
      steps,
      alerts,
    };
  }

  return {
    getSettings, saveSettings, isEmisorComplete,
    uploadCertificate, removeCertificate, loadActiveCertificate,
    uploadCaf, listCafs,
    issueDocument, issueBoletaForTicket, reconcileTicketBoletas, reconcileAllTenants,
    sendPending, pollStatuses,
    testConnection, saveCertificationEnvironment, generateCertificationSet, goLive,
    listDocuments, getDocument, documentEvents, getOnboarding,
    cafRemaining,
  };
}

export type DteService = ReturnType<typeof createDteService>;
