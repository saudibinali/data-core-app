# P20-A — Canonical Attendance Models (Design Only)

**Phase:** P20-A — no migrations, no implementation  
**Date:** 2026-05-19

Models below are **planned**. Existing `hr_attendance`, `hr_shifts`, etc. remain until phased migration.

---

## Model index

| Model | Table name (proposed) |
|-------|------------------------|
| Attendance sources | `attendance_sources` |
| Devices | `attendance_devices` |
| Integrations | `attendance_integrations` |
| Raw events | `attendance_raw_events` |
| Canonical events | `attendance_events` |
| Daily summaries | `attendance_daily_summaries` |
| Adjustments | `attendance_adjustments` |
| Geofences | `attendance_geofences` |
| Policies | `attendance_policies` |
| Sync jobs | `attendance_sync_jobs` |
| Import batches | `attendance_import_batches` |

---

## 1. `attendance_sources`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Registry of ingest channels per workspace (manual, web, mobile_gps, vendor_x, excel, …) |
| **Workspace scope** | `workspace_id` FK, unique `(workspace_id, code)` |
| **Employee relation** | None (channel-level) |
| **Key fields** | `code`, `name`, `source_kind`, `default_priority`, `trust_level`, `is_active` |
| **Audit** | `created_by`, timestamps |
| **Payroll impact** | Indirect — priority affects which events win for paid time |
| **Security** | Admin-only configuration; no secrets here |

---

## 2. `attendance_devices`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Physical or logical devices (biometric terminal, kiosk, mobile app instance) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | Optional `assigned_employee_id` for personal devices; null for shared terminals |
| **Key fields** | `device_uid`, `device_type`, `integration_id`, `location_id`, `last_seen_at`, `status` |
| **Audit** | Registration actor, revocation log |
| **Payroll impact** | None direct; provenance for disputes |
| **Security** | Device credentials rotated via `attendance_integrations`; fingerprint templates **not** stored in ERP (vendor-side) |

---

## 3. `attendance_integrations`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Vendor-agnostic connector config (API base URL, auth type, mapping profile) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | None |
| **Key fields** | `connector_key` (e.g. `generic_webhook`, `zkteco_poll`), `config_json`, `credential_ref`, `poll_interval_sec`, `webhook_secret_ref`, `is_enabled` |
| **Audit** | Config change log (who enabled/disabled) |
| **Payroll impact** | None |
| **Security** | Secrets in encrypted store; `config_json` non-sensitive only |

---

## 4. `attendance_raw_events`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Append-only ingest log (vendor payload preserved) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | `employee_id` nullable until resolved |
| **Key fields** | `source_id`, `integration_id`, `external_id`, `payload_json`, `payload_hash`, `received_at`, `processing_status`, `error_message` |
| **Audit** | Immutable insert; correction via new event + adjustment, not UPDATE of payload |
| **Payroll impact** | Source evidence for disputes |
| **Security** | Admin/integrator roles; PII minimization in payload retention policy |

---

## 5. `attendance_events`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Normalized workforce events (clock_in, clock_out, break_start, break_end, absence_marked) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | `employee_id` required after normalization |
| **Key fields** | `event_type`, `occurred_at` (timestamptz), `local_date`, `timezone`, `raw_event_id`, `device_id`, `location_json`, `idempotency_key`, `is_superseded` |
| **Audit** | Link to raw event; `created_by_system` vs user |
| **Payroll impact** | Drives minutes worked, OT eligibility |
| **Security** | Employee self can read own; HR manage for all |

---

## 6. `attendance_daily_summaries`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Derived day-level roll-up (successor concept to `hr_attendance` row) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | `employee_id` + `date` unique |
| **Key fields** | `shift_id`, `first_in`, `last_out`, `status`, `late_minutes`, `early_leave_minutes`, `overtime_minutes`, `paid_minutes`, `source_snapshot_json`, `legacy_attendance_id` (FK during migration) |
| **Audit** | `calculated_at`, `calculation_version`, `locked_at` |
| **Payroll impact** | **Primary** input for payroll readers in future phases |
| **Security** | Same as attendance today + lock prevents edits |

---

## 7. `attendance_adjustments`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | HR-approved corrections with reason codes |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | `employee_id`, `date` or `event_id` |
| **Key fields** | `adjustment_type`, `before_json`, `after_json`, `reason_code`, `notes`, `approved_by` |
| **Audit** | Mandatory approver; immutable row |
| **Payroll impact** | Overrides calculated minutes for pay period |
| **Security** | `hr.manage` + optional second approver for sensitive codes |

---

## 8. `attendance_geofences`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Branch/site boundaries for mobile clock validation |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | Optional allow-list via `hr_work_locations` / org unit |
| **Key fields** | `name`, `latitude`, `longitude`, `radius_meters`, `work_location_id`, `is_active` |
| **Audit** | Who created/changed coordinates |
| **Payroll impact** | None direct; gates valid clock events |
| **Security** | Location data sensitivity — see security doc |

---

## 9. `attendance_policies`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Rules engine config: grace, rounding, missing punch, OT thresholds, source priority |
| **Workspace scope** | `workspace_id`; optional org unit / employee group scope |
| **Employee relation** | Via assignment table or default policy |
| **Key fields** | `policy_json` (versioned schema), `effective_from`, `effective_to`, `priority` |
| **Audit** | Policy version history |
| **Payroll impact** | Defines paid vs unpaid absence, OT rules |
| **Security** | Admin-only; policy changes logged |

---

## 10. `attendance_sync_jobs`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | DB-tracked integration poll/webhook batch runs (like `export_jobs`) |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | None |
| **Key fields** | `integration_id`, `status`, `started_at`, `completed_at`, `records_fetched`, `records_normalized`, `last_error`, `cursor_json` |
| **Audit** | Full job log |
| **Payroll impact** | Timeliness of attendance data |
| **Security** | System + admin vis; no secrets in row |

---

## 11. `attendance_import_batches`

| Attribute | Detail |
|-----------|--------|
| **Purpose** | Links Excel/CSV imports to `import_jobs` + row-level outcomes |
| **Workspace scope** | `workspace_id` |
| **Employee relation** | Per-row in child `attendance_import_rows` (optional child table) |
| **Key fields** | `import_job_id`, `file_document_id`, `mapping_json`, `dry_run`, `summary_json` |
| **Audit** | Document registry + import job audit |
| **Payroll impact** | Bulk backfill of historical days |
| **Security** | HR manage; file in private object storage |

---

## Relationship diagram (logical)

```
attendance_integrations ──► attendance_sources
        │                           │
        ▼                           ▼
attendance_sync_jobs      attendance_raw_events
                                    │
                                    ▼
                            attendance_events
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        attendance_daily_summaries          attendance_adjustments
                    │
                    ▼ (dual-write transition)
              hr_attendance (legacy)
```

---

## Migration strategy (high level)

1. Add new tables without dropping `hr_attendance`  
2. Dual-write summaries → `hr_attendance`  
3. Switch read path per workspace flag  
4. Deprecate direct import confirm to legacy path  
5. Retain `hr_attendance` as materialized view or synonym until payroll consumers migrated  

**No migrations in P20-A.**
