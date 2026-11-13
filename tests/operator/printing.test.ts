import assert from "node:assert/strict";
import { test } from "node:test";
import { entryTicketDocument, exitReceiptDocument, formatDateTime, formatDuration } from "../../src/features/operator/printing/document";
import {
  bitmapFromRgba, centerOnPaper, encodeCp858, fitBitmap, PAPER, qrBitmap, rasterCommands, renderEscPos, rowLine, wrapText, type Bitmap,
} from "../../src/features/operator/printing/escpos";
import { renderReceiptHtml } from "../../src/features/operator/printing/html";
import { PrinterManager } from "../../src/features/operator/printing/printer";
import { BLE_PRINTER_SERVICES, connectBluetooth, connectUsb, PrinterConnectionError, reconnectUsb, type PrinterTransport } from "../../src/features/operator/printing/transports";

const bytesOf = (text: string) => [...Buffer.from(text, "latin1")];
const indexOfSeq = (haystack: Uint8Array, needle: number[], from = 0) => {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer; return i; }
  return -1;
};
const solid = (width: number, height: number, value = 1): Bitmap => ({ width, height, data: new Uint8Array(width * height).fill(value) });

const entryDoc = (payUrl: string | null = "https://app.parkia.cl/pagar/t_abcdefghijklmnopqrstuvwx") => entryTicketDocument({
  company: "Estacionamientos Ñuñoa SpA", branch: "Casa Matriz", plate: "ABCD12", entryAt: new Date("2026-11-13T13:15:00Z"), spaceName: "A-01",
  vehicleLabel: "Auto", payUrl, timeZone: "America/Santiago",
});

// ------------------------------------------------------------------ codificación y texto
test("CP858: acentos y ñ del español se codifican en un byte; lo desconocido sale como ?", () => {
  assert.deepEqual(encodeCp858("Año ¿Qué? ÁÉÍÓÚ ü"), [0x41, 0xa4, 0x6f, 0x20, 0xa8, 0x51, 0x75, 0x82, 0x3f, 0x20, 0xb5, 0x90, 0xd6, 0xe0, 0xe9, 0x20, 0x81]);
  assert.deepEqual(encodeCp858("Ñandú 5°"), [0xa5, 0x61, 0x6e, 0x64, 0xa3, 0x20, 0x35, 0xf8]);
  assert.deepEqual(encodeCp858("日本"), [0x3f, 0x3f], "caracteres fuera de la tabla no rompen la impresión");
  assert.deepEqual(encodeCp858("a\nb"), [0x61, 0x0a, 0x62]);
});

test("wrapText corta por palabras, parte palabras largas y respeta saltos", () => {
  assert.deepEqual(wrapText("uno dos tres cuatro", 9), ["uno dos", "tres", "cuatro"]);
  assert.deepEqual(wrapText("abcdefghijkl", 5), ["abcde", "fghij", "kl"]);
  assert.deepEqual(wrapText("línea uno\nlínea dos", 32), ["línea uno", "línea dos"]);
  for (const line of wrapText("Conserve este ticket. En caso de pérdida se cobra el tiempo real de permanencia.", 32)) assert.ok(line.length <= 32);
});

test("rowLine ocupa exactamente el ancho y nunca recorta el monto", () => {
  for (const columns of [32, 48]) {
    assert.equal(rowLine("Entrada", "13-11-2026 10:15", columns).length, columns);
    assert.equal(rowLine("TOTAL", "$12.500", columns).length, columns);
  }
  assert.ok(rowLine("Un nombre de campo larguísimo que no cabe", "$12.500", 32).endsWith("$12.500"));
  assert.equal(rowLine("Un nombre de campo larguísimo que no cabe", "$12.500", 32).length, 32);
  assert.match(rowLine("a", "b", 10), /^a {8}b$/);
});

// ------------------------------------------------------------------ imágenes
test("trama GS v 0: cabecera, bit más alto a la izquierda y franjas de 64 filas", () => {
  const bitmap: Bitmap = { width: 10, height: 2, data: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1, 1, 0, /* fila 2 */ 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]) };
  assert.deepEqual(rasterCommands(bitmap), [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0b10000001, 0b10000000, 0b01000000, 0b01000000]);

  const tall = rasterCommands(solid(8, 130));
  const headers: number[][] = [];
  for (let i = indexOfSeq(Uint8Array.from(tall), [0x1d, 0x76, 0x30, 0x00]); i !== -1; i = indexOfSeq(Uint8Array.from(tall), [0x1d, 0x76, 0x30, 0x00], i + 1)) headers.push(tall.slice(i + 4, i + 8));
  assert.deepEqual(headers, [[1, 0, 64, 0], [1, 0, 64, 0], [1, 0, 2, 0]]);
  assert.equal(tall.length, 130 + 3 * 8);
});

test("centrar, ajustar y convertir imágenes", () => {
  const centered = centerOnPaper(solid(4, 1), 12);
  assert.deepEqual([...centered.data], [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
  assert.equal(centerOnPaper(solid(20, 1), 12).width, 20, "una imagen más ancha que el papel no se toca aquí");

  const wide = solid(8, 4);
  const fitted = fitBitmap(wide, 4);
  assert.deepEqual([fitted.width, fitted.height], [4, 2]);
  assert.ok([...fitted.data].every(value => value === 1));
  assert.equal(fitBitmap(solid(3, 3), 10).width, 3);
  // Un patrón fino se promedia: mitad negro mitad blanco sigue siendo negro (umbral 0.5).
  const stripes: Bitmap = { width: 4, height: 1, data: Uint8Array.from([1, 0, 0, 0]) };
  assert.deepEqual([...fitBitmap(stripes, 2).data], [1, 0]);

  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 200, 200, 200, 255, 10, 10, 10, 0]);
  assert.deepEqual([...bitmapFromRgba(rgba, 4, 1).data], [1, 0, 0, 0], "oscuro y opaco es negro; blanco, gris claro y transparente no");
});

test("QR: zona silenciosa de 4 módulos, patrón de posición y ancho que cabe en el papel", () => {
  for (const paper of [58, 80] as const) {
    const qr = qrBitmap("https://app.parkia.cl/pagar/t_abcdefghijklmnopqrstuvwx", PAPER[paper].dots);
    assert.equal(qr.width, qr.height);
    assert.ok(qr.width <= PAPER[paper].dots * 0.8, `cabe en ${paper} mm`);
    // La primera fila y la primera columna son blancas (zona silenciosa).
    for (let x = 0; x < qr.width; x++) assert.equal(qr.data[x], 0);
    for (let y = 0; y < qr.height; y++) assert.equal(qr.data[y * qr.width], 0);
    assert.ok(qr.data.some(value => value === 1));
  }
  const small = qrBitmap("x", 384);
  const moduleSize = small.width / (21 + 8); // QR versión 1: 21 módulos + zona silenciosa
  assert.equal(Number.isInteger(moduleSize), true);
  assert.equal(small.data[(4 * moduleSize) * small.width + 4 * moduleSize], 1, "esquina del patrón de posición superior izquierdo");
});

// ------------------------------------------------------------------ documentos y ESC/POS completo
test("ticket de entrada: ambos anchos de papel, texto en CP858, QR como trama del ancho exacto y corte", async () => {
  for (const paper of [58, 80] as const) {
    const bytes = await renderEscPos(entryDoc(), { paper });
    assert.deepEqual([...bytes.slice(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 19], "reinicia y elige CP858");
    assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 0x42, 0x00], "termina con corte");
    assert.ok(indexOfSeq(bytes, bytesOf("ABCD12")) > 0, "lleva la patente");
    assert.ok(indexOfSeq(bytes, [0xa5, 0x75, 0xa4, 0x6f, 0x61]) > 0, "Ñuñoa en CP858");
    const raster = indexOfSeq(bytes, [0x1d, 0x76, 0x30, 0x00]);
    assert.ok(raster > 0, "el QR va como imagen");
    assert.equal(bytes[raster + 4] + bytes[raster + 5] * 256, PAPER[paper].dots / 8, "la trama ocupa todo el ancho del papel (centrada)");
  }
  const sinQr = await renderEscPos(entryDoc(null), { paper: 80 });
  assert.equal(indexOfSeq(sinQr, [0x1d, 0x76, 0x30, 0x00]), -1, "sin enlace de pago no hay QR");
});

test("ticket de entrada: ninguna línea de texto supera las columnas del papel", async () => {
  const doc = entryDoc();
  for (const paper of [58, 80] as const) {
    const columns = PAPER[paper].columns;
    for (const block of doc.blocks) {
      if (block.type === "text") for (const line of wrapText(block.text, Math.floor(columns / (block.size ?? 1)))) assert.ok(line.length <= columns / (block.size ?? 1), line);
      if (block.type === "row") assert.equal(rowLine(block.left, block.right, columns).length, columns);
    }
  }
});

test("comprobante de salida: con boleta imprime folio y timbre como imagen reducida al papel; sin boleta avisa", async () => {
  const base = { company: "Parkia SpA", companyRut: "76.123.456-7", branch: "Centro", plate: "ZZ1234", entryAt: new Date("2026-11-13T12:00:00Z"), paidAt: new Date("2026-11-13T13:30:00Z"), durationMins: 90, amount: 4500, methodLabel: "Efectivo", timeZone: "America/Santiago" };
  const withBoleta = exitReceiptDocument({ ...base, boleta: { folio: 4821, typeLabel: "Boleta Electrónica", tedPngBase64: "AAAA" } });
  assert.ok(withBoleta.blocks.some(block => block.type === "text" && block.text === "BOLETA ELECTRÓNICA N° 4821"));
  assert.ok(withBoleta.blocks.some(block => block.type === "image" && /Timbre Electrónico SII/.test(block.caption ?? "")));

  let loaded = "";
  const bytes = await renderEscPos(withBoleta, { paper: 58 }, async png => { loaded = png; return solid(700, 40); });
  assert.equal(loaded, "AAAA");
  const raster = indexOfSeq(bytes, [0x1d, 0x76, 0x30, 0x00]);
  assert.equal(bytes[raster + 4], 48, "700 puntos de timbre se reducen a los 384 del papel de 58 mm");
  assert.ok(indexOfSeq(bytes, bytesOf("$4.500")) > 0);

  const offline = exitReceiptDocument({ ...base, boleta: null });
  assert.ok(offline.blocks.some(block => block.type === "text" && block.text === "COMPROBANTE DE PAGO"));
  assert.ok(offline.blocks.some(block => block.type === "text" && /boleta electrónica se emite/.test(block.text)));
  assert.equal(offline.blocks.some(block => block.type === "image"), false);
  assert.equal(indexOfSeq(await renderEscPos(offline, { paper: 80 }, async () => solid(1, 1)), [0x1d, 0x76, 0x30, 0x00]), -1);
});

test("formato de fecha y duración", () => {
  assert.equal(formatDateTime(new Date("2026-11-13T13:15:00Z"), "America/Santiago"), "13-11-2026 10:15");
  assert.equal(formatDateTime(new Date("2026-07-01T04:05:00Z"), "America/Santiago"), "01-07-2026 00:05", "hora de invierno en Chile (UTC-4)");
  assert.equal(formatDuration(95), "1 h 35 min");
  assert.equal(formatDuration(7), "7 min");
});

// ------------------------------------------------------------------ HTML de respaldo
test("HTML: mide el papel, escapa el contenido y embebe el QR", async () => {
  const doc = entryTicketDocument({ company: "<script>alert(1)</script> & Cía", branch: "Sur", plate: "AB\"CD", entryAt: new Date(), spaceName: null, vehicleLabel: "Auto", payUrl: "https://app.parkia.cl/pagar/t_abcdefghijklmnopqrstuvwx", timeZone: "America/Santiago" });
  const html = await renderReceiptHtml(doc, 58);
  assert.match(html, /@page\{size:58mm auto/);
  assert.match(html, /lang="es-CL"/);
  assert.ok(!html.includes("<script>"), "el nombre de la empresa no inyecta HTML");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cía"));
  assert.ok(html.includes("AB&quot;CD"));
  assert.match(html, /<img alt="Código QR de pago" src="data:image\/png;base64,/);
  assert.match(await renderReceiptHtml(doc, 80), /size:80mm auto/);
});

// ------------------------------------------------------------------ transportes
test("Bluetooth: busca el canal de escritura, envía en trozos de 100 bytes y avisa si se desconecta", async () => {
  const written: number[][] = [];
  const characteristic = { properties: { write: false, writeWithoutResponse: true }, writeValueWithoutResponse: async (chunk: Uint8Array) => { written.push([...chunk]); } };
  const notWritable = { properties: { write: false, writeWithoutResponse: false } };
  const listeners: Record<string, () => void> = {};
  const gatt = { connected: true, disconnect() { this.connected = false; }, connect: async () => ({ connected: true, getPrimaryServices: async () => [{ getCharacteristics: async () => [notWritable] }, { getCharacteristics: async () => [notWritable, characteristic] }] }) };
  const requested: unknown[] = [];
  const api = { requestDevice: async (options: unknown) => { requested.push(options); return { name: "MPT-II", gatt, addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; } }; } };
  let pauses = 0;
  const transport = await connectBluetooth(api as never, async () => { pauses += 1; });
  assert.deepEqual([transport.kind, transport.name], ["bluetooth", "MPT-II"]);
  assert.deepEqual((requested[0] as { optionalServices: string[] }).optionalServices, [...BLE_PRINTER_SERVICES]);

  const data = Uint8Array.from({ length: 250 }, (_, i) => i % 256);
  await transport.write(data);
  assert.deepEqual(written.map(chunk => chunk.length), [100, 100, 50]);
  assert.deepEqual(written.flat(), [...data]);
  assert.equal(pauses, 3, "pausa entre trozos: las térmicas baratas pierden bytes sin ella");

  let dropped = false;
  transport.onDisconnect = () => { dropped = true; };
  listeners.gattserverdisconnected();
  assert.equal(dropped, true);
  gatt.connected = false;
  await assert.rejects(() => transport.write(Uint8Array.of(1)), PrinterConnectionError);
});

test("Bluetooth: sin canal de escritura o sin soporte se explica y no deja la conexión abierta", async () => {
  let disconnected = false;
  const gatt = { connected: true, disconnect() { disconnected = true; }, connect: async () => ({ connected: true, getPrimaryServices: async () => [{ getCharacteristics: async () => [{ properties: { write: false, writeWithoutResponse: false } }] }] }) };
  const api = { requestDevice: async () => ({ name: "Audífonos", gatt, addEventListener: () => undefined }) };
  await assert.rejects(() => connectBluetooth(api as never), /No se encontró un canal de impresión/);
  assert.equal(disconnected, true);
  await assert.rejects(() => connectBluetooth(undefined, undefined), PrinterConnectionError);
});

test("USB: usa la interfaz de impresora, envía en bloques de 16 KB y detecta rechazos", async () => {
  const sent: Array<{ endpoint: number; size: number }> = [];
  let claimed = -1;
  let status = "ok";
  const device = {
    productName: "TM-T20", vendorId: 0x04b8, productId: 0x0e15, opened: false,
    configuration: { interfaces: [
      { interfaceNumber: 0, alternates: [{ interfaceClass: 3, endpoints: [{ direction: "out" as const, endpointNumber: 9 }] }] },
      { interfaceNumber: 1, alternates: [{ interfaceClass: 7, endpoints: [{ direction: "in" as const, endpointNumber: 1 }, { direction: "out" as const, endpointNumber: 2 }] }] },
    ] },
    open: async function () { this.opened = true; }, close: async () => undefined, selectConfiguration: async () => undefined,
    claimInterface: async (n: number) => { claimed = n; },
    transferOut: async (endpoint: number, data: BufferSource) => { sent.push({ endpoint, size: (data as Uint8Array).length }); return { status }; },
  };
  const api = { requestDevice: async () => device, getDevices: async () => [device] };
  const transport = await connectUsb(api as never);
  assert.deepEqual([transport.name, transport.vendorId, transport.productId, claimed], ["TM-T20", 0x04b8, 0x0e15, 1]);
  await transport.write(new Uint8Array(40_000));
  assert.deepEqual(sent, [{ endpoint: 2, size: 16384 }, { endpoint: 2, size: 16384 }, { endpoint: 2, size: 7232 }]);
  status = "stall";
  await assert.rejects(() => transport.write(Uint8Array.of(1)), /no aceptó los datos/);

  assert.ok(await reconnectUsb(0x04b8, 0x0e15, api as never));
  assert.equal(await reconnectUsb(1, 2, api as never), null);
  assert.equal(await reconnectUsb(1, 2, undefined), null);
});

// ------------------------------------------------------------------ administrador de impresora
function memoryStorage() {
  const store = new Map<string, string>();
  return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
}
function fakeTransport(options: { failWrites?: boolean } = {}) {
  const writes: Uint8Array[] = [];
  const transport: PrinterTransport = { kind: "usb", name: "Térmica de prueba", async write(data) { if (options.failWrites) throw new Error("cable suelto"); writes.push(data); }, async disconnect() {} };
  return { transport, writes };
}
const makeManager = (storage = memoryStorage()) => {
  const browserPrints: string[] = [];
  const manager = new PrinterManager({ storage, render: async (doc, paper) => Uint8Array.of(paper, doc.blocks.length), printBrowser: async doc => { browserPrints.push(doc.title); } });
  return { manager, browserPrints, storage };
};

test("impresora: sin térmica se imprime con el diálogo del sistema y la impresión automática no abre nada sola", async () => {
  const { manager, browserPrints } = makeManager();
  assert.equal(await manager.autoPrint(entryDoc()), null);
  assert.deepEqual(await manager.print(entryDoc()), { method: "browser", note: undefined });
  assert.deepEqual(browserPrints, ["Ticket de entrada ABCD12"]);
});

test("impresora: con térmica conectada imprime por ella, respeta el papel y la preferencia de impresión automática", async () => {
  const { manager, browserPrints } = makeManager();
  const { transport, writes } = fakeTransport();
  manager.useTransport(transport);
  assert.equal(manager.getState().connected, true);
  manager.setPrefs({ paper: 58 });
  assert.deepEqual(await manager.print(entryDoc()), { method: "thermal" });
  assert.equal(writes[0][0], 58, "se renderizó para papel de 58 mm");
  assert.deepEqual(await manager.autoPrint(entryDoc()), { method: "thermal" });
  manager.setPrefs({ autoPrint: false });
  assert.equal(await manager.autoPrint(entryDoc()), null);
  assert.equal(browserPrints.length, 0);
});

test("impresora: si la térmica falla se imprime igual con el sistema y se avisa", async () => {
  const { manager, browserPrints } = makeManager();
  manager.useTransport(fakeTransport({ failWrites: true }).transport);
  const result = await manager.print(entryDoc());
  assert.equal(result.method, "browser");
  assert.match(result.note ?? "", /no respondió/);
  assert.deepEqual(browserPrints, ["Ticket de entrada ABCD12"]);
  assert.equal(manager.getState().connected, false);
  assert.ok(manager.getState().error);
});

test("impresora: guarda las preferencias en el dispositivo y detecta desconexiones", async () => {
  const storage = memoryStorage();
  const { manager } = makeManager(storage);
  manager.setPrefs({ paper: 58, autoPrint: false });
  const reloaded = makeManager(storage).manager;
  assert.deepEqual([reloaded.getState().prefs.paper, reloaded.getState().prefs.autoPrint], [58, false]);
  storage.setItem("parkia.printer", "{no es json");
  assert.deepEqual(makeManager(storage).manager.getState().prefs, { paper: 80, autoPrint: true, usb: null }, "preferencias dañadas vuelven a los valores de fábrica");

  const { transport } = fakeTransport();
  manager.useTransport(transport, { vendorId: 1, productId: 2 });
  assert.deepEqual(manager.getState().prefs.usb, { vendorId: 1, productId: 2 });
  let notified = 0;
  manager.subscribe(() => { notified += 1; });
  transport.onDisconnect?.();
  assert.equal(manager.getState().connected, false);
  assert.match(manager.getState().error ?? "", /se desconectó/);
  assert.ok(notified >= 1);
});
