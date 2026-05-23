# Delegation Foundation — Phase 3

## Schema (Phase 2)

`workforce_delegations` — already migrated in 0025.

## Runtime (Phase 3)

`delegation-resolver.ts`:

- `resolveDelegateUserId(delegatorEmployeeId)` — active delegation by date range
- `resolveEffectiveApproverUserId` — returns delegate user when applicable

Applied during approver resolution in `routing-resolver.ts`.

## API (foundation CRUD)

| Method | Route |
|--------|-------|
| GET | `/hr/delegations` |
| POST | `/hr/delegations` |

Required fields: `delegatorEmployeeId`, `delegateEmployeeId`, `startDate`

## Not implemented

- Delegate action from inbox UI
- Scope enforcement (`org_subtree`, `leave_only`)
- Auto-reassign open steps on delegation create

## Inbox indicator

`isDelegated: true` when step uses delegated approver (future: set `delegated_from_employee_id` on step insert).
