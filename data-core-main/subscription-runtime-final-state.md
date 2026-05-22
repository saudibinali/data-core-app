# Subscription Runtime Final State

## What actually enforces access

1. **Workspace module settings** — feature availability via existing module resolution (`moduleGovernanceService`, workspace `/modules` APIs).
2. **Workspace access enforcement** — `workspace_access_enforcement` + `workspaceAccessWriteGuard` middleware blocks operational writes when read-only/suspended.

## What does not enforce (removed from operator UX)

- Subscription policy evaluation “apply recommended status”
- Quota limit enforcement UI
- Parallel `workspace_entitlements` records
- P13 subscription metadata PATCH

## Tenant-facing visibility

`tenant-subscription-visibility.ts` reads canonical subscription + `listTenantProductModules`; quotas return empty; policy recommendations are not surfaced.

## Commercial advisory

`evaluateCommercialWorkspaceEnforcement` uses default policy constants only (no `workspace_subscription_policies` table).
