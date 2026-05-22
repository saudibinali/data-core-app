# Subscription DB Cleanup Map

## Keep

- `workspaces`
- `workspace_subscriptions`
- `workspace_module_settings` (in `modules` schema)
- `workspace_access_enforcement`
- `commercial_accounts`, `commercial_contract_terms`, `commercial_invoices`, `commercial_payment_records`, related documents

## Drop after migration (script provided)

| Table | Replacement |
|-------|-------------|
| `tenant_subscriptions` | `workspace_subscriptions` |
| `tenant_entitlement_overrides` | `workspace_module_settings` |
| `workspace_entitlements` | `workspace_module_settings` |
| `workspace_quota_limits` | removed (no fake quotas) |
| `workspace_subscription_policies` | default policy in code only |

Script: `scripts/drop-legacy-subscription-tables.sql`

Migration: `scripts/migrate-canonical-subscription.cjs`

## Schema exports removed from `lib/db/src/schema/index.ts`

- `tenant-subscriptions`, `tenant-entitlement-overrides`
- `workspace-entitlements`, `workspace-quota-limits`, `workspace-subscription-policies`

Table definition files may remain until DDL is executed; application code no longer imports them.
