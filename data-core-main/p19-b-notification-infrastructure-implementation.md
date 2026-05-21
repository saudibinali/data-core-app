# P19-B — Notification Infrastructure Implementation

**Date:** 2026-05-19  
**Phase:** P19-B (Workspace SMTP & Notification Infrastructure)

---

## 1. Migrations

**File:** `lib/db/drizzle/0002_notification_infrastructure.sql`

| Table | Purpose |
|-------|---------|
| `workspace_smtp_configs` | Per-workspace SMTP (encrypted password, verification status) |
| `notification_templates` | Platform + workspace email templates |
| `notification_jobs` | DB-backed async queue (no Redis) |
| `notification_deliveries` | Per-channel delivery tracking |
| `communication_audit_logs` | SMTP/config audit trail |

**Altered:** `notifications` — `workspace_id`, `notification_job_id`, indexes.

Backfill: existing `notifications.workspace_id` populated from `users.workspace_id`.

---

## 2. Mailer flow

```
dispatchUserNotification()
  ├─ INSERT notifications (workspace_id)
  ├─ INSERT notification_deliveries (in_app, sent)
  ├─ emitToUser() → SSE (unchanged)
  └─ optional: INSERT notification_jobs (email, pending)
        └─ queue-processor → WorkspaceMailer.send()
              ├─ workspace SMTP (active config)
              └─ fallback → PlatformMailer (env SMTP_*)
```

**Secrets:** AES-256-GCM via `secret-encryption.ts` (`COMMUNICATION_SECRET_KEY` or `JWT_SECRET`).

**APIs (workspace admin only):**

- `GET /hr/workspace/smtp-config` — no secrets in response
- `PUT /hr/workspace/smtp-config`
- `POST /hr/workspace/smtp-config/test`

---

## 3. Queue lifecycle

| State | Meaning |
|-------|---------|
| `pending` | Ready when `scheduled_at <= now()` |
| `processing` | Worker claimed job |
| `sent` | Email delivered |
| `failed` | Transient error; rescheduled with backoff |
| `dead_letter` | `attempts >= max_attempts` |

**Retry backoff (minutes):** 1, 5, 15, 60, 240.

**Idempotency:** unique `(workspace_id, idempotency_key)` on jobs; duplicate bus events use `onConflictDoNothing()`.

**Processor:** `startNotificationQueueProcessor()` in `init-sequence.ts` (15s interval).

---

## 4. SSE interaction

- `dispatchUserNotification` calls `emitToUser` after in-app insert (same as legacy `insertNotification`).
- `GET /stream` unchanged; still keyed by `userId`.
- Workspace context on SSE connections preserved for diagnostics.

---

## 5. Workspace notification isolation

- All bus-driven inserts include `workspace_id` from `event.workspace.workspaceId`.
- `GET /notifications`, unread count, mark-read, delete — filtered by `user_id` **and** `workspace_id`.

---

## 6. Security fixes

| Issue | Fix |
|-------|-----|
| Unauthenticated upload presign | `requireAuth` on `POST /storage/uploads/request-url` |
| Cross-workspace object access | Upload path `uploads/ws-{workspaceId}/{uuid}`; GET checks `isObjectInWorkspace` |
| Private object ACL disabled | ACL enforced when metadata present; workspace path required for all private GETs |

---

## 7. Templates (minimal)

Seeded platform defaults (`workspace_id` NULL):

- `leave.requested`
- `leave.approved`
- `leave.rejected`
- `workflow.step.pending`

Leave bus listeners enqueue email for requested/approved/rejected. Approval created enqueues `workflow.step.pending`.

---

## 8. Remaining gaps (not P19-B)

- Document registry / secure file metadata (P19-C)
- PDF engine, report UI
- Redis/BullMQ (optional future scale-out)
- Payroll email rollout, SMS/WhatsApp
- Virus scan on upload (hook interface only in P19-A security doc)
- Migrate inline route notifications (comments, messages, calendar) to dispatch
- Persisted bus idempotency across restarts

---

## 9. Smoke tests

`artifacts/api-server/src/routes/__tests__/notification-infrastructure.smoke.test.ts`

Run: `DATABASE_URL=... pnpm --filter api-server test notification-infrastructure`
