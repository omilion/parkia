import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { applyDteMigration } from "../../server/modules/dte/migration";
import { clearTokenCache } from "../../server/modules/dte/providers/sii/auth";
import { getSiiEndpoints } from "../../server/modules/dte/providers/sii/endpoints";
import { createDteService, DteServiceError } from "../../server/modules/dte/service";
import { createTestCaf, createTestPfx, PFX_PASSWORD, RUT_EMISOR } from "./fixtures";

const cert = getSiiEndpoints("certificacion");

const seedXml = `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>012345678901</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;
const tokenXml = `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>TOKEN-X</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;

type Behaviour = { upload?: () => Response; status?: () => Response };

/** SII simulado para boletas. Ninguna prueba sale a la red. */
function fakeSii(behaviour: Behaviour = {}) {
  const calls: string[] = [];
  const uploads: string[] = [];
  let nextTrack = 1000;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith(cert.boleta.seed)) return new Response(seedXml);
    if (url.startsWith(cert.boleta.token)) return new Response(tokenXml);
    if (url.startsWith(cert.dte.seed)) return new Response(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><r><getSeedReturn>${seedXml.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</getSeedReturn></r></soapenv:Body></soapenv:Envelope>`);
    if (url.startsWith(cert.dte.token)) return new Response(`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><r><getTokenReturn>${tokenXml.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</getTokenReturn></r></soapenv:Body></soapenv:Envelope>`);
    if (url.startsWith(cert.boleta.upload)) {
      if (behaviour.upload) return behaviour.upload();
      const file = (init?.body as FormData).get("archivo") as Blob;
      uploads.push(Buffer.from(await file.arrayBuffer()).toString("latin1"));
      nextTrack += 1;
      return new Response(JSON.stringify({ trackid: nextTrack, estado: "REC" }));
    }
    if (url.startsWith(cert.boleta.uploadStatus)) return behaviour.status ? behaviour.status() : new Response(JSON.stringify({ estado: "EPR" }));
    throw new Error(`URL no simulada: ${url}`);
  };
  return { fetch, calls, uploads };
}

function setup(options: { behaviour?: Behaviour; productionAllowed?: boolean } = {}) {
  clearTokenCache();
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO tenants (id, name) VALUES (1, 'Empresa A'), (2, 'Empresa B');
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, tenant_id INTEGER, status_sii TEXT, status_detail TEXT, rejection_reason TEXT,
      accepted_at TEXT, rejected_at TEXT, last_sync_at TEXT, updated_at TEXT);
  `);
  applyDteMigration(db);
  const sii = fakeSii(options.behaviour);
  const clock = { time: new Date("2026-11-11T15:00:00Z") };
  const service = createDteService({ db, http: { fetch: sii.fetch }, now: () => clock.time, allowProduction: () => options.productionAllowed ?? false });
  return { db, service, sii, clock };
}

const EMISOR_VALUES = {
  rut_emisor: RUT_EMISOR, razon_social: "Estacionamientos Ñuñoa SpA", giro: "Servicios de estacionamiento", acteco: [522130],
  direccion: "Av. Irarrázaval 1234", comuna: "Ñuñoa", ciudad: "Santiago", sii_unidad: "SANTIAGO ORIENTE",
};

function configure(ctx: ReturnType<typeof setup>, tenantId = 1) {
  ctx.service.saveSettings(tenantId, EMISOR_VALUES);
  ctx.service.saveCertificationEnvironment(tenantId, { resolucion_fecha: "2026-11-01", resolucion_numero: 0 });
  ctx.service.uploadCertificate(tenantId, { pfxBase64: createTestPfx().toString("base64"), password: PFX_PASSWORD });
  ctx.service.uploadCaf(tenantId, { content: createTestCaf({ type: 39, from: 1, to: 50 }) });
}

test("onboarding: los pasos avanzan al configurar emisor, certificado y folios", () => {
  const ctx = setup();
  assert.deepEqual(ctx.service.getOnboarding(1).steps.map(step => step.done), [false, false, false, false, false, false]);

  ctx.service.saveSettings(1, EMISOR_VALUES);
  assert.equal(ctx.service.getOnboarding(1).status, "testing");
  ctx.service.uploadCertificate(1, { pfxBase64: createTestPfx().toString("base64"), password: PFX_PASSWORD });
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 50 }) });

  const onboarding = ctx.service.getOnboarding(1);
  assert.deepEqual(onboarding.steps.map(step => step.done), [true, true, false, true, false, false]);
  assert.equal(onboarding.cafs[0].remaining, 50);
  assert.equal(ctx.service.getOnboarding(2).status, "unconfigured", "la otra empresa no ve nada");
});

test("secretos: el certificado, su clave y el CAF se guardan cifrados y no salen en respuestas", () => {
  const ctx = setup();
  configure(ctx);
  const cert = ctx.db.prepare("SELECT pfx_encrypted, password_encrypted FROM dte_certificates").get() as { pfx_encrypted: string; password_encrypted: string };
  const caf = ctx.db.prepare("SELECT caf_xml_encrypted FROM dte_cafs").get() as { caf_xml_encrypted: string };
  for (const value of [cert.pfx_encrypted, cert.password_encrypted, caf.caf_xml_encrypted]) assert.match(value, /^pk1:/);
  assert.ok(!cert.password_encrypted.includes(PFX_PASSWORD));
  assert.ok(!caf.caf_xml_encrypted.includes("RSASK"));

  const serialized = JSON.stringify(ctx.service.getOnboarding(1));
  assert.ok(!serialized.includes(PFX_PASSWORD));
  assert.ok(!serialized.includes("pk1:"));
  assert.ok(!serialized.includes("PRIVATE KEY"));
});

test("carga de certificado y CAF: rechaza archivos que no corresponden", () => {
  const ctx = setup();
  assert.throws(() => ctx.service.uploadCaf(1, { content: createTestCaf() }), (error: unknown) => error instanceof DteServiceError && error.code === "NO_EMISOR");
  ctx.service.saveSettings(1, EMISOR_VALUES);

  assert.throws(() => ctx.service.uploadCertificate(1, { pfxBase64: createTestPfx().toString("base64"), password: "otra" }), /clave del certificado es incorrecta/);
  const expired = createTestPfx({ notBefore: new Date("2020-01-01"), notAfter: new Date("2021-01-01") });
  assert.throws(() => ctx.service.uploadCertificate(1, { pfxBase64: expired.toString("base64"), password: PFX_PASSWORD }), /venci/i);

  assert.throws(() => ctx.service.uploadCaf(1, { content: createTestCaf({ rut: "77777777-7" }) }), /RUT/);
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 50 }) });
  assert.throws(() => ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 40, to: 90 }) }), (error: unknown) => error instanceof DteServiceError && error.code === "CAF_OVERLAP");
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 51, to: 90 }) });
  assert.equal(ctx.service.listCafs(1).length, 2);
});

test("emision: folio correlativo, un documento por origen y boleta sin cliente", () => {
  const ctx = setup();
  configure(ctx);
  const input = { dteType: 39 as const, items: [{ nombre: "Servicio de estacionamiento", monto: 1190 }], source: { type: "ticket" as const, id: "77" } };
  const first = ctx.service.issueDocument(1, input);
  assert.equal(first.created, true);
  assert.equal(first.document.folio, 1);
  assert.equal(first.document.status, "queued");
  assert.equal(first.document.receptor_rut, null, "la boleta se emite sin cliente");
  assert.match(first.document.dte_xml as string, /<RUTRecep>66666666-6<\/RUTRecep>/);
  assert.equal(first.document.total, 1190);
  assert.equal(first.document.iva, 190);

  const again = ctx.service.issueDocument(1, input);
  assert.equal(again.created, false);
  assert.equal(again.document.id, first.document.id);
  assert.equal(ctx.service.issueDocument(1, { ...input, source: { type: "ticket", id: "78" } }).document.folio, 2);
  assert.equal(ctx.service.listCafs(1)[0].remaining, 48);
});

test("emision: sin folios o sin emisor no consume nada ni deja documentos a medias", () => {
  const ctx = setup();
  assert.throws(() => ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "x", monto: 1000 }] }), (error: unknown) => error instanceof DteServiceError && error.code === "NO_EMISOR");
  ctx.service.saveSettings(1, EMISOR_VALUES);
  assert.throws(() => ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "x", monto: 1000 }] }), /No hay folios/);
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 2 }) });
  // Un item invalido falla despues de tomar el folio: el folio debe volver.
  assert.throws(() => ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "", monto: 0 }] }));
  assert.equal(ctx.service.listCafs(1)[0].next_folio, 1);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM dte_documents").get().n, 0);
});

test("envio: agrupa las boletas en un sobre firmado, guarda el track y luego el SII las acepta", async () => {
  const ctx = setup();
  configure(ctx);
  for (const id of ["1", "2", "3"]) ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "Estacionamiento", monto: 2380 }], source: { type: "ticket", id } });

  const sent = await ctx.service.sendPending();
  assert.deepEqual(sent.map(item => [item.tenantId, item.sent, item.failed]), [[1, 3, 0]]);
  assert.equal(ctx.sii.uploads.length, 1, "un solo sobre con las tres boletas");
  assert.match(ctx.sii.uploads[0], /<EnvioBOLETA /);
  assert.equal((ctx.sii.uploads[0].match(/<Documento /g) || []).length, 3);
  const docs = ctx.db.prepare("SELECT status, track_id FROM dte_documents ORDER BY folio").all() as Array<{ status: string; track_id: string }>;
  assert.deepEqual(docs.map(doc => doc.status), ["sent", "sent", "sent"]);
  assert.equal(new Set(docs.map(doc => doc.track_id)).size, 1);

  // Aun no toca consultar: se espera un minuto.
  assert.deepEqual(await ctx.service.pollStatuses(), []);
  ctx.clock.time = new Date(ctx.clock.time.getTime() + 61_000);
  const polled = await ctx.service.pollStatuses();
  assert.equal(polled[0].accepted, 1);
  const after = ctx.db.prepare("SELECT status FROM dte_documents").all() as Array<{ status: string }>;
  assert.ok(after.every(doc => doc.status === "accepted"));
  assert.equal(ctx.db.prepare("SELECT status FROM dte_envios").get().status, "accepted");
});

test("envio: si el SII rechaza el sobre el documento sigue en cola con espera creciente", async () => {
  const ctx = setup({ behaviour: { upload: () => new Response(JSON.stringify({ error: "x" }), { status: 500 }) } });
  configure(ctx);
  ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "Estacionamiento", monto: 1190 }], source: { type: "ticket", id: "1" } });

  const first = await ctx.service.sendPending();
  assert.equal(first[0].failed, 1);
  const row = () => ctx.db.prepare("SELECT status, send_attempts, next_attempt_at, status_detail FROM dte_documents").get() as { status: string; send_attempts: number; next_attempt_at: string; status_detail: string };
  assert.equal(row().status, "queued");
  assert.equal(row().send_attempts, 1);
  assert.match(row().status_detail, /HTTP 500/);

  assert.deepEqual(await ctx.service.sendPending(), [], "no reintenta antes de la espera");
  ctx.clock.time = new Date(ctx.clock.time.getTime() + 61_000);
  await ctx.service.sendPending();
  assert.equal(row().send_attempts, 2);
  assert.ok(new Date(row().next_attempt_at.replace(" ", "T") + "Z").getTime() - ctx.clock.time.getTime() >= 119_000, "la segunda espera es de dos minutos");
});

test("envio: sin certificado los documentos quedan en cola y se informa", async () => {
  const ctx = setup();
  ctx.service.saveSettings(1, EMISOR_VALUES);
  ctx.service.saveCertificationEnvironment(1, { resolucion_fecha: "2026-11-01" });
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 5 }) });
  ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "x", monto: 1190 }] });
  const result = await ctx.service.sendPending();
  assert.match(result[0].error as string, /certificado/);
  assert.equal(ctx.db.prepare("SELECT status FROM dte_documents").get().status, "queued");
});

test("rechazo del SII: el documento queda rechazado y aparece como alerta", async () => {
  const ctx = setup({ behaviour: { status: () => new Response(JSON.stringify({ estado: "RCH" })) } });
  configure(ctx);
  ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "x", monto: 1190 }], source: { type: "ticket", id: "1" } });
  await ctx.service.sendPending();
  ctx.clock.time = new Date(ctx.clock.time.getTime() + 61_000);
  const polled = await ctx.service.pollStatuses();
  assert.equal(polled[0].rejected, 1);
  assert.equal(ctx.db.prepare("SELECT status FROM dte_documents").get().status, "rejected");
  assert.ok(ctx.service.getOnboarding(1).alerts.some(alert => alert.code === "REJECTED"));
});

test("conexion: autentica contra facturas y boletas y deja constancia", async () => {
  const ctx = setup();
  configure(ctx);
  const result = await ctx.service.testConnection(1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(item => item.service), ["facturas", "boletas"]);
  assert.equal(ctx.service.getOnboarding(1).steps[2].done, true);

  const failing = setup({ behaviour: {} });
  failing.service.saveSettings(1, EMISOR_VALUES);
  const noCert = await failing.service.testConnection(1);
  assert.equal(noCert.ok, false);
  assert.match(noCert.message, /certificado/);
});

test("set de pruebas: genera boletas con referencia SET, valida contra el esquema y se puede repetir", async () => {
  const ctx = setup();
  configure(ctx);
  const docs = ctx.service.generateCertificationSet(1, undefined);
  assert.equal(docs.length, 5);
  assert.match(docs[0].dte_xml as string, /<TpoDocRef>SET<\/TpoDocRef>/);
  assert.match(docs[0].dte_xml as string, /<RazonRef>CASO 1<\/RazonRef>/);

  await ctx.service.sendPending();
  const { validateAgainstSii } = await import("./fixtures");
  const result = await validateAgainstSii(ctx.sii.uploads[0], "boleta");
  assert.deepEqual(result.errors, [], "el sobre del set cumple el XSD oficial");

  const again = ctx.service.generateCertificationSet(1, [{ id: "1", items: [{ nombre: "Caso corregido", cantidad: 1, precio: 5000 }] }]);
  assert.equal(again[0].folio, 6, "repetir un caso consume un folio nuevo");
});

test("produccion: protegida por el servidor, exige certificacion aceptada y CAF de produccion", async () => {
  const blocked = setup({ productionAllowed: false });
  configure(blocked);
  await assert.rejects(async () => blocked.service.goLive(1, { resolucion_numero: 80, resolucion_fecha: "2026-11-20" }), (error: unknown) => error instanceof DteServiceError && error.code === "PRODUCTION_BLOCKED");

  const ctx = setup({ productionAllowed: true });
  configure(ctx);
  assert.throws(() => ctx.service.goLive(1, { resolucion_numero: 80, resolucion_fecha: "2026-11-20" }), (error: unknown) => error instanceof DteServiceError && error.code === "NOT_CERTIFIED");

  ctx.service.generateCertificationSet(1, undefined);
  await ctx.service.sendPending();
  ctx.clock.time = new Date(ctx.clock.time.getTime() + 61_000);
  await ctx.service.pollStatuses();
  assert.equal(ctx.service.getOnboarding(1).steps[4].done, true);

  assert.throws(() => ctx.service.goLive(1, { resolucion_numero: 80, resolucion_fecha: "2026-11-20" }), (error: unknown) => error instanceof DteServiceError && error.code === "NO_PRODUCTION_CAF");
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 100, idk: 300 }) });
  assert.equal(ctx.service.listCafs(1).find(caf => caf.environment === "produccion")?.dte_type, 39);

  const live = ctx.service.goLive(1, { resolucion_numero: 80, resolucion_fecha: "2026-11-20" });
  assert.equal(live.environment, "produccion");
  assert.equal(live.status, "production");

  // Desde aqui los cobros de tickets generan boletas reales, una por ticket.
  const issued = ctx.service.issueBoletaForTicket(1, { ticketId: 501, plate: "ABCD12", amount: 2380, durationMins: 95 });
  assert.ok("document" in issued && issued.created);
  assert.equal(issued.document.environment, "produccion");
  assert.match(issued.document.items_json, /Patente ABCD12 - 95 min/);
  const repeated = ctx.service.issueBoletaForTicket(1, { ticketId: 501, plate: "ABCD12", amount: 2380 });
  assert.ok("document" in repeated && !repeated.created);
  assert.deepEqual(ctx.service.issueBoletaForTicket(1, { ticketId: 502, amount: 0 }), { skipped: "Cobro sin monto: no se emite boleta" });
});

test("boleta de ticket: en certificacion no se emite (no son ventas reales)", () => {
  const ctx = setup();
  configure(ctx);
  const result = ctx.service.issueBoletaForTicket(1, { ticketId: 1, amount: 1190 });
  assert.ok("skipped" in result);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM dte_documents").get().n, 0);
});

test("aislamiento: cada empresa tiene su propia numeracion, documentos y secretos", () => {
  const ctx = setup();
  configure(ctx, 1);
  configure(ctx, 2);
  const a = ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "x", monto: 1190 }] });
  const b = ctx.service.issueDocument(2, { dteType: 39, items: [{ nombre: "x", monto: 1190 }] });
  assert.equal(a.document.folio, 1);
  assert.equal(b.document.folio, 1);
  assert.equal(ctx.service.getDocument(1, b.document.id), undefined, "no se puede leer el documento de otra empresa");
  assert.equal(ctx.service.listDocuments(2).total, 1);

  // El secreto de una empresa no se descifra con el contexto de otra.
  const stolen = ctx.db.prepare("SELECT pfx_encrypted FROM dte_certificates WHERE tenant_id = 1").get() as { pfx_encrypted: string };
  ctx.db.prepare("UPDATE dte_certificates SET pfx_encrypted = ? WHERE tenant_id = 2").run(stolen.pfx_encrypted);
  assert.throws(() => ctx.service.loadActiveCertificate(2));
});

test("alertas: certificado por vencer y folios por agotarse", () => {
  const ctx = setup();
  ctx.service.saveSettings(1, EMISOR_VALUES);
  const soon = createTestPfx({ notAfter: new Date(ctx.clock.time.getTime() + 10 * 86_400_000) });
  ctx.service.uploadCertificate(1, { pfxBase64: soon.toString("base64"), password: PFX_PASSWORD });
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 10 }) });
  const codes = ctx.service.getOnboarding(1).alerts.map(alert => alert.code);
  assert.ok(codes.includes("CERT_EXPIRING"));
  assert.ok(codes.includes("CAF_LOW"));
});

test("reconciliacion: emite las boletas de tickets cobrados que se quedaron sin documento", () => {
  const ctx = setup({ productionAllowed: true });
  ctx.db.exec(`
    CREATE TABLE visitor_tickets (id INTEGER PRIMARY KEY, tenant_id INTEGER, branch_id INTEGER, plate TEXT, entry_time TEXT, paid_at TEXT, amount REAL, status TEXT);
    INSERT INTO visitor_tickets VALUES (1, 1, NULL, 'AAAA11', '2026-11-11 10:00:00', '2026-11-11 11:00:00', 1190, 'paid');
    INSERT INTO visitor_tickets VALUES (2, 1, NULL, 'BBBB22', '2026-11-11 10:00:00', '2026-11-11 12:30:00', 2380, 'completed');
    INSERT INTO visitor_tickets VALUES (3, 1, NULL, 'CCCC33', '2026-11-10 10:00:00', '2026-11-10 11:00:00', 1190, 'paid');
    INSERT INTO visitor_tickets VALUES (4, 2, NULL, 'DDDD44', '2026-11-11 10:00:00', '2026-11-11 11:00:00', 1190, 'paid');
  `);
  configure(ctx);
  ctx.db.prepare("UPDATE dte_settings SET environment = 'produccion', status = 'production', live_since = '2026-11-11 00:00:00' WHERE tenant_id = 1").run();
  ctx.service.uploadCaf(1, { content: createTestCaf({ type: 39, from: 1, to: 50, idk: 300 }) });

  assert.equal(ctx.service.reconcileTicketBoletas(1), 2, "solo los tickets cobrados desde el paso a produccion");
  assert.equal(ctx.service.reconcileTicketBoletas(1), 0, "no duplica");
  const tickets = ctx.db.prepare("SELECT source_id FROM dte_documents ORDER BY folio").all() as Array<{ source_id: string }>;
  assert.deepEqual(tickets.map(row => row.source_id), ["1", "2"]);
});

test("facturas de contrato: la respuesta del SII se refleja en la fila de facturacion", async () => {
  for (const [estado, esperado] of [["EPR", "accepted"], ["RCH", "rejected"]] as const) {
    const ctx = setup({ behaviour: { status: () => new Response(JSON.stringify({ estado })) } });
    configure(ctx);
    ctx.db.prepare("INSERT INTO invoices (id, tenant_id, status_sii) VALUES (7, 1, 'pending'), (8, 2, 'pending')").run();
    ctx.service.issueDocument(1, { dteType: 39, items: [{ nombre: "Arriendo mensual", monto: 52000 }], source: { type: "subscription", id: "7" } });
    await ctx.service.sendPending();
    ctx.clock.time = new Date(ctx.clock.time.getTime() + 61_000);
    await ctx.service.pollStatuses();

    const row = ctx.db.prepare("SELECT status_sii, rejection_reason, last_sync_at FROM invoices WHERE id = 7").get() as { status_sii: string; rejection_reason: string | null; last_sync_at: string };
    assert.equal(row.status_sii, esperado);
    assert.equal(Boolean(row.rejection_reason), esperado === "rejected");
    assert.ok(row.last_sync_at);
    // Una factura de otra empresa con el mismo numero no se toca.
    assert.equal((ctx.db.prepare("SELECT status_sii FROM invoices WHERE id = 8").get() as { status_sii: string }).status_sii, "pending");
  }
});
