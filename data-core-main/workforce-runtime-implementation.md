# Workforce Runtime Implementation — Phase 1

**Status:** Implemented (additive, production-safe)  
**Default mode:** `workforceCanonicalMode = legacy` (no behavior change until promoted)

## Canonical sources

| Domain | Source of truth | Legacy (compat only) |
|--------|-----------------|----------------------|
| Employees | `employees` | `users` directory fields |
| Organization | `hr_org_units` | `departments`, `users.departmentId` |
| Direct manager | `employees.directManagerId` | `users.lineManagerId` |

## New runtime layer

Location: `artifacts/api-server/src/lib/workforce/`

| Module | Purpose |
|--------|---------|
| `manager-resolver.ts` | Employee lookup, direct manager → userId, leave approver, workflow trigger resolution |
| `org-traversal.ts` | Tree build, ancestors, descendants, cycle detection |
| `settings.ts` | Workspace cutover flags (`legacy` / `shadow` / `active`) |
| `schema-guard.ts` | Schema mismatch → **503** with migration hint |
| `legacy-compat.ts` | *(in manager-resolver)* department→org map, user field sync |
| `upload-config.ts` | Centralized upload limits |
| `employee-file-storage.ts` | HR document storage foundation |
| `parse-hr-document-upload.ts` | Safe multipart parser (413-aware) |

## Integration points

- **Leave** (`routes/leave.ts`): `findApproverForEmployee` → `resolveLeaveApprover` (canonical manager, legacy fallback)
- **Workflows** (`steps/approval.ts`): manager steps → `resolveManagerUserIdForTrigger`
- **Employee link** (`employee-account-service.ts`): optional legacy sync on link
- **Employee PATCH** (`routes/hr.ts`): org/manager validation + sync hook
- **HR settings** (`GET/PATCH /hr/settings`): workforce mode flags

## Cutover modes

| Mode | Reads | Writes |
|------|-------|--------|
| `legacy` | Legacy fields for workflows; leave uses canonical manager first | No sync |
| `shadow` | Both paths; logs mismatches | No sync |
| `active` | Canonical preferred | Syncs `lineManagerId` / `departmentId` when configured |

## Migration

```bash
node scripts/migrate-workforce-foundation.cjs
# or: pnpm --filter @workspace/db migrate
```

SQL: `lib/db/drizzle/0024_workforce_canonical_foundation.sql`

## Validation

- Unit tests: `lib/workforce/__tests__/`
- Integrity script: `node scripts/validate-workforce-integrity.cjs`

## Not in Phase 1

- Legacy table/column removal
- Position seat runtime
- Workflow UX rebuild
- Mandatory org/manager enforcement gates
