/**
 * Employee file storage foundation (Phase 1 — no full lifecycle).
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { ReadStream } from "node:fs";
import { UPLOAD_LIMITS } from "./upload-config";

export const HR_EMPLOYEE_FILE_MAX_BYTES = UPLOAD_LIMITS.hrDocumentBytes;

const STORAGE_ROOT =
  process.env.HR_EMPLOYEE_FILE_STORAGE_DIR ??
  path.join(process.cwd(), "data", "hr-employee-files");

export function buildEmployeeFileStorageKey(
  workspaceId: number,
  employeeId: number,
  ext: string,
): string {
  const token = randomUUID().replace(/-/g, "");
  const safeExt = ext.replace(/[^a-z0-9.]/gi, "").slice(0, 10) || "bin";
  return `tenants/${workspaceId}/employees/${employeeId}/${token}.${safeExt}`;
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

export async function saveEmployeeFile(
  storageKey: string,
  buffer: Buffer,
): Promise<{ checksum: string }> {
  if (buffer.length > HR_EMPLOYEE_FILE_MAX_BYTES) {
    throw new Error("File exceeds maximum allowed size");
  }
  const abs = resolveAbsolute(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return { checksum: sha256Checksum(buffer) };
}

export function openEmployeeFileReadStream(storageKey: string): ReadStream {
  return createReadStream(resolveAbsolute(storageKey));
}

export async function deleteEmployeeFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(resolveAbsolute(storageKey));
  } catch {
    /* best-effort */
  }
}

export function objectPathFromStorageKey(storageKey: string): string {
  return storageKey;
}
