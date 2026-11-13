import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import QRCode from "qrcode";
import { PAPER, qrBitmap, type Bitmap } from "../../src/features/operator/printing/escpos";
import { CameraError, decodeQrFromPixels, extractTicketToken, nativeFrameDecoder, startQrScan } from "../../src/features/operator/scanning/qr";

const { PNG } = createRequire(import.meta.url)("pngjs") as { PNG: { sync: { read(buffer: Buffer): { data: Buffer; width: number; height: number } } } };

const TOKEN = "t_AbCdEfGhIjKlMnOpQrStUvWx";
const PAY_URL = `https://app.parkia.cl/pagar/${TOKEN}`;

/** Una imagen en blanco y negro como la vería la cámara (RGBA). `invert` simula un QR claro sobre fondo oscuro. */
function toRgba(bitmap: Bitmap, invert = false) {
  const rgba = new Uint8ClampedArray(bitmap.width * bitmap.height * 4);
  for (let i = 0; i < bitmap.data.length; i++) {
    const dark = invert ? !bitmap.data[i] : Boolean(bitmap.data[i]);
    rgba.set(dark ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  }
  return rgba;
}

test("extractTicketToken acepta la URL de pago o el token solo y rechaza lo demás", () => {
  assert.equal(extractTicketToken(PAY_URL), TOKEN);
  assert.equal(extractTicketToken(`  ${TOKEN}\n`), TOKEN);
  assert.equal(extractTicketToken(`http://192.168.1.5:8080/pagar/${TOKEN}?result=paid`), TOKEN);
  assert.equal(extractTicketToken("https://otro-sitio.cl/promo"), null);
  assert.equal(extractTicketToken("t_corto"), null);
  assert.equal(extractTicketToken("BEGIN:VCARD"), null);
  assert.equal(extractTicketToken(""), null);
  // Un código de pago de abonado (r_...) no es un ticket.
  assert.equal(extractTicketToken("https://app.parkia.cl/pagar/r_pi_AbCdEfGhIjKlMnOpQrStUvWx"), null);
});

test("el QR que imprimimos en el ticket se lee de vuelta (58 mm, 80 mm y fondo invertido)", () => {
  for (const paper of [58, 80] as const) {
    const bitmap = qrBitmap(PAY_URL, PAPER[paper].dots);
    const text = decodeQrFromPixels(toRgba(bitmap), bitmap.width, bitmap.height);
    assert.equal(text, PAY_URL, `QR de ${paper} mm`);
    assert.equal(extractTicketToken(text!), TOKEN);
    assert.equal(decodeQrFromPixels(toRgba(bitmap, true), bitmap.width, bitmap.height), PAY_URL, "también claro sobre oscuro");
  }
  assert.equal(decodeQrFromPixels(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64), null, "una imagen sin QR no devuelve nada");
});

test("el QR del ticket en HTML (PNG) también se lee de vuelta", async () => {
  const dataUrl = await QRCode.toDataURL(PAY_URL, { errorCorrectionLevel: "M", margin: 1, width: 220 });
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  assert.equal(decodeQrFromPixels(new Uint8ClampedArray(png.data), png.width, png.height), PAY_URL);
});

// ------------------------------------------------------------------ cámara
function fakeCamera() {
  const stopped: boolean[] = [];
  const stream = { getTracks: () => [{ stop: () => stopped.push(true) }] } as unknown as MediaStream;
  const video = { srcObject: null as unknown, muted: false, attrs: {} as Record<string, string>, setAttribute(name: string, value: string) { this.attrs[name] = value; }, play: async () => undefined } as unknown as HTMLVideoElement;
  return { stream, video, stopped };
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("escaneo: ignora lo que no es un ticket, se detiene al leer uno y apaga la cámara", async () => {
  const { stream, video, stopped } = fakeCamera();
  const frames = [null, "otra cosa", PAY_URL, "no debería llegar"];
  let decodes = 0;
  const seen: string[] = [];
  const scan = await startQrScan(video, text => { seen.push(text); return extractTicketToken(text) !== null; }, {
    getUserMedia: async constraints => { assert.deepEqual((constraints.video as MediaTrackConstraints).facingMode, { ideal: "environment" }); return stream; },
    decoder: async () => frames[decodes++] ?? null, intervalMs: 5,
  });
  await wait(80);
  assert.deepEqual(seen, ["otra cosa", PAY_URL]);
  assert.equal(decodes, 3, "no se siguen leyendo cuadros después del ticket");
  assert.equal(stopped.length, 1, "la cámara se apagó");
  assert.equal(video.srcObject, null);
  assert.equal(video.muted, true);
  scan.stop();
});

test("escaneo: un cuadro que falla no lo detiene y stop() lo corta", async () => {
  const { stream, video, stopped } = fakeCamera();
  let calls = 0;
  const scan = await startQrScan(video, () => false, { getUserMedia: async () => stream, intervalMs: 5, decoder: async () => { calls += 1; if (calls === 1) throw new Error("cuadro ilegible"); return null; } });
  await wait(40);
  assert.ok(calls >= 3, "siguió leyendo después del error");
  scan.stop();
  const after = calls;
  await wait(40);
  assert.equal(calls, after);
  assert.equal(stopped.length, 1);
});

test("escaneo: los errores de cámara se explican en español", async () => {
  const video = fakeCamera().video;
  const failing = (name: string) => ({ getUserMedia: async () => { throw Object.assign(new Error("x"), { name }); } });
  await assert.rejects(() => startQrScan(video, () => true, failing("NotAllowedError")), (error: CameraError) => error instanceof CameraError && /permiso/.test(error.message));
  await assert.rejects(() => startQrScan(video, () => true, failing("NotFoundError")), /no tiene una cámara/);
  await assert.rejects(() => startQrScan(video, () => true, failing("NotReadableError")), /en uso/);
  await assert.rejects(() => startQrScan(video, () => true, failing("Otra")), /No se pudo abrir la cámara/);
  await assert.rejects(() => startQrScan(video, () => true, { getUserMedia: undefined }), CameraError);
});

test("BarcodeDetector nativo: devuelve el primer valor leído", async () => {
  const decode = nativeFrameDecoder({ detect: async () => [{ rawValue: PAY_URL }, { rawValue: "otro" }] });
  assert.equal(await decode({} as HTMLVideoElement), PAY_URL);
  assert.equal(await nativeFrameDecoder({ detect: async () => [] })({} as HTMLVideoElement), null);
});
