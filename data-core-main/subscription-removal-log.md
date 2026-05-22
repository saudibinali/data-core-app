# Subscription Removal Log

## API

- [x] Deleted P13 `GET/PATCH /platform/tenants/:tenantId/subscription` from `tenants.ts`
- [x] Deleted P13 `GET /:tenantId/entitlements` and `PATCH /:tenantId/entitlements/overrides`
- [x] Unregistered `workspaceEntitlementsRouter`, `workspaceQuotasRouter`, `workspaceSubscriptionPoliciesRouter`, `tenantSubscriptionRouter`
- [x] Added `tenant-product-modules.ts` (canonical module access)
- [x] Platform overview stats use `workspace_subscriptions`

## Libraries

- [x] `canonical-subscription-registry.ts`, `canonical-subscription-loader.ts`
- [x] `tenant-subscription-visibility.ts` — no policy/entitlement/quota tables
- [x] `commercial-workspace-enforcement-evaluator.ts` — default policy only

## UI

- [x] `TenantCommercialConsole` replaces accordion `SubscriptionConsole` behavior
- [x] `ProductModulesPanel` replaces `EntitlementsFeaturesPanel` for super-admin path
- [x] `super-admin-tenants.tsx` wiring updated
- [x] Removed `subscription_entitlements` tab from catalog

## DB (operator action)

- [ ] Run `migrate-canonical-subscription.cjs`
- [ ] Run `drop-legacy-subscription-tables.sql` after validation

## Files left unused (safe to delete in follow-up)

- `routes/workspace-entitlements.ts`, `workspace-quotas.ts`, `workspace-subscription-policies.ts`, `tenant-subscription.ts`
- Legacy panel components if no longer imported
