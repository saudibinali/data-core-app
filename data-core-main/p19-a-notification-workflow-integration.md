# P19-A — Notification & Workflow Integration

**Date:** 2026-05-19  
**Type:** Architecture foundation only.

---

## 1. Integration principles

- **Single entry:** Domain events → `appEventBus` → notification engine
- **Dual channel:** In-app (immediate) + email (async) per user preference
- **Workflow engine** emits same events as manual domain actions
- **No duplicate sends:** `idempotency_key` per event + recipient + channel

---

## 2. Workflow triggers

| Trigger | Source | Example events |
|---------|--------|----------------|
| Step entered | WorkflowEngine | `workflow.step.pending` |
| Step completed | WorkflowEngine | `workflow.step.completed` |
| SLA breach | Scheduler | `workflow.sla.overdue` |
| Form submitted | forms route | `form.submitted` |
| Approval required | leave/tickets | `leave.requested`, `approval.pending` |

**Existing:** `lib/workflows/steps/notification.ts`, `approval.ts`

**Gap:** Form submissions — bus listener exists but **email recipients not fully defined** (per notifications-bus comments).

---

## 3. Approval notifications

| Domain | In-app | Email (target) |
|--------|--------|----------------|
| Leave canonical | Yes (bus) | Approver on `pending_approval` |
| Tickets | Yes | Assignee |
| Generic approvals | Yes | `approvals` table actors |
| HR document approval | Future | HR manager |

**Template keys:** `leave.approval.requested`, `leave.approval.decided`

---

## 4. Payroll notifications (future)

| Event | Recipients |
|-------|------------|
| Payslip published | Employee |
| Payroll run approved | Finance role |
| Payroll run failed | Admin |

**Channel:** Email with PDF attachment + in-app link (no attachment in DB notification row).

---

## 5. Attendance alerts

| Event | Recipients |
|-------|------------|
| Import completed with errors | HR manage |
| Import failed | Uploader |
| Anomaly: excessive absence | Manager (future AI) |
| Missing punch reminder | Employee digest |

**Template keys:** `attendance.import.summary`, `attendance.anomaly`

---

## 6. Leave alerts

| Event | Recipients | Status today |
|-------|------------|--------------|
| `leave.requested` | Approver | Bus → in-app |
| `leave.approved` | Employee | Bus |
| `leave.rejected` | Employee | Bus |
| `leave.withdrawn` | Approver | Bus |
| Escalation (no action 48h) | Manager + HR | **Not implemented** |

**Post P18-D4:** Canonical leave events are authoritative; legacy leave does not emit bus events.

---

## 7. Escalation reminders

```text
pending_approval → +24h reminder → +48h escalate → +72h digest to HR admin
```

- Stored as scheduled `notification_jobs`
- Cancelled when status → terminal
- Workspace-configurable intervals

---

## 8. Digest notifications

| Digest | Frequency | Content |
|--------|-----------|---------|
| Manager | Daily 08:00 workspace TZ | Pending approvals count + links |
| Employee | Weekly | Leave balance summary |
| HR admin | Daily | Import/report failures |

**Implementation:** Cron aggregates → single email per user (reduces SMTP volume).

---

## 9. Event bus mapping (target)

| EVENT_TYPES | Channels | Template key |
|-------------|----------|--------------|
| LEAVE_REQUESTED | in_app, email | leave.requested |
| LEAVE_APPROVED | in_app, email | leave.approved |
| LEAVE_REJECTED | in_app, email | leave.rejected |
| LEAVE_WITHDRAWN | in_app | leave.withdrawn |
| FORM_SUBMITTED | in_app, email | form.submitted |
| TICKET_* | in_app, email | ticket.* |

**Extend:** `notifications-bus.ts` to enqueue `notification_jobs` instead of only inserting `notifications`.

---

## 10. SSE integration

- Unchanged: `routes/stream.ts` pushes on new `notifications` row
- Email delivery does not require SSE
- Optional: `notification_deliveries` status change events for admin dashboard

---

## 11. Future AI hooks

| Hook | Behavior |
|------|----------|
| Smart recipient resolution | Suggest approver from org graph |
| Priority scoring | Urgent notifications surface first |
| Natural language digest | Summarize day's HR events |
| Reply parsing | **Out of scope** — no inbound email in P19 |

---

## 12. Workspace isolation

- All bus events carry `workspace: { workspaceId }`
- Listeners must not fan-out across workspaces
- Template render uses workspace branding only from matching `workspace_id`

---

**Confirmation:** Integration design only; no workflow code changes in P19-A.
