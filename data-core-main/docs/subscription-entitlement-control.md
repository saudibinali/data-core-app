# Platform Subscription & Entitlement Control (Phase 16)

Enterprise workspace subscription state, entitlements, quotas, grace/suspension policy, manual workspace access enforcement, super-admin console integration, and tenant read-only visibility. This is **metadata and advisory control only** — not billing automation, payment processing, or automatic tenant lockout.

## Overview

Phase 16 delivers a coherent control plane for operators and a read-only view for tenants:

| Sub-phase | Purpose |
|-----------|---------|
| **P16-A** | Workspace subscription record and status lifecycle (model + APIs) |
| **P16-B** | Module/feature entitlements catalog and workspace overrides |
| **P16-C** | Quota catalog, limits, and usage measurement (no hard enforcement) |
| **P16-D** | Grace/past-due/suspension **policy** and read-only evaluation |
| **P16-E** | Manual workspace access modes + write guard when read-only |
| **P16-F** | Unified Super Admin **Subscription** tab (console + navigation) |
| **P16-G** | Tenant **Subscription Status** page and GET APIs |

Commercial billing (P15) remains separate: invoices, manual payments, PDF upload — see [commercial-administration.md](./commercial-administration.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Super Admin — Tenant Registry → Subscription tab (P16-F)        │
│   Overview cards → Accordion: State, Entitlements, Quotas,      │
│   Policy, Workspace Access                                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ platform APIs (permission-gated)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ workspace_subscriptions │ workspace_entitlements                │
│ workspace_quota_limits  │ workspace_subscription_policies       │
│ workspace_access_enforcement                                    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ resolvers (read / evaluate)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Tenant workspace — Subscription Status (P16-G) GET only           │
│ WorkspaceReadOnlyBanner + workspaceAccessWriteGuard (P16-E)     │
└─────────────────────────────────────────────────────────────────┘
```

**Key rule:** Policy evaluation and commercial signals produce **recommendations only**. Applying read-only or suspended-view modes requires a super-admin **manual** PATCH with reason (P16-E).

## Subscription lifecycle (P16-A)

**Table:** `workspace_subscriptions` (one row per workspace)

**Statuses:** `trial`, `active`, `grace_period`, `past_due`, `suspended`, `terminated`, `archived`

**Transitions:** Enforced in `workspace-subscription-transitions.ts` on platform status-change API. No automatic status mutation from policy evaluation.

**Platform APIs** (`/platform/tenants/:tenantId/subscription`):

- GET — read
- POST — create (if none)
- PUT — update metadata
- PATCH — status change (requires reason)

**Permissions:** `platform.subscriptions.read`, `.update`, `.status.change`

## Entitlement model (P16-B)

**Catalog:** Static module/feature definitions (`workspace-entitlement-catalog.ts`). Core module cannot be disabled.

**Table:** `workspace_entitlements` (per workspace, optional feature-level rows)

**Resolver:** `resolveWorkspaceEntitlements`, `canWorkspaceUseFeature` — read-only; does not block HTTP by itself in P16.

**Platform APIs:** GET/PUT/PATCH under `/platform/tenants/:tenantId/entitlements`

**Permissions:** `platform.entitlements.read`, `.update`

## Quota model (P16-C)

**Catalog:** Quota keys (users, employees, documents, storage, workflows, etc.)

**Table:** `workspace_quota_limits`

**Usage:** `resolveWorkspaceQuotaUsage` — measures current usage where implemented; returns `unknown` when not measurable.

**Platform APIs:** GET catalog/list/usage; PUT/PATCH limits

**Permissions:** `platform.quotas.read`, `.update`

**Note:** Quota status (`ok` / `warning` / `exceeded`) is informational in Phase 16 — no automatic write blocking from quotas alone.

## Grace / suspension policy (P16-D)

**Table:** `workspace_subscription_policies`

**Evaluation:** `evaluateSubscriptionPolicy` — advisory `recommendedStatus` / `recommendedAction`; `isAutomaticAllowed: false`

**Platform APIs:**

- GET/PUT `/platform/tenants/:tenantId/subscription-policy`
- GET `.../subscription-policy/evaluation`

**Permissions:** `platform.subscriptionPolicies.read`, `.update`, `.evaluate`

## Read-only workspace enforcement (P16-E)

**Table:** `workspace_access_enforcement`

**Modes:** `normal`, `read_only`, `restricted`, `suspended_view_only`, `terminated_view_only`

**Default flags:** `allowLogin: true`, `allowRead: true`; create/update/delete false in read-only modes.

**Write guard:** `workspaceAccessWriteGuard` middleware — blocks POST/PUT/PATCH/DELETE for tenant operational routes when workspace is read-only. Exempt: `/platform/*`, `/auth/*`, `/tenant/billing/*` (invoice read/download).

**Commercial evaluator:** `evaluateCommercialWorkspaceEnforcement` links subscription status + policy + contract dates → recommendation (`read_only`, `suspended_view_only`, etc.) — **manual apply only**.

**Tenant banner:** `GET /tenant/workspace-access` + `WorkspaceReadOnlyBanner` in AppLayout.

**Permissions:** `platform.workspaceAccess.read`, `.update`, `.evaluate`

## Super Admin Subscription Console (P16-F)

**Location:** Tenant Registry → primary tab **Subscription** (single tab; no duplicate “Subscription & Entitlements”)

**Components:** `SubscriptionConsole.tsx` — summary cards + accordion sections A–F reusing P16 panels.

**Navigation:** Primary tabs: Overview, Lifecycle, Commercial, Subscription, Health, **More** (Entitlements, Usage, Renewal, Evaluation legacy panels).

**Deep links:** `?tab=subscription_entitlements` normalizes to `subscription`.

## Tenant subscription visibility (P16-G)

**Tenant APIs (GET only):**

| Endpoint | Permission |
|----------|------------|
| `/tenant/subscription/summary` | `tenant.subscription.read` |
| `/tenant/subscription/entitlements` | `tenant.subscription.entitlements.read` or `.read` |
| `/tenant/subscription/quotas` | `tenant.subscription.quotas.read` or `.read` |

**UI:** `/subscription/status` — overview, modules, quotas, link to billing invoices (if permitted).

**Excluded from tenant payloads:** `internalNotes`, risk/collection internals, audit actor IDs, entitlement/quota source metadata.

## Permissions

### Platform (45 codes total after Phase 16)

Phase 16 added **13** platform permission codes (subscriptions, entitlements, quotas, policies, workspace access). Full list: `platform-permissions-config.ts` / `platform-permissions.ts`.

Fixed role matrix — no custom per-user overrides.

### Tenant (workspace RBAC)

| Permission | Use |
|------------|-----|
| `tenant.subscription.read` | Subscription status page + summary API |
| `tenant.subscription.entitlements.read` | Entitlements section (or umbrella read) |
| `tenant.subscription.quotas.read` | Quotas section (or umbrella read) |
| `tenant.billing.invoices.read` | Invoice list (P15-D; separate from P16) |
| `tenant.billing.invoiceDocuments.download` | PDF download |

No tenant permissions to update subscription, entitlements, quotas, policy, or workspace access.

## APIs overview

### Platform (mutations — super-admin only)

- `/platform/tenants/:tenantId/subscription` — P16-A
- `/platform/tenants/:tenantId/entitlements` — P16-B
- `/platform/tenants/:tenantId/quotas` — P16-C
- `/platform/tenants/:tenantId/subscription-policy` — P16-D
- `/platform/tenants/:tenantId/workspace-access` — P16-E

### Tenant (read-only)

- `/tenant/subscription/summary|entitlements|quotas` — P16-G
- `/tenant/workspace-access` — P16-E banner
- `/tenant/billing/*` — P15-D (not Phase 16)

## Audit events

Registered in `platform-audit-events.ts` (mutations and evaluations; tenant subscription GETs do not audit per P16-G):

- `workspace_subscription_*`, `workspace_entitlement_*`, `workspace_quota_*`
- `workspace_subscription_policy_*`
- `workspace_access_*`, `workspace_write_blocked_read_only`

## Safety boundaries

Phase 16 explicitly does **not** include:

- Electronic payment, Stripe, checkout, card storage, payment gateways
- Invoice generation, tax/ZATCA, accounting ledger
- Email, automated dunning, automated renewal actions
- Automatic application of policy recommendations or workspace lockout
- Full login blocking by default
- Data deletion / destructive workspace purge
- Custom permissions or role matrix redesign

Forbidden payment-related fields are rejected on platform mutation bodies (e.g. `stripeCustomerId` in block lists).

Safety contracts (all flags `true` where applicable):

- `SUBSCRIPTION_STATE_SAFETY_CONTRACT` (P16-A)
- Entitlements/quotas/policy model configs (P16-B/C/D)
- `WORKSPACE_ACCESS_ENFORCEMENT_SAFETY_CONTRACT` (P16-E)
- `SUBSCRIPTION_CONSOLE_SAFETY_CONTRACT` (P16-F)
- `TENANT_SUBSCRIPTION_VISIBILITY_SAFETY_CONTRACT` (P16-G)

## Known limitations

1. **Legacy tenant subscription metadata** (P13 registry fields) coexists with P16 `workspace_subscriptions`; registry panel may appear inside console overview when `subscriptions.read` is granted.
2. **Quota measurement** returns `unknown` for some keys until operational counters exist.
3. **Entitlement resolver** does not yet gate every module route automatically — workspace module flags and RBAC remain primary.
4. **Policy evaluation** does not change subscription status or workspace access without human action.
5. **Tenant read** does not include commercial risk scores or collection workflow state.

## Future phases (out of scope for Phase 16 closure)

- **Phase 17+** — Not started; do not assume Platform Users Custom Access Control from this doc.
- Optional future work (product decision): automated policy apply, payment integration, entitlement HTTP enforcement, quota hard limits — each requires a new phase and safety review.

## Related reports

Workflow closure reports: `workflow-phase-16a-report.txt` through `workflow-phase-16h-report.txt`.
