# P19-A — Infrastructure Readiness Audit

**Date:** 2026-05-19  
**Type:** Read-only assessment of current codebase.

**Verdict legend:** **GO** = usable foundation; **PARTIAL** = exists but fragmented; **BLOCKED** = missing or unsafe for enterprise.

---

## Summary matrix

| Area | Verdict | Summary |
|------|---------|---------|
| Workspace isolation | **GO** | `workspace_id` pervasive; JWT scoping solid |
| Uploads / presign | **PARTIAL** | GCS presign exists; **unauthenticated** upload URL route |
| Document registry | **BLOCKED** | No unified `documents` table |
| HR document metadata | **PARTIAL** | `hr_employee_documents`; UI metadata-only |
| Form file uploads | **PARTIAL** | `form_submission_files`; incomplete persistence |
| Commercial PDF storage | **PARTIAL** | Local disk + separate model |
| In-app notifications | **GO** | Table + bus + SSE + UI page |
| Email / SMTP | **PARTIAL** | Env SMTP only; 2 flows; DB settings unwired |
| Workspace SMTP | **BLOCKED** | Not implemented |
| Report generation (PDF) | **BLOCKED** | No engine |
| Report generation (Excel) | **PARTIAL** | HR ad-hoc exports |
| Import pipelines | **PARTIAL** | HR employee/attendance preview/confirm |
| Export jobs / queues | **BLOCKED** | No async export job table |
| Background jobs | **PARTIAL** | Event bus async emit; no job runner |
| Workflow notifications | **PARTIAL** | Steps exist; form email incomplete |
| Leave notifications | **GO** | Canonical bus events (post P18-D) |
| Attachment models | **PARTIAL** | JSONB/URL arrays inconsistent |
| Security (file ACL) | **PARTIAL** | Private object ACL disabled |
| Audit (communication) | **PARTIAL** | `bus_event_id` on notifications; no comm audit table |
| Audit (document access) | **BLOCKED** | No download log table |

---

## 1. Current uploads support

| Item | Finding |
|------|---------|
| Routes | `POST /storage/uploads/request-url`, `GET /storage/objects/*` |
| File | `artifacts/api-server/src/lib/objectStorage.ts` |
| Auth | Upload request **lacks requireAuth** (critical gap) |
| ACL | Private GET ACL **commented out** in `storage.ts` |
| Workspace binding | No `workspace_id` in object key convention |

**Verdict:** **PARTIAL**

---

## 2. Current exports

| Item | Finding |
|------|---------|
| HR employees | `GET /hr/employees/export` — XLSX/CSV |
| HR attendance | `GET /hr/attendance/export` |
| Policy | `workspace_access_enforcement.allow_export` |
| Async | Synchronous only |
| Permission | `reports.view` unused |

**Verdict:** **PARTIAL**

---

## 3. Current notifications

| Item | Finding |
|------|---------|
| Schema | `notifications` — no `workspace_id` |
| Bus | `notifications-bus.ts` — leave, tickets, approvals |
| SSE | `/stream` |
| UI | `pages/notifications.tsx` |
| Inline legacy | comments, messages, calendar still insert directly |

**Verdict:** **GO** (in-app); **PARTIAL** (workspace audit dimension)

---

## 4. Current SMTP usage

| Item | Finding |
|------|---------|
| Implementation | `lib/email.ts` — nodemailer, env vars |
| Flows | Workspace invitations, form submission confirmation |
| Platform settings | `platform_settings` category `smtp` — **not used** by sender |
| Per-workspace | **None** |

**Verdict:** **PARTIAL** (platform env only)

---

## 5. Current report generation

| Format | Status |
|--------|--------|
| XLSX | HR routes + client parse |
| PDF | Invoice upload/storage only |
| Scheduled | None |
| Templates | Inline HTML in `email.ts` for forms |

**Verdict:** **BLOCKED** (enterprise reports); **PARTIAL** (Excel exports)

---

## 6. Current file handling

| Location | Pattern |
|----------|---------|
| HR | `object_path` string on document row |
| Forms | `storage_path` on `form_submission_files` |
| Leave | `attachment_urls` JSONB array |
| Contracts | `attachments` JSONB on contract |
| Messages | Inline attachments JSON |
| Commercial | `storage_key` + local filesystem |

**Verdict:** **PARTIAL** — needs canonical registry

---

## 7. Current queues / background jobs

| Mechanism | Status |
|-----------|--------|
| `appEventBus` | Fire-and-forget after HTTP |
| `notification_jobs` | **Not exists** |
| `export_jobs` / `import_jobs` | **Not exists** |
| Cron / scheduler | Governance snapshots only (domain-specific) |

**Verdict:** **PARTIAL**

---

## 8. P18 / leave interaction

- Canonical leave emits bus events — **ready** for notification templates
- `attachment_urls` on leave — migrate to documents in future phase
- No leave email today (in-app only)

---

## 9. Recommended build order (for P19-B+)

1. `workspace_smtp_configs` + mailer abstraction
2. `notification_jobs` + wire bus
3. `documents` + secured presign
4. `import_jobs` / `export_jobs` wrappers around HR flows
5. `generated_reports` + PDF engine
6. Migrate HR/commercial storage to single adapter

---

**Confirmation:** Audit only; no code changes in P19-A.
