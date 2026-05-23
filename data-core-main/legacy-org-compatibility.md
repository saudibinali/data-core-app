# Legacy Org Compatibility — Phase 2

## Principle

New runtime **never reads** `departments` or `users.departmentId` directly. Legacy structures remain for existing UIs and APIs.

## Compatibility mechanisms

| Legacy | Canonical bridge |
|--------|------------------|
| `departments` | `legacy_department_org_map` → `hr_org_units` |
| `departments.managerId` | Backfill → `hr_org_units.manager_employee_id` |
| `users.departmentId` | Synced from employee org in `workforceCanonicalMode=active` |
| `users.lineManagerId` | Synced from `directManagerId` in active workforce sync |

## Backfill (idempotent)

Runs on:

- `node scripts/migrate-org-runtime.cjs`
- Server startup (`runOrgRuntimeBackfill`)

## What stays unchanged

- `GET/POST/PATCH/DELETE` department APIs (if exposed elsewhere)
- User admin screens using legacy departments
- No DROP TABLE / DROP COLUMN

## Promotion path

1. `orgRuntimeMode: shadow` — validate data, review logs
2. `orgRuntimeMode: active` — enforce employee org links
3. `workforceCanonicalMode: active` — sync legacy user fields

## Forbidden in new code

```typescript
// ❌ Do not use in org runtime
usersTable.departmentId  // except compat sync writes
departmentsTable         // except migration scripts
```

Use `hr_org_units`, `employees.orgUnitId`, `resolveOrgUnitFromLegacyDepartment` instead.
