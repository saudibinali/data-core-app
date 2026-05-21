# P20-A — Vendor-Agnostic Attendance Integration Strategy

**Phase:** P20-A (design only)  
**Date:** 2026-05-19

---

## 1. Design goal

Enable **any** time-tracking vendor, biometric brand, or custom API to feed the Workforce Event Platform through a **single connector contract**, without embedding vendor logic in core normalization or payroll.

---

## 2. Connector interface (conceptual)

```typescript
interface AttendanceConnector {
  readonly connectorKey: string; // e.g. "generic_webhook", "poll_rest_v1"

  /** Validate config + credentials */
  testConnection(ctx: ConnectorContext): Promise<TestResult>;

  /** Pull mode: fetch since cursor */
  poll?(ctx: ConnectorContext, cursor: Cursor): Promise<PollResult>;

  /** Push mode: parse webhook body */
  parseWebhook?(ctx: ConnectorContext, headers: Headers, body: unknown): Promise<RawEventDraft[]>;

  /** Map vendor employee id → workspace employee_id */
  resolveEmployee(ctx: ConnectorContext, externalEmployeeId: string): Promise<number | null>;

  /** Optional: map device id */
  resolveDevice?(ctx: ConnectorContext, externalDeviceId: string): Promise<number | null>;
}
```

**Registration:** Connectors are code plugins keyed by `connector_key`; workspace config selects plugin + JSON mapping profile.

---

## 3. Ingestion modes

| Mode | Use case | Mechanism |
|------|----------|-----------|
| **Webhook** | Real-time punches | `POST /integrations/attendance/:integrationId/webhook` → verify signature → raw_events |
| **API polling** | Vendors without push | `attendance_sync_jobs` worker calls `connector.poll()` |
| **File drop** | SFTP/scheduled file | Object storage pickup → import batch |
| **Direct API** | Mobile/web clock | First-party normalized API (no vendor adapter) |
| **Manual replay** | Support | Reprocess raw_event by id |

---

## 4. Credential storage

| Requirement | Approach |
|-------------|----------|
| Workspace isolation | Credentials keyed by `workspace_id` + `integration_id` |
| Encryption | AES-GCM at rest; key from platform secret (existing pattern for SMTP) |
| Rotation | `credential_version`; connectors fetch active version only |
| Exposure | Never return secrets to browser; test connection uses server-side only |
| Audit | Log credential create/rotate/disable (no values) |

Align with P19-B workspace SMTP credential patterns.

---

## 5. Rate limits & backoff

| Layer | Policy |
|-------|--------|
| Per integration | Configurable `max_requests_per_minute` |
| Per workspace | Global cap to protect DB |
| Backoff | Exponential on 429/5xx; max interval 15 min |
| Circuit breaker | Disable integration after N consecutive failures; notify admin |

---

## 6. Retry strategy

- **Raw ingest:** At-least-once delivery; idempotency dedupes  
- **Normalization:** Retry transient DB errors up to 3 attempts  
- **Sync jobs:** Job row tracks `attempts`, `last_error`, `next_run_at` (cron-parser style, P19-E pattern)  
- **Dead letter:** `processing_status = failed` on raw_event with admin replay action  

**No Redis:** Retries via DB job queue (same as export/notification processors).

---

## 7. Idempotency

| Key | Composition |
|-----|-------------|
| External | `(integration_id, external_event_id)` unique |
| Hash fallback | `SHA256(integration_id + employee_external_id + occurred_at + event_type)` |
| Webhook | Vendor message-id header if present |

Duplicate raw events: skip normalization, return 200 to vendor.

---

## 8. Mapping rules

Stored in `attendance_integrations.config_json`:

```json
{
  "mappingVersion": 1,
  "employee": { "field": "empCode", "lookup": "employee_number" },
  "eventType": { "in": ["IN", "CHECK_IN"], "out": ["OUT"] },
  "timestamp": { "field": "punchTime", "format": "ISO8601", "timezone": "Asia/Riyadh" },
  "device": { "field": "terminalId" }
}
```

**Generic mapper** interprets profile; vendor-specific connectors only needed when mapping is non-standard.

---

## 9. Vendor adapters (illustrative, not implemented)

| Adapter key | Style | Notes |
|-------------|-------|-------|
| `generic_webhook` | Push | JSON profile mapping |
| `generic_rest_poll` | Pull | Paginated REST + cursor |
| `excel_import` | File | Not a vendor — uses import batch |
| `zkteco_compat` | Pull | Example biometric; maps terminal users |
| `hikvision_compat` | Webhook | Example; signature validation |
| `custom_erp_hr` | Pull | Internal cross-module |

**Rule:** New vendor = new adapter package implementing interface; **no** changes to `attendance_events` schema.

---

## 10. Employee / device resolution

1. Mapping table `attendance_integration_employee_map` (optional P20-B): `external_id` → `employee_id`  
2. Fallback: match `employees.employee_number`  
3. Unresolved: raw_event stays `employee_id null`, sync job alerts HR  

Devices: map to `attendance_devices.device_uid`.

---

## 11. Observability

- Metrics: events received / normalized / failed per integration  
- Admin UI (future): last sync, error sample, replay button  
- Notifications: `attendance.sync.failed` email to workspace admins (P19 infra)  

---

## 12. Security checklist

- Webhook HMAC verification per integration  
- IP allow-list optional  
- Payload size limits  
- PII scrubbing in logs  
- Workspace cannot reference another workspace’s integration id  

---

## 13. Anti-patterns (forbidden)

- Hardcoding single vendor SDK in `hr.ts`  
- Writing vendor payloads only to `hr_attendance` without raw_events  
- Storing biometric templates in ERP database  
- Public webhook URLs without authentication  

---

**Next phase:** P20-B implements connector registry + `attendance_raw_events` insert path for `generic_webhook` and `direct_api`.
