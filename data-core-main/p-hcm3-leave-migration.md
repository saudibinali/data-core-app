# P-HCM3 — Legacy Leave Migration & Employee Provision

**Date:** 2026-05-20  
**Goal:** Close dual leave model gap (SAP EC–style) before Finance cutover.

## Delivered

### Leave migration (idempotent)
- Table `hr_leave_migration_map` (migration `0021`)
- `GET /api/hr/leave-migration/report` — counts, pending, skip hints
- `POST /api/hr/leave-migration/run` — `{ dryRun: true }` default; `{ dryRun: false, limit?: number }` to execute
- Canonical rows: `requestNumber` = `LRQ-MIG-{legacyId}`
- **No balance mutation** on migration (historical snapshot only)

### Employee provision (single step)
- `POST /api/hr/employees/provision` — create employee + link by `userId` or unique email match

### Stabilization
- `GET /api/workspace/stabilization` includes `leaveMigration` block + updated recommendations

## Recommended cutover sequence

1. Link employees to users (P-HCM2).
2. `POST /hr/leave-migration/run` with `dryRun: true` — review samples/errors.
3. `POST /hr/leave-migration/run` with `dryRun: false`.
4. Set `leaveRuntimeMode` → `canonical`.
5. Verify stabilization risks (`dual_leave_models` cleared).

## Not in scope
- Deleting legacy `hr_employee_leaves` rows
- Balance recalculation from migrated history
- User invitation / password flows

## Next
- Finance module enablement per tenant (COA setup)
- Payroll legacy migration (parallel pattern)
