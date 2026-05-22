# Subscription API Final State

## Active routes

| Method | Path | Handler |
|--------|------|---------|
| GET/POST/PATCH | `/api/platform/tenants/:tenantId/subscription` | `workspace-subscriptions.ts` |
| PATCH | `/api/platform/tenants/:tenantId/subscription/status` | `workspace-subscriptions.ts` |
| GET | `/api/platform/tenants/:tenantId/product-modules` | `tenant-product-modules.ts` |
| PATCH | `/api/platform/tenants/:tenantId/product-modules/:moduleKey` | `tenant-product-modules.ts` |
| GET/PATCH | workspace access under platform tenant paths | `workspace-access.ts`, `tenant-workspace-access.ts` |
| GET | `/api/platform/tenants` (list with subscription fields) | `tenants.ts` + canonical registry |
| Commercial | `/api/platform/commercial/*` | unchanged |

## Removed from router

- `workspace-entitlements.ts`
- `workspace-quotas.ts`
- `workspace-subscription-policies.ts`
- `tenant-subscription.ts`
- P13 blocks in `tenants.ts`: subscription GET/PATCH, `/:tenantId/entitlements`, overrides PATCH

## Intelligence (read-only, canonical data)

- `/:tenantId/usage`, `renewal-intelligence`, `health`, `lifecycle-evaluation` now read `workspace_subscriptions` + `workspace_module_settings`.
