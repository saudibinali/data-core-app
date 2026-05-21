/**
 * @phase P15-C - Private invoice PDF storage (filesystem)
 *
 * Not served from public URLs. Access only via protected platform API routes.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { ReadStream } from "node:fs";

export const INVOICE_PDF_MIME = "application/pdf";
export const INVOICE_PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const STORAGE_ROOT = process.env.INVOICE_PDF_STORAGE_DIR
  ?? path.join(process.cwd(), "data", "invoice-documents");

export function buildStorageKey(workspaceId: number, invoiceId: number): string {
  const token = randomUUID().replace(/-/g, "");
  return `tenants/${workspaceId}/invoices/${invoiceId}/${token}.pdf`;
}

function resolveAbsolute(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/");
  if (normalized.includes("..") || !normalized.startsWith("tenants/")) {
    throw new Error("Invalid storage key");
  }
  return path.join(STORAGE_ROOT, normalized);
}

export async function ensureStorageRoot(): Promise<void> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

export function sha256Checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function saveInvoicePdf(
  storageKey: string,
  buffer: Buffer,
): Promise<{ checksum: string }> {
  if (buffer.length > INVOICE_PDF_MAX_BYTES) {
    throw new Error("PDF exceeds maximum allowed size");
  }
  const abs = resolveAbsolute(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return { checksum: sha256Checksum(buffer) };
}

export function getInvoicePdfStream(storageKey: string): ReadStream {
  const abs = resolveAbsolute(storageKey);
  return createReadStream(abs);
}

export async function getInvoicePdfBuffer(storageKey: string): Promise<Buffer> {
  const abs = resolveAbsolute(storageKey);
  return fs.readFile(abs);
}

export async function deleteInvoicePdfIfExists(storageKey: string): Promise<void> {
  try {
    const abs = resolveAbsolute(storageKey);
    await fs.unlink(abs);
  } catch {
    // ignore missing file
  }
}

export const invoiceDocumentStorage = {
  buildStorageKey,
  saveInvoicePdf,
  getInvoicePdfStream,
  getInvoicePdfBuffer,
  deleteInvoicePdfIfExists,
  sha256Checksum,
  INVOICE_PDF_MIME,
  INVOICE_PDF_MAX_BYTES,
};
