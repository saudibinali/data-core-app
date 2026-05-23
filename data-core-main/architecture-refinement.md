# Architecture Refinement — Phase 5

## Unified runtime paths (no deletion)

| Domain | Canonical path | Legacy compat (until staged out) |
|--------|----------------|-------------------------------------|
| Manager | `reporting-hierarchy-service` | `users.lineManagerId` adapter |
| Org | `hr_org_units` | `departments` + map |
| Approval | `approval_instances` | ticket approvals, leave steps |
| Employee file | `GET /file` aggregate | tab CRUD endpoints |
| Movements | `employee_movements` | `hr_employee_position_history` mirror |

## Phase 5 refinements

- Telemetry on all adapter boundaries
- Stage3 skips adapters without removing code
- Shadow mismatches persisted to DB (not logger-only)

## Not removed in Phase 5

- Duplicate business logic code paths (disabled via stage flags only)
- Hidden fallbacks (still active until stage promotion)
- Dead compatibility adapters (identified in audit, not deleted)

Refinement = **visibility + gates**, not destructive cleanup.
