# Manager Resolution Engine — Phase 2

## Core service

`resolveManagerUserIdForEmployee(workspaceId, employeeId)`

Returns `{ userId, source }` where `source` is one of:

| Source | When |
|--------|------|
| `direct_manager` | Manager employee has active `userId` |
| `org_unit_head` | Employee's org unit has `managerEmployeeId` |
| `parent_org_head` | Nearest ancestor org unit head |
| `executive_hr_director` | HR director from executive overrides |

## Consumers

| Module | Behavior |
|--------|----------|
| `leave.ts` | `resolveLeaveApprover` uses org runtime in `shadow`/`active` |
| `steps/approval.ts` | Workflow manager steps use org resolver in `active` |
| `manager-resolver.ts` | Legacy `lineManagerId` only via compat adapters |

## Legacy compatibility

- `users.lineManagerId` — read only through `resolveLegacyLineManagerUserId` / `resolveManagerUserIdForTrigger`
- `departments` — mapped via `legacy_department_org_map`; never used for new runtime reads
- `departments.managerId` — backfilled to `hr_org_units.manager_employee_id` on startup

## Workspace modes

Controlled by `orgRuntimeMode` + `workforceCanonicalMode` on `hr_workspace_settings`.

Shadow mode logs mismatches without changing production approvers until promoted.

## Not implemented

- Full delegation runtime (schema exists)
- Org-based workflow routing rules (Phase 3)
- Position hierarchy inheritance
