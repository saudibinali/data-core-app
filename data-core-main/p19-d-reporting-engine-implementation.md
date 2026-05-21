# P19-D — Reporting Engine Implementation

**Date:** 2026-05-19  
**Phase:** P19-D (Reporting Engine & Enterprise Export Infrastructure)

---

## 1. Services

| Service | Role |
|---------|------|
| `ReportDefinitionRegistry` | Canonical keys, formats, permissions, async thresholds |
| `ReportService` | `executeReport`, `createReportJob`, `handleLegacyExport`, downloads |
| `ExportJobService` | Job CRUD, processing, artifact storage, notifications |
| `export-job-processor` | DB poll every 10s (no Redis) |

---

## 2. Report definitions

| Key | Formats | Permission |
|-----|---------|------------|
| `hr.employees.roster` | xlsx, csv | hr.manage |
| `hr.attendance.period` | xlsx, csv | hr.manage |
| `hr.leave.balances` | xlsx, csv | hr.manage |

No PDF in this phase.

---

## 3. Export job flow

```
POST /reports/export-jobs
  ├─ INSERT generated_reports (pending)
  ├─ INSERT export_jobs (pending, linked)
  └─ processor picks pending jobs
        ├─ status → processing
        ├─ runReportGenerator()
        ├─ storeReportArtifact() → local://reports/ws-{id}/{reportId}/{file}
        ├─ generated_reports → completed
        ├─ export_jobs → completed
        └─ dispatchUserNotification (export_completed / export_failed)
```

**Retry:** `attempts` / `max_attempts` (default 3); dead jobs notify user.

**Progress:** `progress_percent` 10 → 40 → 70 → 100.

---

## 4. Legacy route compatibility

| Route | Behavior |
|-------|----------|
| `GET /hr/employees/export` | Default `mode=auto` → sync download (same as before) |
| `GET /hr/attendance/export` | Same |
| `?mode=async` | Returns `202` with `{ jobId, generatedReportId }` |

Auto-async when estimated rows > `REPORT_ASYNC_ROW_THRESHOLD` (default 500).

---

## 5. Generated reports lifecycle

- `storage_key` — `local://reports/ws-{workspaceId}/{reportId}/{fileName}`
- `expires_at` — per definition default (14–30 days)
- `download_count` — incremented on issued download
- `report_access_logs` — audit per download

**Download:**

1. `GET /reports/generated/:id/download` → JWT token + metadata (logs access)
2. `GET /reports/generated/download/stream?token=` → file bytes

---

## 6. Scheduled report readiness (foundation only)

Fields on `export_jobs` and `generated_reports`:

- `schedule_cron`
- `schedule_timezone`
- `recipient_json`

No cron scheduler implementation in P19-D.

---

## 7. Notification integration

In-app notifications via `dispatchUserNotification`:

- `export_completed` / `export_failed`
- Email templates `export.completed` / `export.failed` seeded (enqueue optional, default in-app only)

---

## 8. APIs

| Method | Path |
|--------|------|
| GET | `/reports/definitions` |
| POST | `/reports/export-jobs` |
| GET | `/reports/export-jobs/:id` |
| GET | `/reports/generated` |
| GET | `/reports/generated/:id/download` |
| GET | `/reports/generated/download/stream?token=` |

---

## 9. Remaining gaps (P19-E+)

- PDF rendering
- Report center UI
- Full cron scheduler + email delivery of attachments
- BI / analytics
- Payroll payslip reports
- GCS artifact upload (currently local `REPORT_ARTIFACT_DIR`)
- Workspace `allow_export` enforcement hook (optional hardening)

---

## 10. Smoke tests

`reporting-engine.smoke.test.ts` — run with `DATABASE_URL` set.
