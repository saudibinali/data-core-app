# P20-E — Vendor Connectors & Workforce Integration Hub

## Overview

P20-E adds a **vendor-agnostic integration hub** on top of the P20-B Workforce Event Platform. Connectors are registered by `connector_key` and route external workforce events into `AttendanceIngestionService` via the `vendor` attendance source—without vendor SDKs or hardcoding in core attendance logic.

## Connector lifecycle

1. **Register** — On API startup, `registerWorkforceConnectors()` loads minimal connectors into `ConnectorRegistry`.
2. **Configure** — HR creates an `attendance_integrations` row (workspace-scoped) with `connector_key`, `config_json`, and encrypted credentials.
3. **Map employees** — `attendance_integration_employee_map` links `external_employee_id` → `employee_id` (or `unresolved`).
4. **Ingest** — Webhook POST or scheduled poll produces `RawEventDraft` → `ingestVendorEventDraft` → `processIngestedEvent`.
5. **Monitor** — Sync jobs, `last_sync_status`, and bus events (`attendance.sync.*`) drive notifications.

### Built-in connectors

| `connector_key`      | Mode    | Purpose                          |
|----------------------|---------|----------------------------------|
| `generic_webhook`    | Webhook | JSON payload with `events[]`     |
| `generic_rest_poll`  | Poll    | REST list with cursor pagination |
| `excel_import`       | Bridge  | Documents Import Center path     |
| `direct_api`         | Both    | Webhook + optional REST poll URL |

## Webhook flow

```
POST /integrations/attendance/:integrationId/webhook
  → resolve integration (workspace via row)
  → verify X-Signature (HMAC-SHA256) when webhook secret configured
  → payload size ≤ max_payload_bytes
  → connector.parseWebhook()
  → replay token check (in-process window)
  → employee map resolution
  → processIngestedEvent (sourceCode: vendor)
```

Idempotency: `externalId = int:{integrationId}:{externalEventId}` → `ext:vendor:...` idempotency key.

## Polling flow

```
setInterval (sync-worker, no Redis)
  → enqueueDueIntegrationPolls() for enabled poll-capable integrations
  → processAttendanceSyncBatch() on attendance_sync_jobs
  → connector.poll(cursor)
  → ingest drafts
  → update cursor / retry with exponential backoff / dead_letter at max_attempts
```

## Employee mapping

- Table: `attendance_integration_employee_map`
- Status: `mapped`, `unresolved`, `ignored`
- Unresolved external IDs create/update map rows and skip ingest (logged)
- APIs: `GET/POST .../integrations/:id/employee-mappings`

## Device foundation

- Table: `attendance_devices` (`device_uid`, `device_type`, `integration_id`, `work_location_id`, `last_seen_at`)
- No biometric templates or template storage
- `touchDevice` on webhook events with `externalDeviceId`

## Sync orchestration

- Extends `attendance_sync_jobs` with `integration_id`, `attempts`, `max_attempts`, `next_run_at`
- Job statuses: `pending`, `processing`, `retry`, `completed`, `dead_letter`
- Manual: `POST .../integrations/:id/sync`

## Security model

- Credentials stored as AES-256-GCM blobs (`credential_encrypted`); API returns `hasCredentials` only
- Webhook secrets hashed (`webhook_secret_hash`) for verification side-channel
- Rotation: `PATCH` with `rotateWebhookSecret: true` bumps `credential_version`
- Workspace isolation on all management APIs
- Payload size limits per integration
- Audit via `logAttendanceAccess` on create/sync

See also: `p20-a-attendance-security-compliance.md`.

## Remaining gaps

- Persistent replay/nonce store (currently in-process Map)
- Rate limiting middleware hooks (placeholder via payload limits only)
- Vendor-specific connectors (deferred to future phases; use generic_* or direct_api)
- Biometric device enrollment / template sync
- Integration UI in HR console
- Cross-region webhook IP allowlists

## Recommended next phase

**P20-F — Workforce Operations Center & Attendance Control Tower**
