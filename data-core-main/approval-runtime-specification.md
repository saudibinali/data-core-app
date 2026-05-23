# Approval Runtime Specification

**Phase:** 3 — Enterprise approval engine

---

## 1. Requirements (Enterprise parity)

| Capability | Priority |
|------------|----------|
| Direct manager approval | P0 |
| Multi-level sequential chain | P0 |
| Parallel approval (all / any) | P1 |
| Conditional routing (amount, grade, org) | P1 |
| Delegation / acting | P0 |
| Escalation on timeout | P0 |
| SLA / due dates | P1 |
| Executive override | P2 |
| Audit trail | P0 |

---

## 2. Core API

```typescript
interface StartApprovalInput {
  workspaceId: number;
  entityType: ApprovalEntityType;
  entityId: number;
  requesterEmployeeId: number;
  processCode: string; // e.g. 'leave.standard', 'transfer.internal'
  context?: Record<string, unknown>;
}

ApprovalRuntime.start(input): ApprovalInstance
ApprovalRuntime.decide(instanceId, stepId, decision, actorUserId, notes?)
ApprovalRuntime.delegate(stepId, fromEmployeeId, toEmployeeId, reason)
ApprovalRuntime.escalate(stepId, reason)
```

---

## 3. Authorization Model

**Rule:** Actor must match `approver_user_id` OR active delegate OR hold `hr.approve.override` permission.

**Not:** blanket `workflow.manage` for business approvals (deprecate for tenant HR approvers).

| Permission | Scope |
|------------|-------|
| `hr.approve.leave` | Leave instances assigned to user |
| `hr.approve.team` | Subtree per org policy |
| `hr.approve.override` | Executive / HR admin |

Platform `workflow.manage` retained for system automations only.

---

## 4. Routing Policies (configurable per process)

**Table:** `approval_process_policies`

| Field | Example |
|-------|---------|
| code | `leave.standard` |
| routing_type | `manager_chain` |
| chain_depth | 1 |
| timeout_hours | 48 |
| on_timeout | `escalate` \| `auto_reject` |
| parallel_mode | null \| `all` \| `any` |
| conditions | JSONB (grade, days, org type) |

---

## 5. Consolidation Map

| Legacy | Unified |
|--------|---------|
| `leave_approval_steps` | `approval_steps` |
| `workflow_approvals` | `approval_steps` (automation) |
| `approvals` (ticket) | `approval_instances` entity_type=ticket |

---

## 6. Notification Integration

On step create:
- In-app `approval_request` with deep link `/approvals/inbox/:instanceId`
- Email via `notification_jobs` if policy enabled
- Reminder at 50% and 90% of SLA

Replace `link: null` from current workflow approval step.

---

## 7. Self-Service Inbox

**Single UI:** `/self-service/approvals` (replace ticket-only list)

- Query `approval_steps WHERE approver_user_id = me AND status=pending`
- Actions: Approve / Reject / Delegate
- Show entity context (leave dates, transfer from→to)

---

## 8. Migration (dual-write)

1. Leave submit creates `leave_approval_steps` AND `approval_steps`
2. Compare outcomes in shadow
3. Switch read to unified
4. Stop writing legacy when 30 days clean

---

## 9. Validation

- Every pending step has resolvable approver with userId OR delegate
- No orphan instances in pending &gt; 90 days
- SLA worker processes backlog within 5 min

---

*End of Approval Runtime Specification.*
