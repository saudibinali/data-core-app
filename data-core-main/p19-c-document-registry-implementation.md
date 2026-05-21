# P19-C — Document Registry Implementation

**Date:** 2026-05-19  
**Phase:** P19-C (Enterprise Document Registry & Secure File Infrastructure)

---

## 1. Migrations

**File:** `lib/db/drizzle/0003_document_registry.sql`

| Table | Purpose |
|-------|---------|
| `documents` | Canonical registry row per logical file |
| `document_versions` | Immutable version blobs |
| `document_folders` | Minimal folder hierarchy |
| `document_tags` | Labels per document |
| `document_access_logs` | View/download audit |
| `generated_reports` | Report output metadata (no PDF engine) |
| `import_jobs` | Import run tracking |
| `export_jobs` | Export run tracking |

All tables include `workspace_id` (except versions via FK). Soft delete via `documents.deleted_at`. Classification + `is_confidential` flags.

**No legacy file migration** in this phase.

---

## 2. Upload flow

```
POST /attachments/upload-request
  ├─ validate MIME (allowlist) + size
  ├─ INSERT documents (status=uploading)
  ├─ INSERT document_versions (v1)
  ├─ presign PUT → uploads/ws-{id}/docs/{domain}/{entityType}/{entityId}/{docId}/v1
  └─ return { documentId, uploadUrl, objectPath }

Client PUT → GCS

POST /attachments/:id/complete
  └─ status → active
```

**Legacy presign** (`POST /storage/uploads/request-url`) unchanged for existing UIs.

**Bridge** (`document-bridge.ts`): when legacy routes save `object_path` / `attachment_urls`, a parallel `documents` row is registered via `registerExistingFile()` without removing legacy columns.

---

## 3. Download flow

```
GET /attachments/:id/download
  ├─ workspace + permission check (confidential rules)
  ├─ GCS signed GET URL (TTL, default 900s)
  ├─ JWT download token (typ=doc_dl)
  └─ INSERT document_access_logs (download)

GET /attachments/download/stream?token=
  └─ re-validates JWT + streams via ObjectStorageService
```

**No public downloads** for registry paths. `/storage/public-objects/*` unchanged for intentional public assets only.

---

## 4. Storage structure

```
/objects/uploads/ws-{workspaceId}/docs/{domain}/{entityType}/{entityId}/{documentId}/v{version}
```

Legacy flat uploads remain under:

```
/objects/uploads/ws-{workspaceId}/{uuid}
```

---

## 5. Attachment bridge

| Legacy surface | Bridge hook | Legacy fields kept |
|----------------|-------------|-------------------|
| `POST /hr/employees/:id/documents` | `bridgeHrEmployeeDocument` | `object_path`, `file_name` |
| `POST /hr/employees/:id/contracts` | `bridgeContractAttachments` | `attachments` JSONB |
| `POST /hr/leave-requests` | `bridgeLeaveAttachments` | `attachment_urls` JSONB |

New uploads should prefer `POST /attachments/upload-request`.

---

## 6. Folder foundation

Auto-provisioned on first document (no tree UI):

- `employee/{employeeId}/root`
- `workspace/shared`
- `payroll/payroll`
- `reports/generated`

---

## 7. Security enforcement

| Control | Implementation |
|---------|----------------|
| MIME allowlist | `mime-policy.ts` |
| Max size | `DOCUMENT_MAX_UPLOAD_BYTES` (default 25MB) |
| Workspace isolation | `isObjectInWorkspace` + `workspace_id` on all queries |
| Confidential | `is_confidential` + HR/admin access rules |
| Signed URL TTL | `DOCUMENT_DOWNLOAD_TTL_SEC` (default 900s) |
| Access logging | `document_access_logs` |

Malware scanning: **not implemented** (hook deferred per P19-A).

---

## 8. APIs

| Method | Path |
|--------|------|
| POST | `/attachments/upload-request` |
| POST | `/attachments/:id/complete` |
| GET | `/attachments?entityType=&entityId=` |
| GET | `/attachments/:id/download` |
| GET | `/attachments/download/stream?token=` |
| POST | `/attachments/:id/archive` |
| POST | `/import-jobs` |
| GET | `/import-jobs/:id` |
| POST | `/export-jobs` |
| POST | `/generated-reports` |
| PATCH | `/generated-reports/:id` |

---

## 9. Remaining legacy gaps

- Bulk migration of existing `hr_employee_documents` / form JSON paths
- `form_submission_files` write path still unused
- Commercial invoice PDFs still on local filesystem
- Message/calendar inline attachments
- PDF rendering engine (P19-D)
- Malware scan pipeline
- Document portal / tree UI

---

## 10. Smoke tests

`artifacts/api-server/src/routes/__tests__/document-registry.smoke.test.ts`

Run: `DATABASE_URL=... pnpm --filter api-server vitest run document-registry`
