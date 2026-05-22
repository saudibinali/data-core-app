# Subscription UI Rebuild Plan

## Implemented: TenantCommercialConsole

Location: `artifacts/ops-platform/src/components/subscription/TenantCommercialConsole.tsx`

### Sections

1. **Plan & subscription** — `SubscriptionStatePanel` (canonical API only). Empty state: “No subscription configured” + setup CTA; no secondary cards.
2. **Product access** — `ProductModulesPanel` via `/product-modules` (only when subscription exists).
3. **Workspace access** — `WorkspaceAccessControlPanel` (only when subscription exists).
4. Link to **Commercial** tab for contracts/invoices.

### Removed from default UX

- Accordion A–F phase labels
- Eight summary cards
- Registry subscription metadata panel (`SubscriptionManagementPanel`)
- Entitlements & quotas & policy panels
- Integration-only safety banner

### Tabs

- Primary: Overview, Lifecycle, Commercial, Subscription, Health
- More: Usage, Renewal, Evaluation (legacy intelligence; entitlements tab deduped when Subscription visible)

## Operator flow

1. Open tenant → Subscription.
2. If empty → set up subscription once.
3. Enable modules under Product access.
4. Set workspace write access if needed.
5. Manage contracts on Commercial tab.
