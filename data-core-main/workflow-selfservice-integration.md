# Workflow & Self-Service Integration Audit (Phase 4)

**Scope:** How self-service, HR requests, forms, approvals, and workflows connect.

---

## 1. Integration Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Employee Self-Service Portal                  │
│  ops-platform/src/pages/self-service.tsx                        │
│  Tabs: Services | Forms | My Requests | Pending Approvals       │
└────────────┬───────────────────────────────┬────────────────────┘
             │                               │
             ▼                               ▼
   GET /self-service/forms          GET /self-service/services
   GET /my-submissions              (catalog metadata)
             │
             ▼
   POST /forms/:id/submit ──▶ form_submissions + form.submitted event
             │
             ▼
   WorkflowEngine (Tier-1 + Tier-2 hint match) ──▶ workflow_executions
```

**Parallel paths (not through generic forms):**
- Canonical leave → `POST /leave/requests` → `leave.requested`
- Tickets → ticket routes → `ticket.*` events
- Legacy approvals → ticket-linked `approvals` table

---

## 2. Self-Service Components

### 2.1 API endpoints (`routes/forms.ts`)

| Endpoint | Purpose |
|----------|---------|
| `GET /self-service/forms` | Active forms with `show_in_self_service=true`, filtered by `permissions.visibleTo` |
| `GET /self-service/services` | Service catalog (metadata for portal tiles) |
| `POST /forms/:id/submit` | Create/update submission, emit event |
| `GET /my-submissions` | User's submissions + weak workflow progress join |

### 2.2 UI (`self-service.tsx`)

- Renders categorized service tiles and form cards.
- Inline form dialog via `InlineFormDialog` / form renderer.
- **My Requests:** lists submissions with status badges.
- **Pending Approvals section:** uses `useListApprovals` — **legacy ticket approvals**, not workflow executions.

---

## 3. Forms → Workflow Routing

### 3.1 Mechanism

1. Admin sets `form_definitions.workflow_event` (e.g. `hr.form.submitted`, `approvals.form.submitted`).
2. On submit, route emits `EVENT_TYPES.FORM_SUBMITTED` with payload:
   - `submissionId`, form metadata, answers
   - `data.workflowEventHint = form.workflowEvent`
3. Engine Tier-1 matches `trigger_event = 'form.submitted'`.
4. Engine Tier-2 matches `trigger_event = workflowEventHint` for per-form workflows.

**Documented in:** `engine.ts` header, `seed/forms.ts`.

### 3.2 Intentional separation

Generic forms **must not** emit domain events like `leave.requested` — those require typed payloads validated in leave routes. HR leave forms use hint `hr.form.submitted`; canonical leave uses dedicated API.

---

## 4. Dynamic vs Hardcoded Assessment

| Dimension | Dynamic? | Evidence |
|-----------|----------|----------|
| **Self-service catalog** | ✅ Semi | DB-driven forms + services; icon/category heuristics hardcoded in UI |
| **Form fields** | ✅ Yes | `form_fields` schema, conditional rules, data sources |
| **Form → workflow link** | ✅ Yes | Per-form `workflow_event` hint |
| **Approval chains (forms)** | ⚠️ Via workflow steps | Depends on admin-configured workflows, not form schema |
| **Routing** | ✅ Semi | Event + hint matching; no visual routing designer beyond workflow builder |
| **Hardcoded services** | ⚠️ Partial | Seed forms/workflows in `seed/forms.ts`, `seed/workflows.ts`; UI icon maps hardcoded |
| **HR leave** | ⚠️ Dual | Form path vs canonical `leave.ts` — workspace `leave_runtime_mode` |

---

## 5. Form Submission Lifecycle vs Workflow

| Stage | Form table | Workflow table | Sync? |
|-------|------------|----------------|-------|
| Draft | `status=draft` | — | N/A |
| Submit | `status=submitted` | Execution may start | Loose |
| Pending approval | Admin PATCH `pending_approval` | May be `waiting_approval` | **Manual / independent** |
| Approved | Admin PATCH `approved` | May be `completed` or `failed` | **Not automatic** |
| Rejected | Admin PATCH `rejected` | May still run | **Not automatic** |

**Critical gap:** Form review API does not call workflow approve/reject endpoints.

---

## 6. My Requests Progress Tracking

`GET /my-submissions` enrichment logic:

1. Finds executions with `status='running'` only.
2. Matches `context.submissionId` to submission id.
3. Joins pending `workflow_tasks` for assignee name.

**Misses:**
- Executions in `waiting_approval` (most common approval pause state).
- Approver identity from approval step notifications.
- Legacy ticket approvals linked to submissions (none — submissions aren't tickets).

---

## 7. HR Requests Integration

### Canonical leave (`routes/leave.ts`)

- Tables: `leave_requests`, `leave_approval_steps`
- Events: `leave.requested`, `leave.approved`, `leave.rejected`, `leave.withdrawn`
- Notifications: `notifications-bus.ts` leave handlers
- **Does not use** `approvals` table or workflow approval steps by design

### HR form self-service

- Seed forms target `hr.form.submitted` hint
- Workflows on that hint can notify/assign/create tasks
- **Misconfiguration risk:** Using form-only path when canonical leave is required

### Workspace setting

`hr_workspace_settings.leave_runtime_mode`:
- `legacy` — old tables/flows
- `transition` — migration period
- `canonical` — preferred leave_requests path

---

## 8. Approvals in Self-Service Context

| Approval source | Shown in self-service? | API used |
|-----------------|------------------------|----------|
| Legacy ticket approvals | ✅ Pending tab | `useListApprovals` |
| Workflow waiting_approval | ❌ Not in employee inbox | Needs `workflow.manage` admin API |
| Leave approval steps | ⚠️ Via HR modules / notifications | Leave routes |
| Form admin review | ❌ Employee sees status only | Admin `PATCH /form-submissions/:id` |

**User confusion:** “Approvals” tab is ticket-centric; form/workflow approvals appear elsewhere or not at all.

---

## 9. Seed & Bootstrap Data

| File | Content |
|------|---------|
| `seed/forms.ts` | HR, approvals, system forms with hints |
| `seed/workflows.ts` | Example automations on ticket/form events |
| Init sequence | Loads seeds per workspace bootstrap |

Seeds demonstrate intended wiring but **tenant customization** is expected via admin UI.

---

## 10. Integration Strengths

1. Clean bus contract: one canonical `form.submitted` + routing hint.
2. Dynamic form builder with rich field types.
3. Self-service visibility flags and permission JSON on forms.
4. Event traceability via `trigger_event_log_id` on executions.
5. Confirmation email on form submit (operational).

---

## 11. Integration Gaps

1. **Dual approval UX** — self-service shows legacy approvals only.
2. **Form status orphan** — submission status not driven by workflow terminal state.
3. **My Requests incomplete** — ignores `waiting_approval`.
4. **No submission ↔ execution FK** — fragile context JSON matching.
5. **Leave dual path** — forms vs canonical API coexist.
6. **core-approvals** not used for `form_submission` entity type despite type design.

---

## 12. Recommendations (Documentation Only — No Implementation)

Future stabilization (for planning, not executed in this audit):

1. Unify employee approval inbox (workflow + leave + legacy or deprecate legacy).
2. Sync form submission status from execution terminal events.
3. Extend my-submissions join to include `waiting_approval` and approver from context.
4. Document per-workspace which leave path is active.
5. Wire `@workspace/core-approvals` ApprovalEntityRef for form_submission.

---

*End of Phase 4 — Self-Service Integration.*
