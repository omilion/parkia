import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { getParkiaEnv } from "./env";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export type StoredReceipt = {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export function getStorageRoot() {
  return getParkiaEnv("PARKIA_STORAGE_PATH", "TIOLUCHIN_STORAGE_PATH", path.join(process.cwd(), "storage"));
}

export function resolveStoredFile(relativePath: string) {
  const storageRoot = path.resolve(getStorageRoot());
  const absolutePath = path.resolve(storageRoot, relativePath);
  if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Ruta de archivo inválida");
  return absolutePath;
}

function cleanFileName(fileName: string) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "receipt";
}

function extensionFor(mimeType: string, fileName: string) {
  const current = path.extname(fileName).toLowerCase();
  if ([".pdf", ".jpg", ".jpeg", ".png"].includes(current)) return current;
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

export function storePaymentReceipt(input: {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}): StoredReceipt {
  return storeDocumentFile({ ...input, folder: "payment-receipts" });
}

export function storeDocumentFile(input: {
  fileName: string;
  mimeType: string;
  dataBase64: string;
  folder: string;
}): StoredReceipt {
  const fileName = cleanFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!ALLOWED_RECEIPT_TYPES.has(mimeType)) throw new Error("Tipo de comprobante no soportado");

  const fileBuffer = Buffer.from(input.dataBase64, "base64");
  if (fileBuffer.length === 0) throw new Error("Comprobante vacío");
  if (fileBuffer.length > MAX_RECEIPT_BYTES) throw new Error("El comprobante supera 5MB");

  const receiptDir = path.join(getStorageRoot(), input.folder);
  mkdirSync(receiptDir, { recursive: true });

  const storedName = `${randomUUID()}${extensionFor(mimeType, fileName)}`;
  const absolutePath = path.join(receiptDir, storedName);
  writeFileSync(absolutePath, fileBuffer, { flag: "wx" });

  return {
    filePath: path.join(input.folder, storedName).replace(/\\/g, "/"),
    fileName,
    mimeType,
    sizeBytes: fileBuffer.length,
  };
}

export function storeDocumentBuffer(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  folder: string;
}): StoredReceipt {
  const fileName = cleanFileName(input.fileName);
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!ALLOWED_RECEIPT_TYPES.has(mimeType)) throw new Error("Tipo de comprobante no soportado");
  if (input.buffer.length === 0) throw new Error("Comprobante vacío");
  if (input.buffer.length > MAX_RECEIPT_BYTES) throw new Error("El comprobante supera 5MB");

  const receiptDir = path.join(getStorageRoot(), input.folder);
  mkdirSync(receiptDir, { recursive: true });

  const storedName = `${randomUUID()}${extensionFor(mimeType, fileName)}`;
  const absolutePath = path.join(receiptDir, storedName);
  writeFileSync(absolutePath, input.buffer, { flag: "wx" });

  return {
    filePath: path.join(input.folder, storedName).replace(/\\/g, "/"),
    fileName,
    mimeType,
    sizeBytes: input.buffer.length,
  };
}
