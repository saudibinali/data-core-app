# Approval Engine Audit (Phase 5)

**Scope:** Analysis of all approval mechanisms — hierarchy, multi-step, conditional, delegation, and operational truth vs UI/config fiction.

---

## 1. Approval Systems Inventory

The codebase implements **four distinct approval channels**:

| # | Channel | Storage | API | Primary use |
|---|---------|---------|-----|-------------|
| A | **Workflow automation** | `workflow_approvals` + execution pause | `POST .../executions/:id/approve\|reject` | Configurable event-driven flows |
| B | **Legacy tickets** | `approvals` | `POST/PATCH /approvals` | Ticket-linked simple queue |
| C | **Canonical leave** | `leave_approval_steps` | `routes/leave.ts` | HR leave chain |
| D | **Domain gates** | Service state / policy tables | Procurement, inventory, payroll routes | Module-specific thresholds |

There is **no single Approval Engine service** — only overlapping implementations.

---

## 2. Workflow Approval Step (Channel A)

### 2.1 Configuration surface (`types.ts` ApprovalStep)

```typescript
approvalType: "single" | "multi" | "sequential" | "parallel" | "conditional"
approverType: "role" | "specific" | "manager" | "department_head"
timeoutHours?: number
onTimeout?: "auto_approve" | "auto_reject" | "escalate"
```

### 2.2 Runtime behavior (`steps/approval.ts`)

| Config | Operational? |
|--------|--------------|
| `approverType: specific` | ✅ Uses `approverIds` |
| `approverType: role` | ✅ Queries active users by role (capped at 50 notifications) |
| `approverType: manager` | ✅ Resolves `lineManagerId` from trigger user or `employeeId` in data |
| `approverType: department_head` | ❌ **Not implemented** in resolver |
| `approvalType: multi/sequential/parallel/conditional` | ❌ **No differentiated runtime** — single pause, any one approve resumes |
| `timeoutHours` | ❌ **Not enforced** in executor |
| `onTimeout` policies | ❌ **Simulation only** |

### 2.3 Decision flow

1. Step runs → notifications to resolved IDs.
2. Execution → `waiting_approval`.
3. User with **`workflow.manage`** calls approve API (not restricted to notified users).
4. One decision inserts `workflow_approvals` and resumes or fails execution.

**Multi-step approvals in one workflow:** Supported only as **sequential approval steps** in the step array (step 1 pause → approve → step 2 pause → approve). Not as one step with internal multi-approver logic.

---

## 3. Legacy Ticket Approvals (Channel B)

### Schema (`approvals.ts`)

- **Requires** `ticket_id` — cannot approve forms or leave directly.
- Fields: `approver_user_id`, `requested_by_user_id`, `status`, `comment`.

### Runtime (`routes/approvals.ts`)

1. Create approval → `approval.created` event.
2. `notifications-bus.ts` → `approval_request` to assignee.
3. PATCH status → `approval.completed` → notify requester.

### UI (`approvals.tsx`, self-service pending tab)

- Lists pending legacy approvals with ticket link.
- Approve/reject via `useUpdateApproval`.

**Operational:** ✅ For tickets.  
**Not integrated** with workflow engine pause/resume.

---

## 4. Canonical Leave Approvals (Channel C)

### Schema (`leave_approval_steps`)

- Per-request ordered steps: `step_order`, `approver_user_id`, `status`.
- Unique constraint on `(leave_request_id, step_order)`.

### Runtime (`routes/leave.ts`)

- Creates steps based on policy/org rules.
- Sequential resolution in domain code.
- Emits leave bus events for notifications.

### vs Workflow leave automation

- Workflows can listen to `leave.requested` but canonical path **owns** approval chain.
- Form with `leave.requested` hint is **incorrect** — should use leave API.

**Operational:** ✅ For leave domain when `leave_runtime_mode=canonical`.

---

## 5. Feature Matrix — Claimed vs Actual

| Feature | UI/Config | Runtime | Verdict |
|---------|-----------|---------|---------|
| Approval hierarchy (manager) | ✅ | ✅ manager resolver | Operational |
| Multi-step approvals | ✅ workflow array | ✅ sequential steps | Operational (pattern) |
| Multi-approver single step | ✅ types | ❌ one approve wins | **Fake enterprise** |
| Conditional approvals | ✅ type exists | ❌ same as single | **Placeholder** |
| Role-based approvers | ✅ | ✅ with cap | Operational |
| Department approvers | ✅ type | ❌ not resolved | **UI only** |
| Fallback approvers | ❌ | ❌ | Absent |
| Delegation | Future in core-approvals | ❌ | **Not implemented** |
| Reassignment | ❌ workflow | ❌ | Absent |
| Escalation on timeout | ✅ seeds/simulation | ❌ | **Config fiction** |
| Approver-only ACL | Implied by notifications | ❌ uses workflow.manage | **Security gap** |
| Audit trail | ✅ workflow_approvals | ✅ | Operational |
| Ticket legacy queue | ✅ UI | ✅ | Operational (parallel) |

---

## 6. Permission Model Analysis

| Action | Who can act |
|--------|-------------|
| Approve workflow execution | Any user with `workflow.manage` in workspace |
| Approve legacy ticket | Approver assigned on row (route checks) |
| Approve leave step | Approver on `leave_approval_steps` row |
| Change form submission status | Workspace admin |

**Inconsistency:** Workflow notifies specific users but authorization is role-permission based, not assignee-based.

---

## 7. Conditional & Policy Approvals

| Domain | Mechanism |
|--------|-----------|
| Workflow step conditions | JSONB field conditions skip step — not approval-specific |
| Workflow condition step | Branching logic — can route to different approval steps |
| Procurement | Policy service — amount thresholds, role gates |
| Leave | Policy `requires_approval`, balance checks |
| Inventory transfer | `pending_approval` status in transfer service |

**No unified rules engine** for approvals across domains.

---

## 8. Delegation & Reassignment

| Capability | Status |
|------------|--------|
| Out-of-office delegation | Not found |
| Temporary approver substitute | Not found |
| Reassign pending workflow approval | Not found |
| Reassign workflow task | Possible via task status updates (limited) |
| Reassign leave step | Domain-specific if implemented in leave routes |

`@workspace/core-approvals` README lists delegation as future work.

---

## 9. Fallback Approvers

When no approvers resolve (`approval.ts`):

- Logs warning `approval_requested_no_approvers`
- Returns `{ success: true, skipped: true, reason: "no_approvers" }`
- Execution **continues** without pause — potential **silent auto-bypass**

**No fallback chain** (e.g. escalate to admin) at runtime.

---

## 10. What Is Operational vs UI-Only vs Incomplete

### Operational (production-meaningful)

- Single-decision workflow approval pause/resume with audit row
- Sequential multiple approval **steps** in one workflow definition
- Legacy ticket approval queue + notifications
- Canonical leave multi-step chain
- Manager/role/specific approver resolution (minus department_head)

### UI / config only (fake enterprise complexity)

- `approvalType: parallel | sequential | multi | conditional` on **one step**
- `onTimeout: escalate | auto_approve | auto_reject`
- `department_head` approver type
- Validation engine warnings about fanout — advisory, not blocking in all cases

### Incomplete

- Delegation, reassignment, fallback approvers
- Approver-scoped authorization
- Cross-channel unified inbox
- `@workspace/core-approvals` integration

---

## 11. Architectural Diagram — Approval Decision Paths

```
                    ┌─────────────────────┐
                    │  Approval need      │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   Workflow approval      Legacy approvals    Leave steps
   step (engine)          (ticket_id FK)      (leave.ts)
           │                   │                   │
           ▼                   ▼                   ▼
   waiting_approval        approvals row     leave_approval_steps
           │                   │                   │
           ▼                   ▼                   ▼
   POST .../approve        PATCH /approvals    POST leave/.../decide
   (workflow.manage)       (approver user)     (step approver)
           │                   │                   │
           ▼                   ▼                   ▼
   workflow_approvals      approval.completed   leave events
```

---

## 12. Risk Summary

1. **Wrong inbox** — builders assume one approval system; three coexist.
2. **Permission bypass** — notified manager vs any workflow.admin.
3. **Silent skip** — no approvers → step skipped, not failed.
4. **Timeout fiction** — admins may believe escalation works from UI labels/seeds.
5. **Type drift** — rich ApprovalStep config promises more than executor delivers.

---

*End of Phase 5 — Approval Engine Audit.*
