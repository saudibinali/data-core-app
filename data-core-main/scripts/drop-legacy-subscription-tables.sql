-- Run ONLY after migrate-canonical-subscription.cjs and production verification.
-- Preserves: workspaces, workspace_subscriptions, workspace_module_settings,
-- workspace_access_enforcement, commercial_*, invoices, payments.

DROP TABLE IF EXISTS tenant_entitlement_overrides CASCADE;
DROP TABLE IF EXISTS tenant_subscriptions CASCADE;
DROP TABLE IF EXISTS workspace_entitlements CASCADE;
DROP TABLE IF EXISTS workspace_quota_limits CASCADE;
DROP TABLE IF EXISTS workspace_subscription_policies CASCADE;
