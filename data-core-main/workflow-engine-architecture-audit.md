# Workflow Engine — Architecture Audit (Phase 1)

**Scope:** Read-only discovery — no code, schema, API, or UI changes.  
**Date:** 2026-05-20  
**Repo root:** `data-core-main/`

---

## Executive Summary

The platform contains a **real, event-driven workflow automation engine** implemented in `artifacts/api-server/src/lib/workflows/`. It is backed by six primary DB tables, seven step types, approval pause/resume, delay scheduling, publish governance, and extensive test coverage (30+ test files).

At the same time, the system is **not a unified enterprise BPM platform**. Approval, leave, tickets, procurement, payroll, and platform governance each use **parallel patterns**. Shared packages `@workspace/core-workflows` and `@workspace/core-approvals` are **type-only placeholders** not wired to runtime.

**Classification:** **Semi-dynamic, partially operational, metadata-heavy, fake-dynamic in places** (approval modes, escalation, delegation configured in UI/types but not enforced at runtime).

---

## 1. Current Workflow Engine Components

### 1.1 Runtime engine (canonical automation)

| Component | Path | Role |
|-----------|------|------|
| **WorkflowEngine** | `artifacts/api-server/src/lib/workflows/engine.ts` | Listens on event dispatcher; matches triggers; creates executions |
| **Executor** | `artifacts/api-server/src/lib/workflows/executor.ts` | Step loop, approve/reject resume, delay resume, status guards |
| **Scheduler** | `artifacts/api-server/src/lib/workflows/scheduler.ts` | Poll-based delay wake-up (15s interval) |
| **Conditions** | `conditions.ts` | JSONB condition evaluation on trigger + step data |
| **Validator** | `validator.ts`, `validation-engine.ts` | Pre-publish governance checks |
| **TTL** | `ttl.ts` | Execution-level 24h default timeout |
| **Simulation** | `simulation.ts` | Dry-run only; models approval timeout policies **not applied in production** |
| **Step handlers** | `steps/*.ts` | notification, approval, task, condition, status_update, assignment, delay |
| **Governance analytics** | `governance*.ts`, `compliance-workflow-orchestration.ts` | Read-heavy ops/compliance surfaces |
| **HTTP API** | `artifacts/api-server/src/routes/workflows.ts` (~3.5k lines) | CRUD, publish, executions, approve/reject, analytics |
| **Startup** | `init-sequence.ts` | `workflowEngine.start()` + scheduler |

### 1.2 Shared contract packages (placeholder)

| Package | Path | Status |
|---------|------|--------|
| `@workspace/core-workflows` | `lib/core-workflows/` | Types + README; **not imported by runtime**; uses `id`/`dependsOn` graph unlike DB `index` model |
| `@workspace/core-approvals` | `lib/core-approvals/` | Types only; **not connected** to routes or workflow steps |

### 1.3 Parallel “workflow” systems (not the automation engine)

| System | Location | Nature |
|--------|----------|--------|
| Legacy ticket approvals | `routes/approvals.ts`, `schema/approvals.ts` | Ticket-scoped `approvals` table |
| Canonical leave | `routes/leave.ts`, `leave_requests`, `leave_approval_steps` | Domain state machine |
| Payroll run workflow | `lib/payroll/payroll-run-workflow.ts` | Service class, not `workflow_definitions` |
| Procurement approval | procurement services + policy gates | Domain-specific |
| Platform governance workflows | `governance_workflow_actions`, `routes/platform.ts` | Violation remediation lifecycle |
| Inventory transfer approval | inventory service `pending_approval` | Policy-based |

---

## 2. Capability Matrix

| Capability | Present? | Operational? | Notes |
|------------|----------|--------------|-------|
| **Workflow definitions** | ✅ | ✅ | `workflow_definitions` JSONB steps/conditions |
| **Workflow instances** | ✅ | ✅ | `workflow_executions` |
| **Workflow runtime** | ✅ | ✅ | In-process executor + event bus |
| **Transition engine** | ✅ | ✅ Partial | Linear cursor + condition jumps; no generic BPMN |
| **Approval engine** | ✅ | ⚠️ Partial | Single pause/resume; multi-step types not enforced |
| **Queue system** | ❌ | — | No job queue; synchronous in-process resume |
| **Escalation engine** | ⚠️ Config only | ❌ | `onTimeout: escalate` in seeds/simulation; no runtime |
| **Delegation support** | ❌ | ❌ | Mentioned in `core-approvals` types as future |
| **SLA tracking** | ⚠️ | Partial | Execution TTL 24h; no per-step SLA product |
| **Reminders** | ❌ | ❌ | Scheduler explicitly excludes reminders |
| **Notifications** | ✅ | ✅ | In-app via workflow steps + bus listener |
| **Audit logs** | ✅ | ✅ | `workflow_execution_steps`, `workflow_approvals`, version snapshots |
| **Process history** | ✅ | ✅ | Execution steps + approvals + event log linkage |

---

## 3. Lifecycle Operations

### 3.1 Create workflow (definition)

1. Admin: `POST /workflows` → row in `workflow_definitions` (`status=draft` by route).
2. Steps/triggers stored as JSONB in DB — **dynamic at config level**.
3. UI: `ops-platform/src/pages/workflows.tsx`, `CreateWorkflowSheet.tsx`.

### 3.2 Activate / publish workflow

1. `POST /workflows/:id/validate` → governance validation.
2. `POST /workflows/:id/activate` → immutable row in `workflow_definition_versions`, `status=active`, version++.
3. Active definitions are **immutable** (PATCH blocked while active).

### 3.3 Run workflow (instance)

1. Domain or form event → `appEventBus` → bridge → `eventDispatcher` → `workspace_event_logs`.
2. `WorkflowEngine.handleEvent()` matches `trigger_event` (+ Tier-2 `workflowEventHint` for forms).
3. Evaluates definition-level conditions.
4. Inserts `workflow_executions` with `steps_snapshot`, `timeout_at`, `workflow_version`.
5. Calls `executeWorkflow()` → `runStepLoop()`.

### 3.4 Execute transition (step)

- Executor dispatches by `step.type` to handler.
- **Approval:** pause → `waiting_approval`, exit loop.
- **Delay:** pause → `waiting_delay`, scheduler resumes later.
- **Condition:** may jump via `onTrueStepIndex` / `onFalseStepIndex`.
- Inter-step: TTL check, cancel flag, guarded status UPDATEs.

### 3.5 Persist state

- Execution row: `status`, `current_step_index`, `context` JSONB.
- Per-step audit: `workflow_execution_steps` (input/output/timing).
- Human artifacts: `workflow_tasks`, `workflow_approvals`.

### 3.6 Close process

Terminal statuses: `completed`, `failed`, `cancelled`, `timed_out`.  
Pauses: `waiting_approval`, `waiting_delay` (non-terminal).

---

## 4. Dynamic vs Hardcoded vs Placeholder

| Layer | Dynamic | Hardcoded | Placeholder |
|-------|---------|-----------|-------------|
| Triggers | DB `trigger_event`, conditions, form hint | Rate limit 100/min, chain depth 5, TTL 24h | — |
| Steps | JSONB array, 7 types | Step type enum fixed | `dependsOn` in core-workflows unused |
| Approvers | role / specific / manager resolution | Notify cap 50 | `department_head`, multi/sequential/parallel modes |
| Routing | Condition jumps | Forward-only routing rules | — |
| Escalation | UI/config + simulation | — | Runtime enforcement absent |
| Delegation | — | — | Entire feature |
| Email | Form confirmation, notification jobs | — | Many bus events have no email template |

**Verdict:** **Semi-dynamic** — definitions and routing are DB-driven; enterprise approval/escalation/delegation semantics are largely **configuration theater**.

---

## 5. Canonical vs Legacy vs Unused

### Canonical (preferred for workspace automation)

- `workflow_definitions` + `workflow_definition_versions` + `workflow_executions`
- Event bus → engine → executor
- Form routing via `form.submitted` + `workflowEventHint`
- Workflow approve/reject: `POST /workflows/executions/:id/approve|reject`

### Legacy (still active)

- `approvals` table + `PATCH /approvals/:id` (ticket-only)
- `hr_employee_leaves` vs `leave_requests` (migration in progress)
- `isActive` column synced with `status` for backward compat
- Notification type `"assigned"` vs `"ticket_assigned"` (dual semantics)

### Unused / disconnected

- `@workspace/core-workflows` runtime integration
- `@workspace/core-approvals` entity model
- `status_update` for `entity: "approval"` (type allows; handler does not)
- `round_robin` assignment (blocked at validation)
- `form.submitted` bus listener recipients (marked TBD in notifications-bus)

### Placeholder-only

- Per-step `timeoutHours` / `onTimeout` (simulation + seeds only)
- Workflow builder “enterprise” approval types without runtime differentiation
- Super-admin governance workflow UI (separate product surface from tenant automation)

---

## 6. Architectural Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Domain routes   │     │ forms.ts         │     │ tickets, leave, etc. │
│ emit events     │────▶│ form.submitted   │────▶│ workspace_event_logs │
└─────────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                               │
                                                    eventDispatcher (*)
                                                               │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │ WorkflowEngine      │
                                                    │ match + conditions  │
                                                    └──────────┬──────────┘
                                                               │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │ workflow_executions │
                                                    │ executor.runStepLoop│
                                                    └──────────┬──────────┘
                          ┌────────────────────────────────────┼────────────────────────┐
                          ▼                    ▼                 ▼                        ▼
                   notification           approval            task                   delay
                   (notifications)    (waiting_approval)  (workflow_tasks)    (scheduler poll)
```

---

## 7. Key Risks (Architecture)

1. **Three approval models** — workflow_approvals, legacy approvals, leave_approval_steps.
2. **Permission vs approver identity** — `workflow.manage` approves any waiting execution.
3. **Form status decoupled** from execution outcome.
4. **In-process resume** — crash between UPDATE and loop leaves stuck `running`.
5. **Package drift** — core-workflows types ≠ api-server types.
6. **routes/workflows.ts monolith** — operational and analytics concerns mixed.

---

## 8. File Reference Index

| Concern | Primary files |
|---------|---------------|
| Engine | `artifacts/api-server/src/lib/workflows/engine.ts` |
| Executor | `artifacts/api-server/src/lib/workflows/executor.ts` |
| Schema | `lib/db/src/schema/workflows.ts` |
| API | `artifacts/api-server/src/routes/workflows.ts` |
| Seeds | `artifacts/api-server/src/seed/workflows.ts` |
| UI list/detail | `artifacts/ops-platform/src/pages/workflows.tsx`, `workflow-detail.tsx` |
| Prior summary | `system-workflow-automation-audit.md` |

---

*End of Phase 1 — Architecture Audit.*
