# Workflow Runtime Analysis (Phase 3)

**Scope:** Step-by-step lifecycle analysis — where real runtime occurs vs UI-only vs config-only.

---

## 1. End-to-End Lifecycle Map

```
CREATE → SUBMIT → VALIDATE → ASSIGN → APPROVE/REJECT → ESCALATE → DELEGATE → COMPLETE → ARCHIVE
   │        │         │          │           │              │           │          │         │
   │        │         │          │           │              │           │          │         └─ soft-delete definition
   │        │         │          │           │              │           │          └─ terminal execution status
   │        │         │          │           │              │           └─ NOT IMPLEMENTED
   │        │         │          │           │              └─ CONFIG ONLY (simulation)
   │        │         │          │           └─ workflow_approvals + resume/reject
   │        │         │          └─ task step / ticket assignment step
   │        │         └─ publish validator + form field validation
   │        └─ form submit OR domain event emit
   └─ POST /workflows (definition)
```

---

## 2. Phase-by-Phase Analysis

### 2.1 Create Request

| Path | Runtime location | What happens |
|------|------------------|--------------|
| **Self-service form** | `routes/forms.ts` POST submission | Insert `form_submissions`; optional draft; generate `request_number` |
| **Canonical leave** | `routes/leave.ts` | Insert `leave_requests` + optional `leave_approval_steps` |
| **Ticket** | `routes/tickets.ts` | Insert ticket; may emit `ticket.created` |
| **Legacy approval request** | `routes/approvals.ts` POST | Insert `approvals` row linked to ticket |

**Real runtime:** DB INSERT + optional bus emit.  
**Not workflow yet:** Execution created only after matching event reaches engine.

### 2.2 Submit

| Path | Event emitted | Engine trigger |
|------|---------------|----------------|
| Form | `form.submitted` with `data.workflowEventHint` | Tier-1: `form.submitted`; Tier-2: hint string |
| Leave (canonical) | `leave.requested` | Workflows configured on that event (if any) |
| Ticket | `ticket.created` / updates | Matching definitions |
| Legacy approval | `approval.created` | Separate listener path |

**Code path:**
```
emit → appEventBus → bridge → eventDispatcher → workspace_event_logs
                                              → WorkflowEngine.handleEvent()
```

**Business rules:** Minimal at submit — mostly schema validation and permissions on route.

### 2.3 Validation

| Layer | Where | Real? |
|-------|-------|-------|
| Form field validation | `forms.ts` + client renderer | ✅ Runtime |
| Workflow publish validation | `validator.ts`, `validation-engine.ts` | ✅ Runtime (admin) |
| Execution pre-conditions | `engine.ts` condition JSONB | ✅ Runtime |
| Per-step conditions | `executor.ts` before step handler | ✅ Runtime |
| Procurement/leave policy gates | Domain services | ✅ Parallel paths |

**Permissions:** Route middleware (`requireAuth`, `requirePermission`, workspace admin for form review).

### 2.4 Assignment

| Mechanism | Handler | Target entity |
|-----------|---------|---------------|
| Workflow **task** step | `steps/task.ts` | `workflow_tasks.assignee_id` |
| Workflow **assignment** step | `steps/assignment.ts` | `tickets.assignee` |
| Ticket create/update | tickets routes | Direct assignee |
| Leave approval steps | `leave.ts` | `leave_approval_steps.approver_user_id` |

**Routing logic:**
- Resolvers: `role`, `specific`, `manager`, `creator` (task/notification)
- **Not implemented:** `department_head`, `round_robin` (blocked at validate)

**Real runtime:** DB writes in step handlers during `runStepLoop`.

### 2.5 Approval

#### Automation path (canonical for configured workflows)

1. `executeApprovalStep()` resolves approver IDs (role/manager/specific).
2. Inserts `notifications` type `approval_request`.
3. Executor: guarded UPDATE `running` → `waiting_approval`; loop exits.
4. Approver calls `POST /workflows/executions/:id/approve` (requires `workflow.manage`).
5. `resumeExecution()`: guarded UPDATE → `running`; insert `workflow_approvals`; loop from `currentStepIndex + 1`.

#### Legacy ticket path

1. `POST /approvals` → row in `approvals`.
2. `PATCH /approvals/:id` → status update + `approval.completed` event.
3. **Does not** touch `workflow_executions`.

#### Leave path

1. Steps in `leave_approval_steps` with sequential resolution in `leave.ts`.
2. Bus notifications via `notifications-bus.ts` for leave events.

**Permission enforcement:** Workflow approve = **`workflow.manage`**, not “listed approver only”.

### 2.6 Rejection

| Path | Terminal state | Record |
|------|----------------|--------|
| Workflow | `failed` + `error` message | `workflow_approvals.action=rejected` |
| Legacy approval | `approvals.status=rejected` | Bus notification to requester |
| Leave | `leave_requests.status=rejected` | Step status updated |
| Form admin | `form_submissions.status=rejected` | Manual PATCH — **no workflow coupling** |

### 2.7 Escalation

| Type | Status |
|------|--------|
| Approval step `onTimeout: escalate` | **Simulation only** (`simulation.ts`) |
| Execution TTL exceeded | `timed_out` via `ttl.ts` at inter-step boundaries |
| Stuck waiting_approval | Detected by `GET /workflows/executions/stuck`; manual force timeout |
| Platform governance | `governance_workflow_actions` status → `escalated` |

**No runtime escalation worker** for tenant automation approvals.

### 2.8 Delegation

**Not implemented.** No OOO rules, no reassignment API for workflow approvals, no delegate table.

### 2.9 Completion

Executor reaches end of step list → guarded UPDATE `running` → `completed`, set `completed_at`.

Alternative terminals:
- `failed` (step error or rejection)
- `cancelled` (`cancel_requested` flag processed at boundary)
- `timed_out` (TTL)

Downstream side effects depend on steps executed (notifications, ticket status updates).

### 2.10 Archival

| Object | Mechanism |
|--------|-----------|
| Workflow definition | DELETE route → `deleted_at`, `status=archived` |
| Execution history | Retained (cascade only on workspace delete) |
| Form submission | Status `completed` / `cancelled` via admin |
| Version rows | Never deleted (RESTRICT FK) |

---

## 3. Execution Status State Machine (Automation)

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │ executeWorkflow
                         ▼
                    ┌──────────┐     approval step      ┌───────────────────┐
         ┌─────────│ running  │───────────────────────▶│ waiting_approval  │
         │         └────┬─────┘                          └─────────┬─────────┘
         │              │ delay step                              │ approve / reject
         │              ▼                                         ▼
         │         ┌──────────────┐                          running / failed
         │         │ waiting_delay│◀── scheduler poll
         │         └──────┬───────┘
         │                │ resume
         │                ▼
         │            running
         │
         └──────▶ completed | failed | cancelled | timed_out
```

**Owner of transitions:** `executor.ts` exclusively (guarded UPDATEs).

---

## 4. Where Real Runtime Happens

| Concern | Real runtime location |
|---------|----------------------|
| Trigger matching | `engine.ts` |
| Step execution | `executor.ts` + `steps/*` |
| Approval pause/resume | `executor.ts` |
| Delay wake-up | `scheduler.ts` + `resumeDelayedExecution` |
| TTL enforcement | `executor.ts` inter-step + approve route pre-check |
| Condition routing | `executor.ts` + `resolveNextCursor` |
| Notifications (workflow steps) | `steps/notification.ts`, `steps/approval.ts` |
| Bus-driven notifications | `listeners/notifications-bus.ts` |

---

## 5. Where Business Rules Execute

| Rule type | Location |
|-----------|----------|
| Workflow trigger conditions | `conditions.ts` |
| Step skip conditions | `executor.ts` before handler |
| Publish safety rules | `validation-engine.ts` |
| Leave policy / balance | `leave.ts`, HR services |
| Procurement thresholds | procurement approval service |
| Form required fields | forms route + renderer |
| Commercial/subscription gates | unrelated modules |

**Workflow engine does not** centralize all business rules — only automation step config + conditions.

---

## 6. Where Permissions Execute

| Action | Permission |
|--------|------------|
| Manage definitions | `workflow.manage` or `workflows.{id}.manage` |
| Approve/reject execution | `workflow.manage` |
| View executions | Workflow read permissions on routes |
| Form submit | Auth + form permissions JSON |
| Form review status | Workspace admin |
| Legacy approval | Ticket/approval route auth |
| Leave approve | Leave-specific route permissions |

**Gap:** Approver notification list ≠ approve ACL.

---

## 7. Where Routing Executes

| Routing type | Mechanism |
|--------------|-----------|
| Event → workflow | `trigger_event` + optional `workflowEventHint` |
| Step order | Array index cursor |
| Conditional branch | `condition` step → `onTrueStepIndex` / `onFalseStepIndex` |
| Form → workflow | `form_definitions.workflow_event` → hint |
| Leave approver chain | `leave_approval_steps` order in domain code |

---

## 8. Process History Persistence

| Artifact | Table | When written |
|----------|-------|--------------|
| Trigger event | `workspace_event_logs` | Every dispatch |
| Execution start | `workflow_executions` | Engine INSERT |
| Step I/O | `workflow_execution_steps` | Each step start/complete |
| Approval decision | `workflow_approvals` | Approve/reject API |
| Published definition | `workflow_definition_versions` | Activate |
| Human task | `workflow_tasks` | Task step |

**Reconstruction:** `workflow-detail.tsx` loads executions + expandable step logs.

---

## 9. Failure & Stuck Scenarios

| Scenario | Behavior |
|----------|----------|
| Process crash mid-step | Step may partial-complete; execution stuck `running` until TTL |
| Crash after approve UPDATE before loop | Stuck `running` (documented P4-E limitation) |
| No approvers resolved | Approval step **skips** (success with `skipped: true`) — may auto-complete chain |
| Rate limit exceeded | Engine suppresses new executions (warn log) |
| Chain depth > 5 | New execution rejected |

---

## 10. Runtime vs UI Summary

| User action | UI surface | Backend runtime |
|-------------|------------|-----------------|
| Submit self-service form | `self-service.tsx`, form renderer | ✅ forms route + bus |
| Track my request | `/my-submissions` | ⚠️ Partial — only joins **running** executions + pending **tasks**, misses `waiting_approval` |
| Approve workflow execution | **No dedicated employee UI** | API only (`workflow.manage`) |
| Approve ticket | `approvals.tsx` | Legacy `approvals` table |
| Approve leave | HR UI / leave routes | `leave_approval_steps` |
| Admin workflow runs | `workflow-detail.tsx` | Read-only execution logs |
| Force timeout / cancel | Admin API | ✅ routes in workflows.ts |

---

*End of Phase 3 — Runtime Analysis.*
