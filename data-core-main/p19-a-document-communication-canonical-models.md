# P19-A — Document & Communication Canonical Models

**Date:** 2026-05-19  
**Type:** Logical model design only — **no migrations in P19-A**.

All tables use **`workspace_id`** as isolation key (P18-A). Platform-global tables explicitly marked.

---

## Communication models

### `workspace_smtp_configs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Per-workspace outbound SMTP credentials and settings |
| **Ownership** | Workspace admin |
| **Workspace scope** | `workspace_id` UNIQUE (one active config per workspace phase 1) |
| **Retention** | Until workspace deleted (cascade) |
| **Audit** | Create/update by user; secret rotation logged |
| **Security** | Encrypt `password`/`oauth_token`; never return in GET |

**Key columns (logical):** `host`, `port`, `secure`, `username`, `encrypted_secret`, `from_default`, `is_verified`, `last_test_at`, `status`

---

### `notification_templates`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Versioned email/in-app templates per event key |
| **Ownership** | Workspace (copy from platform defaults) |
| **Workspace scope** | `workspace_id` + `template_key` + `channel` + `locale` |
| **Retention** | Keep all versions for audit |
| **Audit** | Who published version |
| **Security** | Sanitize HTML; no script tags |

**Key columns:** `template_key`, `channel` (email|in_app), `locale`, `subject`, `body_html`, `body_text`, `version`, `is_active`

---

### `notification_jobs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Async work unit: render + deliver one notification intent |
| **Ownership** | System |
| **Workspace scope** | `workspace_id` NOT NULL |
| **Retention** | 90 days success; 1 year failed/dead_letter |
| **Audit** | Full payload hash; idempotency key |
| **Security** | No PII in logs beyond recipient id reference |

**Key columns:** `idempotency_key`, `event_type`, `entity_type`, `entity_id`, `status`, `scheduled_at`, `attempts`, `last_error`, `bus_event_id`

---

### `notification_deliveries`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Per-recipient per-channel outcome |
| **Ownership** | System |
| **Workspace scope** | `workspace_id` |
| **Retention** | Align with jobs |
| **Audit** | Provider message id, timestamps |
| **Security** | Email address hashed optional for GDPR export |

**Key columns:** `notification_job_id`, `user_id`, `channel`, `status`, `provider_message_id`, `sent_at`, `read_at` (in-app)

---

### `communication_audit_logs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Immutable compliance trail |
| **Ownership** | System append-only |
| **Workspace scope** | `workspace_id` |
| **Retention** | 7 years default (configurable) |
| **Audit** | N/A (is audit) |
| **Security** | Tamper-evident optional (hash chain) |

**Key columns:** `action`, `actor_user_id`, `target_type`, `target_id`, `metadata_json`, `ip_address`

---

## Document models

### `documents`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Workspace document registry (canonical row per logical file) |
| **Ownership** | Workspace; linked entity |
| **Workspace scope** | `workspace_id` NOT NULL |
| **Retention** | Per `retention_policy_id` |
| **Audit** | Create/update/delete logged |
| **Security** | Classification: public/internal/confidential |

**Key columns:** `title`, `file_name`, `mime_type`, `size_bytes`, `storage_key`, `status`, `source_type`, `source_entity_type`, `source_entity_id`, `folder_id`, `current_version_id`, `deleted_at`

---

### `document_versions`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Immutable blob versions |
| **Ownership** | System |
| **Workspace scope** | Via `document_id` → documents.workspace_id |
| **Retention** | Follow parent document |
| **Audit** | Upload user, checksum |
| **Security** | `sha256` integrity |

**Key columns:** `document_id`, `version_number`, `storage_key`, `size_bytes`, `uploaded_by_user_id`, `created_at`

---

### `document_folders`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Hierarchy (employee folder, HR shared, payroll) |
| **Ownership** | Workspace |
| **Workspace scope** | `workspace_id` |
| **Retention** | Until empty + policy |
| **Audit** | Move/rename |
| **Security** | Inherit parent ACL |

**Key columns:** `parent_id`, `name`, `path_materialized`, `entity_type` (employee|workspace|department)

---

### `document_tags`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Labels for search/filter |
| **Ownership** | Workspace |
| **Workspace scope** | `workspace_id` |
| **Retention** | While document exists |
| **Audit** | Tag apply/remove |
| **Security** | No cross-workspace tag namespace |

---

### `document_access_logs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Download/view audit |
| **Ownership** | System |
| **Workspace scope** | `workspace_id` |
| **Retention** | 7 years |
| **Audit** | N/A |
| **Security** | IP, user agent |

---

### `generated_reports`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Output of report generation (PDF/XLSX) |
| **Ownership** | Workspace |
| **Workspace scope** | `workspace_id` |
| **Retention** | 30–365 days by report type |
| **Audit** | Who requested, parameters hash |
| **Security** | Signed download only |

**Key columns:** `report_definition_key`, `format`, `storage_key`, `status`, `requested_by_user_id`, `expires_at`

---

### `import_jobs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Track Excel/CSV import runs |
| **Ownership** | Workspace user |
| **Workspace scope** | `workspace_id` |
| **Retention** | 1 year |
| **Audit** | Dry-run vs confirm; row counts |
| **Security** | Source file in private storage |

**Key columns:** `import_type`, `status`, `dry_run`, `summary_json`, `error_report_storage_key`

---

### `export_jobs`

| Attribute | Value |
|-----------|--------|
| **Purpose** | Async large exports |
| **Ownership** | Workspace user |
| **Workspace scope** | `workspace_id` |
| **Retention** | 7–30 days |
| **Audit** | Filter params; download count |
| **Security** | Respect `allow_export` policy |

---

## Extensions to existing tables (not new duplicates)

| Existing | Extension |
|----------|-----------|
| `notifications` | Add `workspace_id`, optional `notification_job_id` |
| `hr_employee_documents` | Deprecate in favor of `documents` link (migration phase) |
| `form_submission_files` | Point to `documents.id` |

---

**Confirmation:** No SQL migrations in P19-A.
