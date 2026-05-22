# Subscription Migration Validation

## Pre-drop checks

```sql
-- Legacy rows without canonical subscription
SELECT ts.workspace_id
FROM tenant_subscriptions ts
LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = ts.workspace_id
WHERE ws.id IS NULL;

-- Override rows (informational)
SELECT count(*) FROM tenant_entitlement_overrides;

-- Canonical coverage
SELECT count(*) FROM workspace_subscriptions;
```

Expected after migration script: first query returns **zero** rows.

## Post-deploy API checks

1. `GET /api/platform/tenants` — `planCode` / `subscriptionStatus` populated when subscription exists.
2. `GET /api/platform/tenants/{id}/subscription` — 200 with subscription or null (not P13 shape).
3. `POST` then `PATCH` subscription on sandbox tenant.
4. `GET /api/platform/tenants/{id}/product-modules` — module list with `enabled` flags.
5. Workspace write blocked when access enforcement is read-only.

## Data safety

- No `DELETE` on `workspaces`, commercial accounts, contracts, invoices, or payments in migration script.
- Migration uses `INSERT ... ON CONFLICT` for module settings only.

## Sign-off

| Check | Owner | Date |
|-------|-------|------|
| Migration script run on staging | | |
| API smoke pass | | |
| UI subscription tab pass | | |
| DDL drop on staging | | |
| Production deploy | | |
