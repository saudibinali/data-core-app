# Employee Documents Runtime — Phase 4

**Status:** Extended (Phase 1 foundation preserved)

---

## Capabilities

| Feature | Status |
|---------|--------|
| PDF / image uploads | ✅ Phase 1 + Phase 4 metadata |
| Document categories | ✅ `category_code` + seeded `hr_document_types` |
| Signed documents | ✅ `is_signed`, `signed_at` |
| Multi-file per employee | ✅ existing + timeline events |
| Audit trail | ✅ `workforce_audit_log` + timeline |
| Secure storage | ✅ `employee-file-storage.ts` (SHA-256, size limits) |

## Schema extensions (0027)

```sql
hr_employee_documents.category_code
hr_employee_documents.is_signed
hr_employee_documents.signed_at
```

## Seeded categories

`national_id`, `passport`, `iqama`, `contract`, `certificate`, `signed_document`, `other`

## Upload endpoints (unchanged paths)

- `POST /hr/employees/:id/documents` — metadata-only create
- `POST /hr/employees/:id/documents/upload` — multipart PDF/image upload

Phase 4 hooks: `onEmployeeDocumentUploaded()` → timeline + audit

## Validation

- MIME: PDF, JPEG, PNG, WebP (`parse-hr-document-upload.ts`)
- Max size: `UPLOAD_HR_DOCUMENT_MAX_BYTES` (default 20MB)
- HTTP **413** on limit exceeded (not 500)

## Implementation

- Storage: `lib/workforce/employee-file-storage.ts`
- Hooks: `lib/workforce/operations/document-hooks.ts`
