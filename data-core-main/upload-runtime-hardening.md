# Upload Runtime Hardening — Phase 1

## Problem addressed

- HTTP 413 from proxy/nginx vs app limit mismatch
- Missing centralized upload configuration
- HR employee documents lacked multipart upload path

## Centralized config

`artifacts/api-server/src/lib/workforce/upload-config.ts`

| Key | Default | Env override |
|-----|---------|--------------|
| `jsonBodyBytes` | 200 MB | `UPLOAD_JSON_MAX_BYTES` |
| `contractPdfBytes` | 15 MB | `UPLOAD_CONTRACT_PDF_MAX_BYTES` |
| `hrDocumentBytes` | 20 MB | `UPLOAD_HR_DOCUMENT_MAX_BYTES` |
| `invoicePdfBytes` | 15 MB | `UPLOAD_INVOICE_PDF_MAX_BYTES` |

Express body parser (`app.ts`) now uses `UPLOAD_LIMITS.jsonBodyBytes`.

## HR document upload

| Component | Path |
|-----------|------|
| Multipart parser | `parse-hr-document-upload.ts` |
| Storage | `employee-file-storage.ts` |
| Route | `POST /hr/employees/:id/documents/upload` |

Allowed types: PDF, JPEG, PNG, WebP.

413 responses include structured payload:

```json
{
  "error": "PAYLOAD_TOO_LARGE",
  "message": "...",
  "maxBytes": 20971520,
  "nginxHint": "Ensure client_max_body_size >= upload limit..."
}
```

## Nginx recommendation

```nginx
client_max_body_size 25m;
```

Set ≥ largest upload limit in your deployment.

## Existing commercial uploads

Contract/invoice PDF parsers unchanged; limits documented in shared config for ops alignment.

## Employee document schema (additive)

`hr_employee_documents` columns:

- `mime_type`
- `checksum`
- `storage_key`

Migration: `0024_workforce_canonical_foundation.sql`

## Not in Phase 1

- Full document lifecycle (versioning, retention policies)
- Virus scanning
- S3/GCS adapter switch (local filesystem foundation only)
