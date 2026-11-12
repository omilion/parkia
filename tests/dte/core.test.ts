import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { decryptSecret, decryptSecretString, encryptSecret, generateMasterKey, resetMasterKeyCacheForTesting } from "../../server/platform/secrets";
import { computeRutDv, normalizeRut } from "../../server/modules/dte/providers/sii/rut";
import { CertificateError, loadPfx } from "../../server/modules/dte/providers/sii/cert";
import { CafError, parseCaf } from "../../server/modules/dte/providers/sii/caf";
import { buildDte, computeTotals, DteValidationError } from "../../server/modules/dte/providers/sii/builder";
import { verifyTed } from "../../server/modules/dte/providers/sii/ted";
import { buildEnvelope } from "../../server/modules/dte/providers/sii/envelope";
import { verifySignatures } from "../../server/modules/dte/providers/sii/signer";
import { decodeLatin1 } from "../../server/modules/dte/providers/sii/xml";
import { tedToPng } from "../../server/modules/dte/pdf417";
import { boletaInput, createTestCaf, createTestPfx, facturaInput, PFX_PASSWORD, RUT_EMISOR, RUT_TITULAR, validateAgainstSii } from "./fixtures";

process.env.NODE_ENV = "test";
process.env.PARKIA_MASTER_KEY = generateMasterKey();
resetMasterKeyCacheForTesting();

const pfx = createTestPfx();
const cert = loadPfx(pfx, PFX_PASSWORD);
const cafBoleta = parseCaf(createTestCaf({ type: 39 }));
const cafFactura = parseCaf(createTestCaf({ type: 33 }));
const envelopeOptions = { rutEmisor: RUT_EMISOR, rutEnvia: RUT_TITULAR, fechaResolucion: "2026-11-01", numeroResolucion: 0 };

test("secrets: cifra y descifra por tenant y proposito", () => {
  const token = encryptSecret("clave-super-secreta", { tenantId: 7, purpose: "dte.certificate.password" });
  assert.match(token, /^pk1:/);
  assert.equal(decryptSecretString(token, { tenantId: 7, purpose: "dte.certificate.password" }), "clave-super-secreta");
  assert.throws(() => decryptSecret(token, { tenantId: 8, purpose: "dte.certificate.password" }), /No se pudo descifrar/);
  assert.throws(() => decryptSecret(token, { tenantId: 7, purpose: "dte.caf.39" }), /No se pudo descifrar/);

  const raw = Buffer.from(token.slice(4), "base64");
  raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decryptSecret(`pk1:${raw.toString("base64")}`, { tenantId: 7, purpose: "dte.certificate.password" }), /No se pudo descifrar/);

  const binary = encryptSecret(pfx, { tenantId: 7, purpose: "dte.certificate.pfx" });
  assert.deepEqual(decryptSecret(binary, { tenantId: 7, purpose: "dte.certificate.pfx" }), pfx);
});

test("secrets: en produccion exige PARKIA_MASTER_KEY", () => {
  const previous = { env: process.env.NODE_ENV, key: process.env.PARKIA_MASTER_KEY };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PARKIA_MASTER_KEY;
    resetMasterKeyCacheForTesting();
    assert.throws(() => encryptSecret("x", { tenantId: 1, purpose: "p" }), /PARKIA_MASTER_KEY/);
  } finally {
    process.env.NODE_ENV = previous.env;
    process.env.PARKIA_MASTER_KEY = previous.key;
    resetMasterKeyCacheForTesting();
  }
});

test("rut: digito verificador y normalizacion", () => {
  assert.equal(computeRutDv("76192083"), "9");
  assert.equal(computeRutDv("60803000"), "K");
  assert.equal(normalizeRut("76.192.083-9"), "76192083-9");
  assert.equal(normalizeRut("60803000k"), "60803000-K");
  assert.throws(() => normalizeRut("76192083-1"), /digito verificador/);
});

test("certificado: carga pfx, detecta titular y valida clave y vigencia", () => {
  assert.equal(cert.subjectRut, RUT_TITULAR);
  assert.equal(cert.subjectName, "TITULAR DE PRUEBA PARKIA");
  assert.match(cert.privateKeyPem, /BEGIN RSA PRIVATE KEY/);
  assert.equal(cert.exponentBase64, "AQAB");
  assert.ok(cert.modulusBase64.length > 300);

  assert.throws(() => loadPfx(pfx, "otra-clave"), (error: unknown) => error instanceof CertificateError && error.code === "INVALID_PASSWORD");
  assert.throws(() => loadPfx(Buffer.from("no es un pfx"), "x"), (error: unknown) => error instanceof CertificateError && error.code === "INVALID_FILE");

  const expired = createTestPfx({ notBefore: new Date("2020-01-01"), notAfter: new Date("2021-01-01") });
  assert.throws(() => loadPfx(expired, PFX_PASSWORD), (error: unknown) => error instanceof CertificateError && error.code === "EXPIRED");
  assert.equal(loadPfx(expired, PFX_PASSWORD, { allowExpired: true }).subjectRut, RUT_TITULAR);
  assert.equal(loadPfx(createTestPfx({ withRut: false }), PFX_PASSWORD).subjectRut, null);
});

test("CAF: lee rango, ambiente y claves, y valida coherencia", () => {
  assert.equal(cafBoleta.rutEmisor, RUT_EMISOR);
  assert.equal(cafBoleta.type, 39);
  assert.equal(cafBoleta.folioFrom, 1);
  assert.equal(cafBoleta.folioTo, 100);
  assert.equal(cafBoleta.environment, "certificacion");
  assert.equal(cafBoleta.expiresAt, null);
  assert.equal(cafFactura.expiresAt, "2027-05-01");
  assert.ok(cafBoleta.cafXml.startsWith('<CAF version="1.0"><DA><RE>'));
  assert.doesNotMatch(cafBoleta.cafXml, />\s+</);

  assert.throws(() => parseCaf(createTestCaf({ mismatchedKey: true })), CafError);
  assert.throws(() => parseCaf(createTestCaf(), { rutEmisor: "77777777-7" }), /no del emisor configurado/);
  assert.throws(() => parseCaf(createTestCaf({ type: 39 }), { type: 33 }), /tipo 39/);
  assert.throws(() => parseCaf("<html></html>"), CafError);
  assert.equal(parseCaf(createTestCaf({ idk: 300 })).environment, "produccion");
});

test("totales: boleta desglosa IVA desde el bruto y factura lo suma al neto", () => {
  assert.deepEqual(computeTotals(39, [{ nombre: "x", monto: 1190 }]), { neto: 1000, exento: 0, iva: 190, total: 1190, tasaIva: 19 });
  assert.deepEqual(computeTotals(39, [{ nombre: "x", monto: 1000 }, { nombre: "y", monto: 500, exento: true }]), { neto: 840, exento: 500, iva: 160, total: 1500, tasaIva: 19 });
  assert.deepEqual(computeTotals(33, [{ nombre: "x", monto: 100000 }]), { neto: 100000, exento: 0, iva: 19000, total: 119000, tasaIva: 19 });
  assert.deepEqual(computeTotals(41, [{ nombre: "x", monto: 2000 }]), { neto: 0, exento: 2000, iva: 0, total: 2000, tasaIva: 19 });
});

test("boleta sin cliente: RUT generico, sin datos personales y TED verificable", () => {
  const dte = buildDte(boletaInput(5), cafBoleta, { now: new Date("2026-11-11T14:30:00Z") });
  assert.equal(dte.documentId, "T39F5");
  assert.match(dte.dteXml, /<Receptor><RUTRecep>66666666-6<\/RUTRecep><\/Receptor>/);
  assert.doesNotMatch(dte.dteXml, /RznSocRecep/);
  assert.match(dte.dteXml, /<Totales><MntNeto>1000<\/MntNeto><IVA>190<\/IVA><MntTotal>1190<\/MntTotal><\/Totales>/);
  assert.match(dte.tedXml, /<RR>66666666-6<\/RR>/);
  assert.match(dte.tedXml, /<MNT>1190<\/MNT>/);
  assert.match(dte.dteXml, /<TmstFirma>2026-11-11T11:30:00<\/TmstFirma>/, "la hora del timbre va en hora de Chile");
  assert.ok(verifyTed(dte.tedXml, cafBoleta.publicKey));

  const tampered = dte.tedXml.replace("<MNT>1190</MNT>", "<MNT>990</MNT>");
  assert.equal(verifyTed(tampered, cafBoleta.publicKey), false);
});

test("validaciones: folio fuera de rango, CAF de otro tipo y factura sin receptor", () => {
  assert.throws(() => buildDte(boletaInput(101), cafBoleta), /no esta en el rango/);
  assert.throws(() => buildDte(boletaInput(1), cafFactura), /CAF es de tipo 33/);
  assert.throws(() => buildDte(facturaInput(1, { receptor: null }), cafFactura), (error: unknown) => error instanceof DteValidationError && error.issues.includes("Facturas y notas requieren receptor"));
  assert.throws(() => buildDte(facturaInput(1, { emisor: { ...facturaInput().emisor, acteco: [] } }), cafFactura), /Acteco/);
  assert.throws(() => buildDte(boletaInput(1, { items: [{ nombre: "x", monto: 10.5 }] }), cafBoleta), /entero/);
});

test("sobre de boletas: cumple EnvioBOLETA_v11.xsd y las firmas validan", async () => {
  const docs = [buildDte(boletaInput(1), cafBoleta), buildDte(boletaInput(2, { items: [{ nombre: "Estacionamiento moto", monto: 590 }] }), cafBoleta)];
  const envelope = buildEnvelope(docs, envelopeOptions, cert);
  assert.equal(envelope.kind, "boleta");
  assert.match(envelope.xml, /^<\?xml version="1.0" encoding="ISO-8859-1"\?>/);
  assert.match(envelope.xml, /<SubTotDTE><TpoDTE>39<\/TpoDTE><NroDTE>2<\/NroDTE><\/SubTotDTE>/);

  const signatures = verifySignatures(envelope.xml);
  assert.deepEqual(signatures, { ok: true, count: 3, errors: [] });

  const validation = await validateAgainstSii(envelope.xml, "boleta");
  assert.equal(validation.valid, true, validation.errors.map(error => error.rawMessage).join("\n"));
});

test("sobre de facturas: cumple EnvioDTE_v10.xsd y las firmas validan", async () => {
  const envelope = buildEnvelope([buildDte(facturaInput(1), cafFactura)], envelopeOptions, cert);
  assert.equal(envelope.kind, "dte");
  assert.match(envelope.xml, /<RznSocRecep>Constructora Peñalolén &amp; Cía. Ltda.<\/RznSocRecep>/);
  assert.match(envelope.xml, /<Acteco>522130<\/Acteco>/);
  assert.match(envelope.xml, /<TasaIVA>19<\/TasaIVA><IVA>19000<\/IVA><MntTotal>119000<\/MntTotal>/);
  assert.deepEqual(verifySignatures(envelope.xml), { ok: true, count: 2, errors: [] });

  const validation = await validateAgainstSii(envelope.xml, "dte");
  assert.equal(validation.valid, true, validation.errors.map(error => error.rawMessage).join("\n"));
});

test("nota de credito que anula una boleta: valida contra el esquema", async () => {
  const caf61 = parseCaf(createTestCaf({ type: 61 }));
  const nota = buildDte(facturaInput(1, {
    type: 61,
    receptor: { rut: "66666666-6", razonSocial: "Consumidor final" },
    items: [{ nombre: "Anula boleta 5 por cobro erroneo", monto: 1000 }],
    referencias: [{ tipoDocumento: 39, folio: 5, fecha: "2026-11-11", codigo: 1, razon: "Anula boleta emitida por error" }],
  }), caf61);
  const envelope = buildEnvelope([nota], envelopeOptions, cert);
  assert.match(envelope.xml, /<Referencia><NroLinRef>1<\/NroLinRef><TpoDocRef>39<\/TpoDocRef><FolioRef>5<\/FolioRef><FchRef>2026-11-11<\/FchRef><CodRef>1<\/CodRef>/);
  const validation = await validateAgainstSii(envelope.xml, "dte");
  assert.equal(validation.valid, true, validation.errors.map(error => error.rawMessage).join("\n"));
});

test("validacion XSD: rechaza sobres que no cumplen el esquema del SII", async () => {
  const boleta = buildEnvelope([buildDte(boletaInput(1), cafBoleta)], envelopeOptions, cert).xml;
  assert.equal((await validateAgainstSii(boleta.replace("<MntTotal>1190</MntTotal>", ""), "boleta")).valid, false);
  assert.equal((await validateAgainstSii(boleta.replace("<IndServicio>3</IndServicio>", "<IndServicio>9</IndServicio>"), "boleta")).valid, false);

  const factura = buildEnvelope([buildDte(facturaInput(1), cafFactura)], envelopeOptions, cert).xml;
  assert.equal((await validateAgainstSii(factura.replace("<Acteco>522130</Acteco>", ""), "dte")).valid, false);
  assert.equal((await validateAgainstSii(factura.replace('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>', '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>'), "dte")).valid, false);
});

test("firma en contexto: el digest del Documento coincide con una canonicalizacion C14N independiente", () => {
  for (const includeSchemaLocation of [true, false]) {
    const dte = buildDte(boletaInput(9), cafBoleta);
    const envelope = buildEnvelope([dte], { ...envelopeOptions, includeSchemaLocation }, cert);
    const namespaces = includeSchemaLocation
      ? 'xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
      : 'xmlns="http://www.sii.cl/SiiDte"';
    const documento = /<Documento[\s\S]*<\/Documento>/.exec(dte.dteXml)![0].replace('<Documento ID="T39F9">', `<Documento ${namespaces} ID="T39F9">`);
    const expected = createHash("sha1").update(documento, "utf8").digest("base64");
    const digest = /<Reference URI="#T39F9">[\s\S]*?<DigestValue>([^<]+)<\/DigestValue>/.exec(envelope.xml)![1];
    assert.equal(digest, expected, `includeSchemaLocation=${includeSchemaLocation}`);
  }
});

test("codificacion: el sobre sale en ISO-8859-1 con tildes y enie correctas", () => {
  const envelope = buildEnvelope([buildDte(boletaInput(3), cafBoleta)], envelopeOptions, cert);
  assert.ok(envelope.bytes.includes(Buffer.from([0xd1])), "Ñ como byte 0xD1");
  assert.ok(!envelope.bytes.includes(Buffer.from("Ñ", "utf8")), "sin secuencias UTF-8");
  assert.equal(decodeLatin1(envelope.bytes), envelope.xml);
  assert.match(envelope.xml, /<CmnaOrigen>Ñuñoa<\/CmnaOrigen>/);
});

test("sobre: no mezcla boletas con facturas ni repite documentos", () => {
  const boleta = buildDte(boletaInput(1), cafBoleta);
  assert.throws(() => buildEnvelope([boleta, buildDte(facturaInput(1), cafFactura)], envelopeOptions, cert), /mezclar/);
  assert.throws(() => buildEnvelope([boleta, boleta], envelopeOptions, cert), /repetidos/);
});

test("PDF417: genera la imagen del timbre", async () => {
  const dte = buildDte(boletaInput(4), cafBoleta);
  const png = await tedToPng(dte.tedBarcode);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
