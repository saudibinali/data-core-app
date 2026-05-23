# Approval Routing Architecture — Phase 3

## Resolver flow

```
approval_process_policies (processCode)
        │
        ▼
resolveApproversForPolicy(workspaceId, policy, requesterEmployeeId)
        │
        ├── direct_manager → resolveManagerUserIdForEmployee
        ├── manager_chain  → getFullReportingChain (depth N)
        ├── org_unit_head  → hr_org_units.manager_employee_id
        ├── division_head  → ancestor org unit type=division
        ├── hr_director    → workforce_executive_overrides
        └── parallel_*     → combine direct + org head (step 1)
        │
        ▼
resolveEffectiveApproverUserId (delegation foundation)
        │
        ▼
approval_steps rows
```

## No legacy dependencies

- Does **not** read `departments` or `users.lineManagerId` for routing
- Uses Phase 2 org runtime exclusively

## Sequencing

- Step 1 = `pending`, later steps = `skipped` until prior approved
- On approve: activate next step or complete instance

## Escalation

`on_timeout: escalate` → startup worker marks overdue steps `escalated`

## Seeded policies (per workspace)

- `leave.standard` — direct manager, 48h
- `leave.manager_chain` — 2 levels, 48h
