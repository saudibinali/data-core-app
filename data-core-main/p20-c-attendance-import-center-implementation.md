# P20-C — Attendance Import Center Implementation

## Overview

Phase 20-C delivers an **Enterprise Attendance Import Center** on top of the P20-B Workforce Event Platform. Imports flow through server-side parsing, `import_jobs` audit, dry-run validation, canonical ingestion, and reconciliation—while legacy `hr_attendance` read paths remain unchanged.

## Template System

**`ImportTemplateRegistry`** (`import/import-template-registry.ts`)

| Key | Version |
|-----|---------|
| `attendance.period.default.v1` | 1.0.0 |

Each template defines:

- Column keys, EN/AR headers, required flags, validation types
- Sample rows and status value lookup
- Supported formats: `xlsx`, `csv`

**Dynamic XLSX generation** (`import-template-generator.ts`):

- Template + Instructions + Status Values sheets
- Optional Employees / Shifts sheets from workspace data
- Not a static file on disk

### Template APIs

| Method | Route |
|--------|-------|
| GET | `/hr/workforce/imports/templates` |
| GET | `/hr/workforce/imports/templates/:key` |
| GET | `/hr/workforce/imports/templates/:key/download` |

## Import Lifecycle

```
Upload (multipart) or Document Registry documentId
  → import_jobs (import_type: attendance.period)
  → attendance_import_batches
  → Server parse (XLSX/CSV)
  → attendance_import_rows (per-row validation snapshot)
  → [dry-run] stop → notify dry_run_ready
  → [confirm] processImportRow
       → hr_attendance (legacy write, excel-aware fields)
       → AttendanceIngestionService (raw events)
       → Normalization + daily summary + dual-write bridge
  → attendance_adjustments (revert metadata)
  → generated_reports (reconciliation JSON)
  → notify import_completed / import_failed
```

### Import Center APIs

| Route | Purpose |
|-------|---------|
| POST `/hr/workforce/imports/upload` | Upload + validate (`?dryRun=true\|false`) |
| POST `/hr/workforce/imports/dry-run` | Dry-run only |
| POST `/hr/workforce/imports/:batchId/confirm` | Apply valid rows |
| POST `/hr/workforce/imports/:batchId/revert` | Soft revert (metadata + legacy soft mark) |
| GET `/hr/workforce/imports/history` | Import history |
| GET `/hr/workforce/imports/:batchId` | Status + row stats |
| GET `/hr/workforce/imports/:batchId/reconciliation` | Reconciliation report |

## Dry-Run Flow

- No production attendance writes during dry-run
- Returns: valid/invalid rows, warnings, file duplicates, unknown employees, shift warnings, normalization warnings
- Notification: `attendance_import_dry_run_ready`
- Confirm upgrades dry-run batch (`dryRun=false`) and applies rows

## Normalization Expansion (P20-C)

`normalization-rules.ts` + extended `AttendanceNormalizationService`:

| Feature | Implementation |
|---------|----------------|
| Missing punch pairing | `pairMissingPunches()` warnings |
| Night shifts | `detectNightShift()`, `allowNightShift` on sequence validation |
| Duplicate suppression | File-level dedupe on confirm; canonical idempotency keys |
| Source priority conflicts | `resolveSourceConflict()` + `suppressLowerPriorityEvents()` |
| Timezone normalization | `normalizeTimezoneDate()` / workspace calendar |
| Invalid sequence | `validatePunchSequence()` |

No GPS rules in P20-C.

## Reconciliation

Post-confirm `ReconciliationSummary`:

- inserted / updated / skipped / failed / duplicates
- employee coverage (days per employee)
- missing punch report
- Stored in `generated_reports` (`hr.attendance.import.reconciliation`, inline JSON)

## Rollback Strategy

**Soft revert foundation** via `attendance_adjustments`:

- Each insert/update tagged with `revertToken` on batch
- `POST .../revert` with token marks adjustments reverted
- Import inserts: soft-mark legacy row (status absent, note appended)—**no destructive deletes**
- No full rollback UI in P20-C

## Audit Trail

| Artifact | Role |
|----------|------|
| `import_jobs` | Job status, dry_run, source_storage_key, summary_json |
| `attendance_import_batches` | Batch, template, document link, revert token |
| `attendance_import_rows` | Row-level validation + outcome |
| `documents` | Optional `file_document_id` |
| `generated_reports` | Reconciliation artifact |
| `attendance_adjustments` | Revert metadata |

File storage: `local://imports/ws-{id}/{batchId}/` (override via `IMPORT_ARTIFACT_DIR`).

## UI (Import Center)

`hr-attendance.tsx` Import dialog:

- Server-side dry-run upload (replaces client-only preview path)
- Dynamic template download
- Confirm via workforce import API
- Import history list in dialog

Legacy routes (`/hr/attendance/import/preview|confirm`) remain for backward compatibility.

## Remaining Gaps (P20-D+)

- GPS / geofence
- Vendor SDK device imports
- Full rollback UI
- Mapping profile persistence per workspace
- Async worker queue (still sync in-process, no Redis)
- Error report XLSX artifact download
- Mobile clocking

## Key Files

| Area | Path |
|------|------|
| Schema | `lib/db/src/schema/attendance-import.ts` |
| Migration | `lib/db/drizzle/0007_attendance_import_center.sql` |
| Services | `artifacts/api-server/src/lib/workforce-attendance/import/` |
| Routes | `artifacts/api-server/src/routes/workforce-attendance-import.ts` |
| UI | `artifacts/ops-platform/src/pages/hr-attendance.tsx` |
| Tests | `routes/__tests__/workforce-attendance-import.smoke.test.ts` |
