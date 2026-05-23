/**
 * Centralized upload limits for production-safe multipart handling.
 * Override via env when nginx/proxy limits differ.
 */
export const UPLOAD_LIMITS = {
  /** JSON/urlencoded body — keep high for bulk imports; proxy may be lower. */
  jsonBodyBytes: parseInt(process.env.UPLOAD_JSON_MAX_BYTES ?? "", 10) || 200 * 1024 * 1024,
  /** Contract PDF uploads */
  contractPdfBytes: parseInt(process.env.UPLOAD_CONTRACT_PDF_MAX_BYTES ?? "", 10) || 15 * 1024 * 1024,
  /** HR employee documents (PDF + common image types) */
  hrDocumentBytes: parseInt(process.env.UPLOAD_HR_DOCUMENT_MAX_BYTES ?? "", 10) || 20 * 1024 * 1024,
  /** Invoice PDF uploads */
  invoicePdfBytes: parseInt(process.env.UPLOAD_INVOICE_PDF_MAX_BYTES ?? "", 10) || 15 * 1024 * 1024,
} as const;

export const HR_DOCUMENT_ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const NGINX_UPLOAD_HINT =
  "Ensure client_max_body_size >= upload limit (e.g. 25m) in nginx/reverse proxy.";

export function payloadTooLargeResponse(maxBytes: number, label: string) {
  return {
    error: "PAYLOAD_TOO_LARGE",
    message: `${label} exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))}MB).`,
    maxBytes,
    nginxHint: NGINX_UPLOAD_HINT,
  };
}
