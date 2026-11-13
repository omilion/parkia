import jsQR from 'jsqr';
import { TICKET_TOKEN_PATTERN } from '../../../../shared/schemas/operator';

/**
 * Lectura del QR del ticket con la cámara. Usa `BarcodeDetector` cuando el navegador lo trae (Chrome en
 * Android) y, si no, decodifica los cuadros con jsQR (puro JavaScript, sin WASM ni red: funciona sin conexión).
 */

export class CameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CameraError';
  }
}

const TOKEN_IN_TEXT = /(t_[A-Za-z0-9_-]{20,48})/;

/** El QR del ticket es la URL de pago (`https://.../pagar/t_xxxx`); se acepta también el token solo. */
export function extractTicketToken(text: string): string | null {
  const match = TOKEN_IN_TEXT.exec(text.trim());
  return match && TICKET_TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

/** Decodifica un cuadro de imagen (píxeles RGBA). Devuelve el texto del QR o null. */
export function decodeQrFromPixels(pixels: Uint8ClampedArray, width: number, height: number): string | null {
  return jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

export type FrameDecoder = (video: HTMLVideoElement) => Promise<string | null>;

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };

export function nativeFrameDecoder(detector: BarcodeDetectorLike): FrameDecoder {
  return async video => (await detector.detect(video))[0]?.rawValue ?? null;
}

/** Dibuja el cuadro en un canvas reducido (máx. 640 px) y lo decodifica con jsQR. */
export function canvasFrameDecoder(): FrameDecoder {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  return async video => {
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    return decodeQrFromPixels(frame.data, frame.width, frame.height);
  };
}

export function defaultFrameDecoder(): FrameDecoder {
  const Detector = (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  if (Detector) {
    try { return nativeFrameDecoder(new Detector({ formats: ['qr_code'] })); } catch { /* formato no soportado: se usa jsQR */ }
  }
  return canvasFrameDecoder();
}

export type QrScan = { stop(): void };

type ScanDeps = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  decoder?: FrameDecoder;
  intervalMs?: number;
};

function describeCameraError(error: unknown) {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador o escribe la patente.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Este dispositivo no tiene una cámara disponible.';
  if (name === 'NotReadableError') return 'La cámara está en uso por otra aplicación.';
  return 'No se pudo abrir la cámara.';
}

/**
 * Abre la cámara trasera en `video` y llama a `onText` con cada QR leído (como máximo cada 120 ms).
 * Si `onText` devuelve true, el escaneo se detiene y la cámara se apaga.
 */
export async function startQrScan(video: HTMLVideoElement, onText: (text: string) => boolean | void, deps: ScanDeps = {}): Promise<QrScan> {
  const getUserMedia = deps.getUserMedia ?? (navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices));
  if (!getUserMedia) throw new CameraError('Este navegador no permite usar la cámara (hace falta una conexión segura https).');

  let stream: MediaStream;
  try {
    stream = await getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
  } catch (error) {
    throw new CameraError(describeCameraError(error));
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  };

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try { await video.play(); } catch { stop(); throw new CameraError('No se pudo iniciar la vista de la cámara.'); }

  const decoder = deps.decoder ?? defaultFrameDecoder();
  const tick = async () => {
    if (stopped) return;
    try {
      const text = await decoder(video);
      if (text && onText(text) === true) { stop(); return; }
    } catch { /* un cuadro que no se pudo leer no detiene el escaneo */ }
    if (!stopped) timer = setTimeout(tick, deps.intervalMs ?? 120);
  };
  timer = setTimeout(tick, 0);
  return { stop };
}
