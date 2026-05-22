# Subscription Cleanup Execution Plan

## Phase 1 — Data migration (run once per environment)

1. Backup database.
2. `node scripts/migrate-canonical-subscription.cjs` (requires `DATABASE_URL`).
3. Verify counts: every `tenant_subscriptions` row has a matching `workspace_subscriptions` row (or intentional skip if already present).
4. Spot-check `workspace_module_settings` for migrated overrides.

## Phase 2 — Application deploy

1. Deploy API + ops-platform build (this changeset).
2. Smoke: create/read/update subscription on a test tenant.
3. Smoke: toggle product module; confirm workspace runtime respects module settings.
4. Smoke: workspace access read-only still blocks writes.

## Phase 3 — Drop legacy tables

1. Re-run migration verification checklist (`subscription-migration-validation.md`).
2. `psql -f scripts/drop-legacy-subscription-tables.sql`
3. Remove dead route files from repo in a follow-up commit if not already deleted.

## Rollback

- Keep backup until Phase 3 completes.
- If deploy fails before Phase 3: revert app; legacy tables still hold P13 data.
