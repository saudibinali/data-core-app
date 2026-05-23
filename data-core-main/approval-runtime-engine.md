# Approval Runtime Engine — Phase 3

## Core tables

| Table | Purpose |
|-------|---------|
| `approval_process_policies` | Business templates (`leave.standard`, etc.) |
| `approval_instances` | One row per approval request (entity-bound) |
| `approval_steps` | Sequential/parallel steps with SLA |

## API surface

```typescript
startApproval(input)           // generic start
startLeaveApproval(...)        // dual-write from leave
syncLeaveStepDecision(...)     // sync on leave approve/reject
decideApprovalStep(...)        // unified inbox decisions (non-leave)
getApprovalInbox(userId)       // pending items for actor
escalateOverdueSteps()         // SLA worker (startup + periodic hook)
```

## Routing types

- `direct_manager`
- `manager_chain`
- `org_unit_head`
- `division_head`
- `hr_director` / `executive`
- `parallel_all` / `parallel_any` (foundation)

## Authorization

Step decision requires `approver_user_id === actor` (HR override hook ready for `hr.approve.override`).

## Notifications

Deep links: `/self-service/approvals/{instanceId}`

## Not in Phase 3

- Full replacement of `leave_approval_steps` reads
- Ticket `approvals` table migration
- Complete delegation UI lifecycle
