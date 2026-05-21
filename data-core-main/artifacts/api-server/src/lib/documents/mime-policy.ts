/** P19-C — MIME allowlist and upload size policy (no malware scan in this phase). */

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "image/",
  "application/vnd.openxmlformats-",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
];

const BLOCKED_MIME = [
  "application/x-msdownload",
  "application/x-executable",
  "application/javascript",
  "text/html",
];

export function getMaxUploadBytes(): number {
  const env = process.env.DOCUMENT_MAX_UPLOAD_BYTES;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_MAX_BYTES;
}

export function validateMimeType(mimeType: string): { ok: true } | { ok: false; error: string } {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) return { ok: false, error: "mimeType is required" };
  if (BLOCKED_MIME.some((b) => normalized.startsWith(b))) {
    return { ok: false, error: "MIME type not allowed" };
  }
  if (ALLOWED_MIME_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { ok: true };
  }
  return { ok: false, error: "MIME type not in allowlist" };
}

export function validateUploadSize(sizeBytes: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "sizeBytes must be positive" };
  }
  const max = getMaxUploadBytes();
  if (sizeBytes > max) {
    return { ok: false, error: `File exceeds maximum size of ${max} bytes` };
  }
  return { ok: true };
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/\0/g, "")
    .trim()
    .slice(0, 255);
}
