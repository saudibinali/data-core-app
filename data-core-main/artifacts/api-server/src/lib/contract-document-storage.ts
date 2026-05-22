/**
 * Contract PDF storage (same pattern as invoice documents).
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { ReadStream } from "node:fs";

export const CONTRACT_PDF_MIME = "application/pdf";
export const CONTRACT_PDF_MAX_BYTES = 15 * 1024 * 1024;

const STORAGE_ROOT =
  process.env.CONTRACT_PDF_STORAGE_DIR ??
  path.join(process.cwd(), "data", "contract-documents");

export function buildContractStorageKey(workspaceId: number, contractId: number): string {
  const token = randomUUID().replace(/-/g, "");
  return `tenants/${workspaceId}/contracts/${contractId}/${token}.pdf`;
}

function resolveAbsolute(storageKey: string): string {
  const normalized = storageKey.replace(/\\/g, "/");
  if (normalized.includes("..") || !normalized.startsWith("tenants/")) {
    throw new Error("Invalid storage key");
  }
  return path.join(STORAGE_ROOT, normalized);
}

export function sha256Checksum(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function saveContractPdf(
  storageKey: string,
  buffer: Buffer,
): Promise<{ checksum: string }> {
  if (buffer.length > CONTRACT_PDF_MAX_BYTES) {
    throw new Error("PDF exceeds maximum allowed size");
  }
  const abs = resolveAbsolute(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return { checksum: sha256Checksum(buffer) };
}

export function getContractPdfStream(storageKey: string): ReadStream {
  return createReadStream(resolveAbsolute(storageKey));
}

export async function deleteContractPdfIfExists(storageKey: string): Promise<void> {
  try {
    await fs.unlink(resolveAbsolute(storageKey));
  } catch {
    // ignore
  }
}

export const contractDocumentStorage = {
  buildStorageKey: buildContractStorageKey,
  saveContractPdf,
  getContractPdfStream,
  deleteContractPdfIfExists,
  sha256Checksum,
  CONTRACT_PDF_MIME,
  CONTRACT_PDF_MAX_BYTES,
};
