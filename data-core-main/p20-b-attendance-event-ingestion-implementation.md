# P20-B — Attendance Event Ingestion Implementation

## Overview

Phase 20-B introduces a **canonical attendance event layer** on top of legacy `hr_attendance` without breaking existing APIs or read paths. All new ingestion flows through raw events → normalization → daily summaries → transitional dual-write to `hr_attendance`.

## Ingestion Flow

```
Source (manual | web | excel)
  → AttendanceIngestionService.ingestRawEvent()
      validateEvent → resolveEmployee → generateIdempotencyKey → storeRawEvent (append-only)
  → appEventBus: attendance.raw.received
  → AttendanceNormalizationService.normalizeRawEvent()
  → appEventBus: attendance.event.normalized
  → AttendanceSummaryService.buildDailySummary()
  → syncSummaryToLegacyAttendance()  [transitional]
  → appEventBus: attendance.day.calculated
```

Entry points:

| Entry | Path |
|-------|------|
| Web clock | `POST /hr/workforce/clock-in`, `POST /hr/workforce/clock-out` |
| Excel import confirm | `POST /hr/attendance/import/confirm` (parallel `ingestExcelRow` after legacy write) |
| Programmatic | `processIngestedEvent()`, `ingestWebClock()`, `ingestExcelRow()` in `pipeline.ts` |

## Normalization Flow

`AttendanceNormalizationService`:

- Resolves `local_date` and `timezone` from workspace calendar (`hr_work_calendars`)
- Maps `event_type_hint` → `clock_in` / `clock_out`
- Enforces canonical idempotency (`norm:{rawEventId}`)
- Sets `attendance_raw_events.processing_status` to `normalized`, `duplicate`, or `failed`
- Applies source priority metadata for summary dominance (`SOURCE_PRIORITY` + `attendance_sources.default_priority`)

Duplicate rules (foundation):

- Raw: unique `(workspace_id, source_id, idempotency_key)`
- Canonical: unique per raw event and per employee idempotency key

## Dual-Write Strategy

**Write path (new):** `attendance_daily_summaries` → `syncSummaryToLegacyAttendance()` → upsert `hr_attendance`

**Unchanged:**

- Legacy `POST /hr/attendance`, bulk, import confirm still write `hr_attendance` directly
- Reports and exports still read `hr_attendance` (`hr.attendance.period`)

**Read path:** No switch to canonical tables in P20-B.

Legacy `source_type` mapping: `web` → `mobile`, `excel`/`manual` → `manual`, `system` → `system`.

## Event Lifecycle

| Stage | Table | Status |
|-------|-------|--------|
| Received | `attendance_raw_events` | `received` |
| Normalized | `attendance_raw_events` + `attendance_events` | `normalized` |
| Duplicate skip | `attendance_raw_events` | `duplicate` |
| Failed | `attendance_raw_events` | `failed` |
| Day calculated | `attendance_daily_summaries` | status + minutes |

Bus events (minimal notification on `attendance.day.calculated`):

- `attendance.raw.received`
- `attendance.event.normalized`
- `attendance.day.calculated`

## Summary Calculation

`AttendanceSummaryService.buildDailySummary()`:

- Aggregates non-superseded `attendance_events` for `(employee, local_date)`
- Computes `first_in`, `last_out`, `worked_minutes`, `late_minutes`, `early_leave_minutes`, `overtime_minutes`, `status`
- Matches shift via existing `hr_shifts` (employee shift or first active shift)
- Uses work calendar helpers for holiday/workday context
- Upserts `attendance_daily_summaries` with `dominant_source_code`

## Database Objects

Migration: `lib/db/drizzle/0006_workforce_attendance_foundation.sql`

| Table | Purpose |
|-------|---------|
| `attendance_sources` | Per-workspace source registry |
| `attendance_raw_events` | Append-only ingestion log |
| `attendance_events` | Canonical normalized punches |
| `attendance_daily_summaries` | Computed day rollups |
| `attendance_sync_jobs` | Placeholder for future vendor sync |

Default seeds (`manual`, `web`, `excel`, `system`) run on API init via `seedAllWorkspaceAttendanceSources()`.

## Security (Foundation)

- Workspace isolation on all queries and employee resolution
- Append-only raw events (no update/delete API)
- Idempotency keys + unique indexes (anti-replay)
- Source code validation against registered sources
- `logAttendanceAccess()` structured access hooks (console/logger; no dedicated audit table yet)

## Remaining Gaps (P20-C+)

- Geofence / GPS enforcement
- Vendor SDK adapters and `attendance_sync_jobs` workers
- Full Import Center UI and `import_jobs` orchestration
- Read path migration off `hr_attendance`
- Biometric devices, mobile app
- Dedicated attendance audit log table
- Payroll coupling redesign

## Files

| Area | Location |
|------|----------|
| Schema | `lib/db/src/schema/workforce-attendance.ts` |
| Services | `artifacts/api-server/src/lib/workforce-attendance/` |
| Routes | `artifacts/api-server/src/routes/workforce-attendance.ts` |
| Events | `lib/core-events`, `listeners/attendance-bus.ts` |
| Tests | `routes/__tests__/workforce-attendance.smoke.test.ts` |
