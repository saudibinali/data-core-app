# Production Runtime Safety — Phase 2

## Startup sequence

After Drizzle migrations (`init-sequence.ts`):

1. `verifyOrgRuntimeSchema` — required tables/columns must exist
2. `runOrgRuntimeBackfill` — department→org map + org heads

**Failure → process exits with code 1** (API does not start with incomplete org schema).

## Schema mismatch at request time

Org/HR routes use `handleWorkforceRouteError`:

- HTTP **503**
- `error: WORKFORCE_SCHEMA_UNAVAILABLE`
- `migrationHint` pointing to migrate script

Never HTTP 500 for missing columns.

## Migrations

| Artifact | Role |
|----------|------|
| `0025_org_runtime_foundation.sql` | Drizzle auto-migrate on boot |
| `scripts/migrate-org-runtime.cjs` | Manual/CI idempotent runner |

All changes additive; rollback = set `orgRuntimeMode` to `legacy`.

## Nginx / proxy

Unchanged from Phase 1 upload hardening. Org runtime has no upload dependency.

## Recommended deploy checklist

1. Deploy application binary
2. Confirm migrations applied (server starts cleanly)
3. `node scripts/validate-org-runtime.cjs`
4. Pilot workspace: `PATCH /hr/settings { "orgRuntimeMode": "shadow" }`
5. Fix data issues from validator output
6. Promote to `active` when clean

## Environment variables

No new required env vars. Optional: `WORKSPACE_ID` for scoped validation scripts.
