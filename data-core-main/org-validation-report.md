# Org Validation Report — Phase 2

## Tooling

```bash
DATABASE_URL=... node scripts/validate-org-runtime.cjs
WORKSPACE_ID=1 DATABASE_URL=... node scripts/validate-org-runtime.cjs
```

Read-only. Exit `0` = pass, `1` = issues, `2` = error.

## Checks

| Code | Description |
|------|-------------|
| `SCHEMA_MISSING` | Phase 2 columns/tables not applied |
| `ORPHAN_ORG_UNIT` | `parentId` points to missing unit |
| `ORPHAN_ORG_HEAD` | `managerEmployeeId` invalid |
| `ORG_HIERARCHY_CYCLE` | Circular `parentId` chain |
| `EMPLOYEE_MISSING_ORG` | Active employee without `orgUnitId` |
| `EMPLOYEE_MISSING_MANAGER` | Active employee without `directManagerId` |
| `ORPHAN_EMPLOYEE_ORG` | Employee references missing org unit |
| `SELF_MANAGER` | `directManagerId === employeeId` |
| `INVALID_REPORTING_CHAIN` | Manager cycle in chain |

## API validation

`validateEmployeeOrgLinking` on employee POST/PATCH:

- Enforces org/manager in `active` mode
- Logs warnings in `shadow` mode
- No change in `legacy` mode

## Unit tests

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/workforce
```

## Expected legacy data noise

Workspaces with incomplete HR data will report missing org/manager until backfill and HR cleanup — non-blocking while `orgRuntimeMode=legacy`.
