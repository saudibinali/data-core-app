# Workflow Data Model Audit (Phase 2)

**Scope:** Read-only documentation of persistence layer for workflow, forms, approvals, notifications, and related process entities.

---

## 1. Primary Automation Tables

Source: `lib/db/src/schema/workflows.ts`

### 1.1 `workflow_definitions`

| Column group | Purpose |
|--------------|---------|
| Identity | `id`, `workspace_id`, `key`, `name`, `name_ar`, `module` |
| Trigger | `trigger_event`, `conditions` (JSONB) |
| Definition body | `steps` (JSONB array) |
| Lifecycle | `status` (`draft`/`active`/`deprecated`/`archived`), `is_active`, `deleted_at`, `archived_at` |
| Publish (P5-E) | `version`, `current_version_id`, `published_at`, `published_by` |
| Audit | `created_by`, timestamps |

**Relations:**
- `workspace_id` → `workspaces.id` (CASCADE)
- `created_by`, `published_by` → `users.id` (SET NULL)

**Indexes:** workspace, trigger, key, status.

### 1.2 `workflow_definition_versions`

Immutable publish snapshots.

| Column | Purpose |
|--------|---------|
| `definition_id` | FK → definitions (ON DELETE **RESTRICT**) |
| `version` | Monotonic per definition |
| Frozen copy | `steps`, `conditions`, `trigger_event`, `name` |
| Governance | `validation_summary`, `change_notes`, `deactivated_at/by` |

**Invariant (app-layer):** one active version per definition when `status=active`.

### 1.3 `workflow_executions` (runtime instance)

| Column | Purpose |
|--------|---------|
| Core | `workflow_id`, `workspace_id`, `status`, `current_step_index`, `context` JSONB |
| Traceability | `trigger_event_log_id`, `triggered_by` |
| Timing | `started_at`, `completed_at`, `timeout_at` (24h default) |
| Governance | `cancel_requested`, `error` |
| Immutability (P5-A) | `steps_snapshot`, `workflow_version` |
| Delay (P6-A) | `wake_at`, `waiting_reason`, `scheduled_step_index`, `resumed_at` |

**Status values (observed):** `pending`, `running`, `waiting_approval`, `waiting_delay`, `completed`, `failed`, `cancelled`, `timed_out`.

**Relations:**
- `workflow_id` → `workflow_definitions.id` (CASCADE)
- `workspace_id` → `workspaces.id` (CASCADE)
- `triggered_by` → `users.id` (SET NULL)

**Note:** No FK from `trigger_event_log_id` to `workspace_event_logs` in schema (integer reference only).

### 1.4 `workflow_execution_steps` (step history)

Per-step audit trail: `step_index`, `step_type`, `step_name`, `status`, `input`, `output`, `error`, timestamps.

**Relation:** `execution_id` → `workflow_executions.id` (CASCADE)

### 1.5 `workflow_tasks` (human tasks)

Created by **task** steps: assignee, due date, priority, status (`pending`/completed).

**Relations:** `execution_id` → executions; `assignee_id` → users.

### 1.6 `workflow_approvals` (automation decisions)

Records approve/reject on paused executions (P4-E/P5-F).

| Column | Purpose |
|--------|---------|
| `execution_id`, `step_index`, `step_name` | Which approval step |
| `action` | `approved` / `rejected` |
| `decided_by`, `notes`, `decided_at` | Audit |
| `step_snapshot`, `workflow_version`, `execution_timeout_at` | Frozen governance metadata |

**Relations:** execution (CASCADE), workspace (CASCADE), workflow definition (SET NULL).

---

## 2. Forms & Self-Service Tables

Source: `lib/db/src/schema/forms.ts`

### 2.1 `form_definitions`

| Column | Workflow relevance |
|--------|-------------------|
| `workflow_event` | Routing hint → `workflowEventHint` in bus payload |
| `show_in_self_service` | Portal visibility |
| `permissions` JSON integration | null, no FK to executions.

### 2.2 `form_fields`

Dynamic field schema: types, validation, conditional display, `data_source` for live lookups.

### 2.3 `form_submissions`

| Column | Purpose |
|--------|---------|
| `status` | `draft`/`submitted`/`pending_approval`/`approved`/`rejected`/`cancelled`/`completed` |
| `data` | JSONB answers |
| `request_number` | REQ-YYYY-NNNNN |
| `reviewed_by_id`, `review_note` | Manual admin review |

**No FK to `workflow_executions`.** Link is logical via `context.submissionId`.

### 2.4 `form_submission_files`

Attachment metadata per submission field.

---

## 3. Legacy Approval Table

Source: `lib/db/src/schema/approvals.ts`

### `approvals`

| Column | Constraint |
|--------|------------|
| `ticket_id` | **NOT NULL** — ticket-only |
| `approver_user_id`, `requested_by_user_id` | Optional user refs |
| `status`, `comment` | Simple pending/approved/rejected |

**Orphan risk:** Cannot represent form or leave approvals without ticket.

---

## 4. Canonical Leave (Domain Process)

Source: `lib/db/src/schema/hr.ts`

### `leave_requests`

Central leave lifecycle: employee, dates, status machine, policy refs.

### `leave_approval_steps`

Multi-step chain per request: `step_order`, `approver_user_id`, `status`, decision metadata.

**Unique:** `(leave_request_id, step_order)`.

### Related config

- `hr_leave_policies.requires_approval`
- `hr_workspace_settings.leave_runtime_mode` (`legacy` | `transition` | `canonical`)

**Explicitly separate** from `approvals` and workflow engine for canonical path.

---

## 5. Notification Entities

Source: `lib/db/src/schema/notifications.ts`, `communication.ts`

### `notifications`

In-app delivery: `user_id`, `type`, `title`, `message`, `ticket_id`, `is_read`, `bus_event_id`, optional `workspace_id`, `notification_job_id`.

**Workflow types observed:** `workflow`, `approval_request` (inline from approval step), plus bus-driven types.

### `notification_jobs`

Email/async channel queue: `channel`, `recipient_email`, `status`, `scheduled_at`, idempotency key.

**Relation to workflow:** Indirect — workflow notification step inserts `notifications` directly; email may use jobs elsewhere (form confirmation).

---

## 6. Platform Governance (Separate “Workflow”)

Source: `lib/db/src/schema/governance-workflow-actions.ts`

### `governance_workflow_actions`

Violation remediation lifecycle — **not** automation engine instances.

Columns: `workflow_action_id`, `violation_id`, `workflow_status`, `escalation_level`, resolution fields.

---

## 7. Event Log (Trigger Provenance)

`workspace_event_logs` (referenced by `workflow_executions.trigger_event_log_id`) — stores dispatched events that may spawn executions.

---

## 8. Entity Relationship Summary

```
workspaces
  ├── workflow_definitions ──< workflow_definition_versions
  │         └──< workflow_executions ──< workflow_execution_steps
  │                   ├──< workflow_tasks
  │                   └──< workflow_approvals
  ├── form_definitions ──< form_fields
  │         └──< form_submissions ──< form_submission_files
  ├── leave_requests ──< leave_approval_steps
  └── notifications (user-scoped)

tickets ──< approvals (legacy, ticket required)
```

---

## 9. How Runtime Data Is Stored

| Concern | Storage |
|---------|---------|
| **Workflow states** | `workflow_executions.status` + `current_step_index`; step-level in `workflow_execution_steps.status` |
| **Approvers (config)** | Inside `workflow_definitions.steps[].config` JSONB |
| **Approvers (resolved)** | Not persisted as rows; only notification inserts + logs |
| **Approvers (decision)** | `workflow_approvals.decided_by` |
| **Transitions** | Implicit via step index + condition routing; no separate transition table |
| **Assignments** | Ticket assignee updates; `workflow_tasks.assignee_id` |
| **Comments** | Ticket comments; approval `notes`; form `review_note` — **no unified comment model** |
| **Attachments** | `form_submission_files`; tickets attachments elsewhere |
| **Escalation records** | `governance_workflow_actions.escalation_level` (platform only); automation escalation **not stored** |
| **Reminders** | **No table** |

---

## 10. Structural Issues

### Orphan / duplicate structures

| Issue | Detail |
|-------|--------|
| Dual approval tables | `approvals` vs `workflow_approvals` vs `leave_approval_steps` |
| Dual leave models | `hr_employee_leaves` (legacy) vs `leave_requests` (canonical) |
| Governance “workflow” naming | `governance_workflow_actions` ≠ `workflow_executions` |
| No process_instance table | Generic BPM instance concept absent |

### Dead / future-only

- `core-approvals` entity types — no matching polymorphic approval table
- Per-step timeout columns — config in JSONB only; no `approval_timeout_events` table
- Delegation — no `delegation_rules` or OOO tables

### Nullable chaos

- `workflow_executions.steps_snapshot` NULL on pre-P5-A rows → resume uses live definition (drift risk)
- `workflow_executions.timeout_at` NULL → never times out
- `notifications.workspace_id` nullable
- Many user FKs SET NULL on delete — audit preserved but actor identity lost

### Duplicate semantics

- `is_active` vs `status` on definitions
- Form `status` vs execution `status` — independent lifecycles

---

## 11. Table Inventory Checklist

| Table | Runtime entity? | Process entity? | Approval? | Notification? | History? |
|-------|-----------------|-----------------|-----------|---------------|----------|
| workflow_definitions | Def | ✅ | Config | — | Version rows |
| workflow_executions | ✅ | ✅ | Pause state | — | ✅ |
| workflow_execution_steps | ✅ | — | — | — | ✅ |
| workflow_approvals | ✅ | — | ✅ | — | ✅ |
| workflow_tasks | ✅ | — | — | — | Partial |
| form_submissions | ✅ | ✅ | Manual status | — | Partial |
| approvals | ✅ | Ticket | ✅ Legacy | Via bus | Minimal |
| leave_approval_steps | ✅ | Leave | ✅ Domain | Via bus | ✅ |
| notifications | Delivery | — | — | ✅ | Soft |
| governance_workflow_actions | Platform | Governance | — | — | ✅ |

---

*End of Phase 2 — Data Model Audit.*
