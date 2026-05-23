# Workflow UI/UX Audit (Phase 6)

**Scope:** User-facing surfaces for workflow builder, forms, approvals, tracking, history, notifications, dashboards — with focus on confusion, duplication, and runtime mismatches.

---

## 1. Surface Inventory

| Surface | Path | Audience | Backend coupling |
|---------|------|----------|------------------|
| Workflows list | `pages/workflows.tsx` | Admin (`workflow.manage`) | Definitions CRUD |
| Workflow detail | `pages/workflow-detail.tsx` | Admin | Versions, execution logs (read) |
| Create workflow | `components/workflows/CreateWorkflowSheet.tsx` | Admin | POST/PATCH definitions |
| Condition builder | `components/workflows/DynamicConditionBuilder.tsx` | Admin | Conditions JSONB |
| Forms admin | `pages/forms.tsx` | Admin | Form definitions |
| Form submit | `pages/forms-submit.tsx` | Authenticated users | Submit API |
| Self-service portal | `pages/self-service.tsx` | Employees | Forms + legacy approvals |
| Approvals page | `pages/approvals.tsx` | Users with pending ticket approvals | Legacy `approvals` API |
| Governance workflows | `pages/super-admin-governance-workflows.tsx` | Platform ops | **Different product** — violation workflows |
| Governance console config | `lib/governance-console-config.ts` | Super admin | Analytics metadata |

---

## 2. Workflow Builder UX

### Strengths

- Module badges, active/draft visual states, execution count stats.
- Create sheet exposes trigger event, steps, conditions.
- Publish/activate lifecycle exposed via API client hooks.
- Dynamic condition builder reduces raw JSON editing.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **Enterprise step options oversell** | High | UI/types expose multi/parallel/conditional approval modes without runtime effect |
| **No execution approve from detail page** | High | Admin sees runs but approve/reject likely API-only |
| **Technical exposure** | Medium | Trigger event strings (`form.submitted`, hints) require admin knowledge |
| **isActive toggle vs status** | Medium | List toggle may desync from governance `status` lifecycle |
| **Governance analytics mixed in** | Low | Same mental model as tenant automation but different backend |

---

## 3. Form Builder UX

### Strengths

- Rich field types, conditional fields, data sources for users/departments.
- Self-service flag and permissions JSON.
- `workflow_event` field links form to automation hint.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **workflow_event naming** | Medium | Admins must know hint strings vs bus events |
| **Status review decoupled** | High | Admin can set approved/rejected without workflow action |
| **No visual workflow preview** | Medium | Cannot see which workflow will fire from form config |

---

## 4. Approvals UI

### `approvals.tsx` (standalone)

- Shows **legacy ticket approvals** only.
- Clear approve/reject actions with ticket deep link.
- Does **not** list workflow `waiting_approval` executions.

### `self-service.tsx` (embedded approvals tab)

- Same legacy API — duplicate surface inside portal.
- Employees may expect form/HR approvals here — **not shown**.

### Confusion matrix

| User expectation | Actual UI |
|------------------|-----------|
| "Approve my team's leave" | HR module / notifications, not central approvals page |
| "Approve form request" | No employee-facing workflow approve UI |
| "Approve ticket" | ✅ approvals page |
| "See workflow stuck on me" | ❌ unless admin with workflow tools |

---

## 5. Request Tracking

### My Requests (`/my-submissions`)

- Shows submission status, request number, timestamps.
- Enrichment: `currentStepLabel`, `waitingOnName` from **running** executions + pending tasks only.

### Gaps

| Gap | User impact |
|-----|-------------|
| Misses `waiting_approval` state | Shows stale "submitted" while waiting for approver |
| No link to execution detail | Cannot trace automation progress |
| No approver name for approval pause | Employee doesn't know who must act |
| Form status vs workflow status diverge | Incorrect progress indicator |

---

## 6. Workflow History

### Admin: `workflow-detail.tsx`

- Paginated execution list with status badges.
- Expandable step logs per execution (`execution-steps` query).
- Shows current step index, error text, duration.

### Employee

- **No equivalent** — no self-service execution timeline.

### Strengths

- Good admin observability for debugging automations.

### Issues

- Read-only — no cancel/approve from same screen (may exist elsewhere in API client).
- Status `waiting_approval` visible but no inline approve action in grep results.

---

## 7. Notifications UX

- In-app notifications table driven; SSE push from bus listeners.
- Types include `approval_request`, `workflow`, leave types, ticket types.
- Workflow approval step sets `link: null` on notifications — **no deep link to approve**.

### Issues

| Issue | Detail |
|-------|--------|
| Notification → action gap | User gets "Approval Required" but may lack UI path |
| Duplicate type semantics | `assigned` vs `ticket_assigned` (documented in notifications-bus) |
| form.submitted listener | No recipients configured (TBD) |

---

## 8. Dashboards

| Dashboard | Content |
|-----------|---------|
| Workflows page stats | Total/active/runs count |
| Workflow detail stats | Execution count, version info |
| Governance super-admin | Violation workflow lifecycle, **not tenant BPM** |
| Workspace governance routes | Reliability/degradation analytics |

**No unified "process health" dashboard** for tenant admins combining forms + executions + approvals.

---

## 9. Duplicate Screens & Dead Ends

| Duplication | Locations |
|-------------|-----------|
| Pending approvals | `approvals.tsx` + self-service tab |
| Workflow concepts | Tenant workflows vs super-admin governance workflows (name collision) |
| Leave request | Form self-service vs HR leave module |

| Dead-end flow | Cause |
|---------------|-------|
| Employee receives workflow approval notification | No approve UI without admin permission |
| Admin sets form approved | Workflow may still be running/failed |
| Configure onTimeout escalate | Nothing happens at runtime |
| Select department_head approver | No approvers resolved → silent skip |

---

## 10. Runtime Inconsistencies (UI vs Backend)

| UI shows | Backend reality |
|----------|-----------------|
| Parallel approval mode | Single approve resumes all |
| Escalation on timeout | Execution TTL only; step timeout unused |
| My request "in progress" | Only if execution status is `running`, not `waiting_approval` |
| Approvals inbox complete | Ticket subset only |
| Workflow "active" toggle | Should align with publish pipeline `status=active` |

---

## 11. Unclear States (Employee-Facing)

| Status | Meaning to user | Actual meaning |
|--------|-----------------|----------------|
| `submitted` (form) | Waiting for processing | May or may not have workflow |
| `pending_approval` (form) | Someone reviewing | Manual admin flag — not tied to engine |
| `running` (execution) | In progress | May be mid-step or about to pause |
| `waiting_approval` (execution) | Needs approval | Not reflected in my-submissions |
| `failed` (execution) | Rejected/error | Form may still show `submitted` |

---

## 12. UX Maturity Verdict

| Area | Maturity |
|------|----------|
| Admin workflow observability | **Good** |
| Admin workflow authoring | **Moderate** (oversold features) |
| Employee self-service submit | **Good** |
| Employee approval actions | **Poor** (wrong/missing surfaces) |
| End-to-end request tracking | **Poor** |
| Unified approvals inbox | **Missing** |

---

## 13. Priority UX Clarifications (For Future — Not Implemented)

1. Rename or separate "Governance Workflows" from tenant "Workflows" in nav.
2. Employee approval inbox backed by workflow_approvals + leave steps.
3. Sync displayed submission status from execution state.
4. Add notification deep links to actionable approve screens.
5. Hide or disable approval config options without runtime backing.

---

*End of Phase 6 — UI/UX Audit.*
