# Runtime Validation Report — Phase 1

## Validation tool

```bash
DATABASE_URL=... node scripts/validate-workforce-integrity.cjs
# Optional single workspace:
WORKSPACE_ID=1 DATABASE_URL=... node scripts/validate-workforce-integrity.cjs
```

**Read-only.** Exit code 0 = pass, 1 = issues found, 2 = runtime error.

## Checks performed

| Code | Description |
|------|-------------|
| `EMPLOYEE_MISSING_ORG_UNIT` | Active employee without `orgUnitId` |
| `EMPLOYEE_MISSING_MANAGER` | Active employee without `directManagerId` |
| `ORPHAN_ORG_UNIT_REF` | Employee references non-existent org unit |
| `ORPHAN_MANAGER_REF` | `directManagerId` points to missing employee |
| `SELF_MANAGER` | Employee is own manager |
| `ORG_HIERARCHY_CYCLE` | Cycle in `hr_org_units.parentId` chain |
| `USER_WITHOUT_EMPLOYEE` | Active user with no linked employee |
| `MANAGER_RUNTIME_CONFLICT` | `directManagerId` user ≠ `users.lineManagerId` |

## Unit tests

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/workforce/__tests__
```

Coverage:

- Org tree building and cycle detection
- Workforce settings normalization
- Schema guard migration hint

## Pre-production checklist

- [ ] Migration `0024` applied
- [ ] `validate-workforce-integrity.cjs` exit 0 (or known exceptions documented)
- [ ] All workspaces on `workforceCanonicalMode: legacy` until sign-off
- [ ] Nginx `client_max_body_size` ≥ 25m
- [ ] Shadow mode trial on staging workspace

## Expected findings on legacy data

Many workspaces will report `EMPLOYEE_MISSING_ORG_UNIT` and `MANAGER_RUNTIME_CONFLICT` until backfill — this is informational, not a deployment blocker while mode is `legacy`.

## CI recommendation

Add validation script to staging deploy pipeline (non-blocking initially, blocking before `active` promotion).
