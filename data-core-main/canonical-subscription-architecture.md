# Canonical Subscription Architecture

## Single source of truth

| Domain | Table / API | Notes |
|--------|-------------|--------|
| Tenant identity | `workspaces` | Unchanged |
| Subscription state | `workspace_subscriptions` | Plan, status, dates, renewal, contract link |
| Product access | `workspace_module_settings` + `platform_modules` | Module on/off only |
| Runtime write access | `workspace_access_enforcement` | Only live enforcement |
| Commercial | `commercial_accounts`, `commercial_contract_terms`, invoices, payments | Operational commercial, not CLM |

## Removed (no dual runtime)

- `tenant_subscriptions` (P13 registry metadata)
- `tenant_entitlement_overrides`
- `workspace_entitlements`
- `workspace_quota_limits`
- `workspace_subscription_policies`
- P13 `GET/PATCH /platform/tenants/:id/subscription` and entitlement override routes
- P16 parallel routers: entitlements, quotas, subscription-policies, tenant-subscription visibility stack

## API surface (canonical)

- `GET|POST|PATCH /api/platform/tenants/:tenantId/subscription` — `workspace-subscriptions.ts`
- `PATCH /api/platform/tenants/:tenantId/subscription/status`
- `GET|PATCH /api/platform/tenants/:tenantId/product-modules` — module governance
- `GET|PATCH workspace access` — `workspace-access.ts` / `tenant-workspace-access.ts`
- Commercial routes unchanged

## Registry

`GET /api/platform/tenants` loads `workspace_subscriptions` in batch and maps to list filters via `canonical-subscription-registry.ts`.

## UI

`/super-admin/tenants` → **Subscription** tab = `TenantCommercialConsole` (plan, modules, workspace access). Empty state shows only “No subscription configured” / “Set up subscription” — no quotas, policy, or advisory blocks.
