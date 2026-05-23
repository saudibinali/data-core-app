# Org Runtime Foundation — Phase 1

## Hierarchy model

`hr_org_units` supports typed hierarchy:

```
company → branch → division → department → team
```

Each unit has optional `parentId` (self-referential tree).

## Utilities (`lib/workforce/org-traversal.ts`)

- `buildOrgTree(units)` — nested JSON for UI/API
- `getOrgAncestors(orgUnitId, units)` — breadcrumb path
- `getOrgDescendantIds(orgUnitId, units)` — subtree IDs
- `wouldCreateOrgCycle(orgUnitId, newParentId, units)` — cycle guard

## API endpoints

| Method | Route | Notes |
|--------|-------|-------|
| GET | `/hr/org-units` | Flat list (unchanged) |
| GET | `/hr/org-units/tree` | **New** nested tree |
| PATCH | `/hr/org-units/:id` | **Enhanced** cycle rejection |

## Manager resolution

Canonical chain:

```
employee.directManagerId → manager employee → manager.userId
```

Reporting chain: `resolveReportingChain(workspaceId, employeeId)` walks `directManagerId` up to 20 levels with cycle protection.

## Legacy mapping

`legacy_department_org_map` links:

```
departments.id → hr_org_units.id
```

Backfilled by name match via `scripts/migrate-workforce-foundation.cjs`.

Used by `resolveOrgUnitFromLegacyDepartment` and optional user sync in `active` mode.

## Employee org validation (PATCH)

- `orgUnitId` must exist in workspace
- `directManagerId` must reference another employee (not self)

## Schema safety

Org routes wrapped with `handleWorkforceRouteError` → 503 on missing tables/columns.

## Deferred (Phase 2+)

- Position occupancy per org unit
- Org-based approval routing rules
- Mandatory org assignment enforcement
