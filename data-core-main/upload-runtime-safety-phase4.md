# Upload Runtime Safety — Phase 4

**Status:** Hardened (extends Phase 1)

---

## Protections

| Risk | Mitigation |
|------|------------|
| HTTP 413 | Busboy `limits.fileSize` + explicit 413 JSON response |
| Upload crashes | Non-blocking timeline/audit hooks (`.catch`) |
| Malformed files | MIME + extension dual validation |
| Unsafe uploads | Allowed types only: PDF, JPEG, PNG, WebP |
| Oversized payloads | `UPLOAD_LIMITS.hrDocumentBytes` (env: `UPLOAD_HR_DOCUMENT_MAX_BYTES`) |

## Storage safety

- Keys: `tenants/{ws}/employees/{emp}/{uuid}.{ext}`
- SHA-256 checksum stored on document row
- Local FS default; override via `HR_EMPLOYEE_FILE_STORAGE_DIR`

## Phase 4 additions

- `category_code` metadata validation (string, defaults to documentType)
- `is_signed` flag with optional `signed_at`
- Document upload → timeline + audit (non-blocking)

## Schema mismatch

Missing Phase 4 columns → **503** via `handleWorkforceRouteError` / `handleWorkforceOpsRouteError` — never HTTP 500

## Files

- `parse-hr-document-upload.ts`
- `upload-config.ts`
- `employee-file-storage.ts`
- `document-hooks.ts`

## Nginx guidance

Set `client_max_body_size` ≥ upload limit + buffer (recommend 25M for 20M HR docs).
