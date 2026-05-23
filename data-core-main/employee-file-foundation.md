# Employee File Foundation — Phase 1

## Scope

Foundation only — storage, upload endpoint, schema columns. No full document lifecycle.

## Existing model

`hr_employee_documents` — metadata for employee HR files (national ID, passport, certificates, etc.)

## Phase 1 additions

### Schema columns (additive)

| Column | Purpose |
|--------|---------|
| `storage_key` | Canonical filesystem key |
| `mime_type` | Uploaded content type |
| `checksum` | SHA-256 integrity |

### Storage layer

`lib/workforce/employee-file-storage.ts`

- Root: `HR_EMPLOYEE_FILE_STORAGE_DIR` or `data/hr-employee-files`
- Key pattern: `tenants/{workspaceId}/employees/{employeeId}/{uuid}.{ext}`

### Upload API

**New:** `POST /hr/employees/:id/documents/upload`

- Multipart form: `file` + optional `name`, `documentType`
- Validates size/type via `parseHrDocumentUpload`
- Persists row with checksum + storage metadata
- Bridges to document registry when configured

**Existing:** `POST /hr/employees/:id/documents` (JSON + objectPath) — unchanged, now accepts optional `mimeType`, `checksum`, `storageKey`

## Supported file types

- PDF
- JPEG / PNG / WebP

Max size: 20 MB (configurable via `UPLOAD_HR_DOCUMENT_MAX_BYTES`)

## Not implemented (later phases)

- Document expiry workflows
- E-signature
- Contract template generation
- Bulk export / legal hold
- Version history

## Related docs

- `upload-runtime-hardening.md`
- `workforce-runtime-implementation.md`
