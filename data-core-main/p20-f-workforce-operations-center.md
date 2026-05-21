# P20-F — Workforce Operations Center & Attendance Control Tower

## Purpose

Enterprise operations console for monitoring and operating the Workforce Event Platform (P20-B), Import Center (P20-C), and Integration Hub (P20-E)—without payroll changes, biometric enrollment, or Redis.

**UI route:** `/admin/hr/workforce-ops` (requires `hr.manage`)

## Operations workflows

### Daily operator flow

1. Open **Workforce Operations Center** — review alert banner and stat cards.
2. **Integrations** tab — check stale/disabled connectors, success rates, unresolved mappings per integration.
3. **Raw events** — filter `failed`, inspect masked payload, **Replay** or **Ignore**.
4. **Sync jobs** — retry `dead_letter` / `retry` jobs; view cursor and attempts in API.
5. **Mappings** — resolve `externalEmployeeId` → internal `employeeId` (bulk API available).
6. **Import issues** — jump to batches with `completed_with_errors` from Import Center.
7. Export operational JSON reports via `POST /hr/workforce/ops/reports/generate` (appears in Report Center).

### Integration health dashboard

Per integration (7-day window):

- Last sync / status / consecutive failures
- Sync success rate, failed count, retry count
- Unresolved employee mappings
- Stale detection (`2 × poll_interval` since `last_sync_at`)
- Webhook vs poll capability flags

## Replay lifecycle

`ReplayService` (non-destructive):

| Action | Behavior |
|--------|----------|
| `replayRawEvent` | Sets status `received`, re-runs normalization + daily summary; **payload unchanged** |
| `retryNormalization` | Alias of replay |
| `markRawEventIgnored` | Status `ignored`; blocks replay |
| `retrySyncJob` | Pending + reset attempts |
| `cancelSyncJob` | Status `cancelled` (pending/retry only) |
| `replayDeadLetterJob` | Retry from `dead_letter` |
| `replaySyncBatch` | Enqueues manual poll via `integrationService.syncNow` |

All replay actions log `[workforce] access` with `replay_*` actions (admin-only via `hr.manage`).

## Monitoring model

| API | Purpose |
|-----|---------|
| `GET /hr/workforce/ops/overview` | Aggregated health + alerts |
| `GET /hr/workforce/ops/metrics` | Raw/sync trends |
| `GET /hr/workforce/ops/warnings` | Alert list |
| `GET /hr/workforce/ops/integrations/health` | All integrations |
| `GET /hr/workforce/ops/stale-integrations` | Stale subset |
| `GET /hr/workforce/ops/raw-events` | Filterable inbox |
| `GET /hr/workforce/ops/sync-jobs` | Job monitor with cursor |

Polling: UI refreshes every 30s (governance-dashboard pattern).

## Sync governance

- Operators can **retry**, **cancel**, or **replay dead letter** jobs.
- Worker remains DB-backed (`sync-worker.ts`); no Redis.
- Dead-letter notifications dispatched to HR admins (hourly cooldown per alert code).

## Alert lifecycle

Dynamic alerts (`evaluateAlerts`):

- `sync_failures` — consecutive integration failures
- `stale_integration` — missed poll window
- `duplicate_storm` — ≥50 duplicates / 24h
- `unresolved_mappings` — open employee maps
- `failed_raw_events` — normalization backlog
- `dead_letter_jobs` — sync jobs needing action
- `integration_disabled` — informational

Notifications: P20-E bus events + P20-F `dispatchOperationalAlerts` on dead letter.

## Operational security

- All routes: `requireAuth` + `requirePermission("hr.manage")`
- Payload display: masked by default (`?unmask=1` for full view — use sparingly)
- Workspace isolation on every query
- Audit via `logAttendanceAccess` on replay, ignore, bulk resolve, sync retry
- No destructive deletes on raw payloads or canonical events

## Operational reports (`generated_reports`)

| Key | Content |
|-----|---------|
| `hr.workforce.integration.activity` | Integration health rows |
| `hr.workforce.sync.failures` | Failed/dead-letter jobs (30d) |
| `hr.workforce.unresolved.mappings` | Open maps |
| `hr.workforce.attendance.warnings` | Trends + alerts |

## Remaining gaps

- Dedicated `attendance_access_logs` DB table (structured logs only today)
- Full integration CRUD UI (configure via existing P20-E APIs)
- Persistent webhook replay nonce store
- Rate-limit middleware on replay endpoints
- Multi-node alert deduplication (in-process cooldown)
- AI analytics / live tracking (explicitly out of scope)

## Next phase

**P21-A — Payroll Foundation & Compensation Canonical Architecture** (not started in this delivery).
