# Deployment Stabilization — Phase 5

## Unified deploy flow

1. **Migrations** — `runMigrations()` + optional `migrate-legacy-compat.cjs`
2. **Schema verify** — startup guards 1b–1e in `init-sequence.ts`
3. **Health checks** — `GET /health/workforce/schema` returns `allOk: true`
4. **Runtime validation** — `validate-schema-drift.cjs`, workspace integrity scripts
5. **Promote modes** — per workspace: org → approval → governance → cleanup stage
6. **Traffic validation** — `validate-legacy-readiness.cjs` (30d zero legacy hits)

## Prevent partial deployments

- Server refuses start if Phase 5 schema missing
- Schema registry persisted in DB for post-deploy audit

## Rollback

All Phase 5 changes additive. Rollback = revert code + set `workforceCleanupStage=none`. No drops required.
