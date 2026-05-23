# Org Runtime Implementation — Phase 2

**Status:** Implemented  
**Default:** `orgRuntimeMode = legacy` (no enforcement until promoted)

## Canonical org source

`hr_org_units` is the single organizational source of truth.

Supported types: `company`, `branch`, `division`, `department`, `team`, `unit` (alias → `department`).

## Package structure

```
artifacts/api-server/src/lib/workforce/org/
├── org-graph-service.ts       — tree, ancestors, descendants, roster, org heads
├── org-type-rules.ts          — type normalization + parent-type validation
├── reporting-hierarchy-service.ts — full chain, manager resolution, cycles
├── employee-org-validation.ts — org/manager linking rules
├── org-runtime-settings.ts    — orgRuntimeMode per workspace
└── org-runtime-startup.ts     — schema verify + idempotent backfill
```

## API additions (non-breaking)

| Route | Purpose |
|-------|---------|
| `GET /hr/org-units/tree` | Nested hierarchy (Phase 1) |
| `GET /hr/org-units/:id/ancestors` | Breadcrumb path |
| `GET /hr/org-units/:id/descendants` | Subtree IDs |
| `GET /hr/org-units/:id/employees` | Roster in subtree |
| `GET /hr/employees/:id/reporting-chain` | Reporting nodes with sources |

## Schema (0025)

- `hr_org_units.manager_employee_id`
- `hr_workspace_settings.org_runtime_mode`
- `workforce_executive_overrides`
- `workforce_delegations` (foundation only)

## Cutover

| Mode | Employee org/manager | Manager resolution |
|------|---------------------|-------------------|
| `legacy` | Optional | Legacy + canonical fallbacks |
| `shadow` | Warn in logs | Compare canonical vs legacy |
| `active` | Required for active employees* | Org-head + executive fallbacks |

\*Executive exemptions via `workforce_executive_overrides`

## Deployment

```bash
node scripts/migrate-org-runtime.cjs
node scripts/validate-org-runtime.cjs
```

Startup runs schema verification + backfill automatically after Drizzle migrations.
