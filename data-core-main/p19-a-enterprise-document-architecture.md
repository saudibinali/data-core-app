# P19-A — Enterprise Document Architecture

**Date:** 2026-05-19  
**Type:** Architecture foundation only.

**Principle (P18-A):** Extend canonical workspace-scoped models — **no** parallel document portal or `tenant_id` on operational tables.

---

## A. Document domains

| Domain | Current artifacts | Canonical direction |
|--------|-------------------|---------------------|
| HR documents | `hr_employee_documents`, `hr_document_types` | Link to unified `documents` registry |
| Payroll reports | (future) | `generated_reports` + storage key |
| Attendance exports | HR XLSX export routes | `export_jobs` + stored artifact |
| Workflow attachments | Workflow step payloads | `documents` with `source_type=workflow` |
| Employee files | Same as HR documents | Single employee folder tree |
| Generated PDFs | Commercial invoice PDFs only | Generalize `generated_reports` |
| Excel imports/exports | `hr.ts` xlsx, attendance import | `import_jobs` / `export_jobs` |
| Contracts | `hr_employee_contracts.attachments` JSONB | Migrate to `document_versions` refs |
| Signed documents | Not implemented | `documents.signature_status` + external provider hook |

**Fragmentation today:**

- `object_path` (HR), `storage_path` (forms), `storage_key` (commercial), inline JSON (messages, contracts), `attachment_urls` (leave)

**Target:** One **workspace document registry** with typed links to domain entities.

---

## B. Canonical document lifecycle

```text
Upload → Scan/Validate → Store → Version → Access → Export → Archive → Retention → Audit
```

| Stage | Responsibility |
|-------|----------------|
| **Upload** | Authenticated presign; MIME + size policy; virus scan hook |
| **Scan/Validate** | ClamAV or cloud AV (async); block on fail |
| **Store** | Object storage with `workspace_id` prefix |
| **Version** | Immutable blobs; `document_versions.version_number` |
| **Access** | RBAC + signed download URL |
| **Export** | Copy or transform (PDF/zip) via export job |
| **Archive** | Soft-delete; hidden from default lists |
| **Retention** | Policy-driven purge after legal hold release |
| **Audit** | `document_access_logs` every download/view |

**States:** `uploading` → `active` → `archived` → `purged` (terminal).

---

## C. Workspace storage isolation

| Aspect | Rule |
|--------|------|
| **Prefix** | `{workspace_id}/{domain}/{entity_id}/{document_id}/{version}` |
| **Ownership** | `documents.workspace_id` NOT NULL; `created_by_user_id` |
| **Retention** | Per-workspace policy table (years per doc type) |
| **Soft delete** | `deleted_at`; blob retained until retention job |
| **Hard purge** | Admin + compliance approval only |
| **Quota** | Enforce `workspace_quota_limits` (indicator today → enforcement P19-B+) |
| **Cross-workspace** | Impossible via API if all queries filter `workspace_id` |

**Storage backends (planned abstraction):**

- Phase 1: GCS-compatible (existing `objectStorage.ts`)
- Phase 2: S3 / Azure Blob via adapter
- Commercial PDFs: migrate from local disk to same adapter

---

## D. File capabilities

| Capability | Priority | Notes |
|------------|----------|-------|
| PDF preview | P19-C+ | Signed URL + browser viewer |
| Excel preview | P19-C+ | Server-side preview or download-only initially |
| Export engine | P19-B+ | Reuse `xlsx`; add job queue |
| Import engine | P19-B+ | Extend HR import preview/confirm pattern |
| Attachments | P19-B | Unified attach API for leave, forms, workflows |
| Versioning | P19-C | New version on re-upload |
| Metadata | P19-B | JSONB `metadata` + indexed keys |
| Tagging | P19-C | `document_tags` many-to-many |

---

## E. Future AI hooks (not implemented in P19-A)

| Hook | Use case |
|------|----------|
| OCR | Scan ID/passport for HR onboarding |
| Document parsing | Extract fields from uploaded contracts |
| Payroll extraction | PDF payslip → structured lines |
| Attendance import parsing | Messy Excel → normalized rows |
| Anomaly detection | Unusual export volume, bulk download |

**Integration point:** Post-upload async job on `documents` row (`ai_processing_status`).

---

## Relationship to P18 leave attachments

`leave_requests.attachment_urls` → migrate to `documents` linked via `entity_type=leave_request` in P19+ migration phase (not P19-A).

---

**Confirmation:** No file engine implementation in P19-A.
