# Workflow Notifications & Reminders Audit (Phase 7)

**Scope:** How notifications, emails, reminders, and escalation alerts work in the workflow/process automation context.

---

## 1. Notification Architecture Layers

```
Layer 1: Event emission (routes, workflow steps)
              │
              ▼
Layer 2a: appEventBus → notifications-bus.ts → INSERT notifications + SSE
Layer 2b: Workflow step handlers → direct INSERT notifications
              │
              ▼
Layer 3: notification_jobs (email channel) — async processor
              │
              ▼
Layer 4: Browser SSE / in-app notification UI
```

---

## 2. In-App Notifications (Real Runtime)

### 2.1 Schema (`notifications.ts`)

- `user_id`, `type`, `title`, `message`, `is_read`
- Optional: `ticket_id`, `workspace_id`, `bus_event_id`, `notification_job_id`
- **No `link` column** in schema — workflow approval inserts `link: null` in code

### 2.2 Workflow notification step (`steps/notification.ts`)

**Operational:** ✅

- Resolves recipients: assignee, creator, manager, role, specific users, department
- Cap: 50 recipients (P3-D governance)
- Inserts `type: "workflow"` notifications
- Does not require bus event (inline insert)

### 2.3 Workflow approval step (`steps/approval.ts`)

**Operational:** ✅ (delivery only)

- Inserts `type: "approval_request"` per resolved approver
- Title: `Approval Required: {step title}`
- Message includes entity title from trigger data
- **link: null** — no navigation to approve

### 2.4 Event bus listener (`listeners/notifications-bus.ts`)

**Operational:** ✅ for migrated events

| Event | Notification type | Recipients | Status |
|-------|-------------------|------------|--------|
| `approval.created` | `approval_request` | assignee | ✅ Migrated |
| `approval.completed` | `approval_decision` | requester | ✅ Migrated |
| `ticket.created` | `ticket_assigned` | assignee | ✅ |
| `ticket.updated` | `ticket_assigned` | new assignee | ✅ |
| `ticket.status_changed` | `ticket_closed` | creator | ✅ |
| `employee.created` | `employee_created` | workspace admins | ✅ |
| `form.submitted` | `form_submitted` | **TBD — none** | ⏳ Ready, no recipients |
| `leave.requested` | `leave_request` | current approver | ✅ |
| `leave.approved` | `leave_approved` | employee | ✅ |
| `leave.rejected` | `leave_rejected` | employee | ✅ |
| `leave.withdrawn` | `leave_withdrawn` | current approver | ✅ |

**SSE:** `emitToUser()` after insert — real-time if client connected.

**Idempotency:** In-memory guard — does not survive restart.

---

## 3. Email Flows

### 3.1 Form submission confirmation

**Location:** `routes/forms.ts` — `sendSubmissionConfirmation`

**Operational:** ✅ — sends email on successful submit (uses communication/notification job infrastructure).

### 3.2 Bus-driven email

**Primary path:** `notification_jobs` table + processor (schema in `communication.ts`).

- Fields: `channel`, `recipient_email`, `status`, `scheduled_at`, idempotency key
- Workflow **notification step** does not automatically create email jobs — in-app only unless extended elsewhere.

### 3.3 Workflow-specific email templates

**Not found** as first-class workflow step channel selection (in-app default).

---

## 4. Reminders

| Reminder type | Exists? | Location |
|---------------|---------|----------|
| Approval reminder (nudge approver) | ❌ | — |
| Escalation reminder | ❌ | — |
| SLA breach reminder | ❌ | — |
| Delay step wake-up | ✅ | `scheduler.ts` — **not a user reminder**, execution resume |
| Execution TTL | ✅ | Auto `timed_out` — no prior reminder notification |
| Commercial invoice reminder | ✅ | Unrelated module (operational derivation) |

**Scheduler header explicitly states:** "No reminder engine, no escalation policies."

---

## 5. Escalation Notifications

| Source | Real? | Mechanism |
|--------|-------|-----------|
| Workflow `onTimeout: escalate` | ❌ | Config + simulation only |
| Execution stuck in waiting_approval | ⚠️ | Admin API lists stuck; no auto-notify |
| Platform governance violation | ✅ | `governance_workflow_actions` lifecycle + super-admin UI |
| Governance workflow signals | ✅ | Analytics/alerting in governance modules — ops-facing |

**Tenant-facing approval escalation product:** **Not implemented.**

---

## 6. Approval Reminders

**Expected enterprise behavior:** Periodic notifications to approvers until decision or escalation.

**Actual behavior:**
- Single notification burst when approval step executes
- No cron/worker for pending `waiting_approval`
- No re-notification on TTL approaching

---

## 7. Workflow Task Notifications

Task step creates `workflow_tasks` row — **no automatic notification** to assignee unless a separate notification step precedes/follows in workflow definition.

**Gap:** Task assignment silent unless workflow designer adds notification step.

---

## 8. Classification: Real vs Placeholder vs Non-Functional

### Real runtime notifications

- Workflow notification step → in-app
- Workflow approval step → in-app approval_request
- Legacy approval bus events → in-app
- Leave bus events → in-app
- Ticket events → in-app
- Form submit confirmation → email
- SSE push on bus-driven inserts

### Fake / placeholder

- `form.submitted` bus listener (no recipients)
- Step-level `onTimeout` escalation notifications
- Approval reminder loops
- Email as default workflow step outcome

### Non-functional / incomplete flows

- Click approval notification → approve (no link, no target UI)
- Cross-restart idempotency for duplicate prevention
- Unified notification type for legacy `assigned` vs `ticket_assigned`

---

## 9. Notification Processor & Background Jobs

| Job | File area | Workflow relation |
|-----|-----------|-------------------|
| Notification job processor | communication/notification processor | Processes email jobs queue |
| Workflow scheduler | `scheduler.ts` | Delay resume only |
| Governance scheduler | governance-scheduler.ts | Platform metrics, not tenant reminders |

---

## 10. Observability

- `bus_event_id` on notifications links to `workspace_event_logs` via UUID in payload
- Workflow engine links executions to `trigger_event_log_id`
- Structured logs: `approval_requested`, `execution_approved`, scheduler poll cycle

**Good traceability for ops** — less helpful for end-user notification history UI.

---

## 11. Risks

1. **Single-shot approval notify** — approvers forget; no reminder.
2. **Silent form.submitted** — admins may expect notify on every submission.
3. **No deep links** — approval notifications dead-end.
4. **In-app only automation** — email-dependent users miss workflow events.
5. **Fanout cap 50** — large role approver sets truncated without user-visible error.

---

## 12. Summary Table

| Capability | Status |
|------------|--------|
| In-app workflow notifications | ✅ Operational |
| In-app approval request | ✅ Operational (delivery) |
| Email on workflow step | ❌ Not default |
| Form confirmation email | ✅ Operational |
| Approval reminders | ❌ Absent |
| Escalation reminders | ❌ Absent |
| TTL timeout | ✅ Execution level, no warning |
| Delay wake-up | ✅ Operational |
| Platform governance alerts | ✅ Separate product |

---

*End of Phase 7 — Notifications & Reminders Audit.*
