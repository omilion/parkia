import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { applyDteMigration, takeNextFolio } from "../../server/modules/dte/migration";

function setup() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO tenants (id, name) VALUES (1, 'A'), (2, 'B');");
  applyDteMigration(db);
  applyDteMigration(db); // idempotente
  return db;
}

function insertCaf(db: Database.Database, tenantId: number, from: number, to: number, type = 39) {
  db.prepare(`
    INSERT INTO dte_cafs (tenant_id, environment, dte_type, folio_from, folio_to, next_folio, caf_xml_encrypted, authorized_at)
    VALUES (?, 'certificacion', ?, ?, ?, ?, 'pk1:x', '2026-11-01')
  `).run(tenantId, type, from, to, from);
}

test("folios: correlativos, sin repetir, pasan al siguiente CAF y se agotan", () => {
  const db = setup();
  insertCaf(db, 1, 1, 3);
  insertCaf(db, 1, 4, 5);
  insertCaf(db, 2, 1, 10);
  const take = (tenantId: number) => db.transaction(() => takeNextFolio(db, { tenantId, environment: "certificacion", dteType: 39 }))().folio;

  assert.deepEqual([take(1), take(1), take(1), take(1), take(1)], [1, 2, 3, 4, 5]);
  assert.throws(() => take(1), /No hay folios disponibles/);
  assert.equal(take(2), 1, "cada tenant tiene su propia numeracion");
  assert.throws(() => takeNextFolio(db, { tenantId: 1, environment: "produccion", dteType: 39 }), /No hay folios/);
});

test("documentos: un folio por tipo y un documento por origen", () => {
  const db = setup();
  const insert = db.prepare(`
    INSERT INTO dte_documents (tenant_id, environment, dte_type, folio, issued_at, total, items_json, source_type, source_id)
    VALUES (?, 'certificacion', 39, ?, '2026-11-11', 1190, '[]', 'ticket', ?)
  `);
  insert.run(1, 1, "ticket-10");
  assert.throws(() => insert.run(1, 1, "ticket-11"), /UNIQUE/);
  assert.throws(() => insert.run(1, 2, "ticket-10"), /UNIQUE/);
  insert.run(2, 1, "ticket-10");

  // La boleta de estacionamiento no requiere cliente ni receptor.
  const row = db.prepare("SELECT client_id, receptor_rut FROM dte_documents WHERE tenant_id = 1").get() as { client_id: null; receptor_rut: null };
  assert.deepEqual(row, { client_id: null, receptor_rut: null });
});
