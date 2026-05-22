# Subscription Data Model Audit

**Scope:** PostgreSQL tables and Drizzle schema for subscriptions, contracts, entitlements, quotas, access  
**Date:** 2026-05-20  
**Mode:** Read-only — no schema changes  
**Source of truth:** `lib/db/src/schema/`

---

## 1. Table inventory

### 1.1 Hub

| Table | PK | Unique constraints | Notes |
|-------|-----|-------------------|--------|
| `workspaces` | `id` | `slug` | **Tenant** — all `tenantId` FKs point here |

### 1.2 P13 — Tenant registry subscription & entitlements

| Table | Cardinality per workspace | Key columns |
|-------|---------------------------|-------------|
| `tenant_subscriptions` | **1:1** (`workspace_id` UNIQUE) | `plan_code`, `subscription_status`, billing/trial/grace timestamps, `metadata_json`, `reason`, `updated_by` (no FK) |
| `tenant_entitlement_overrides` | **1:N** | `module_code`, `override_type` (enable/disable/limit_override), `limit_code`, `limit_value`, `reason`, `created_by` (no FK) |

### 1.3 P16 — Workspace commercial subscription stack

| Table | Cardinality | Key columns |
|-------|-------------|-------------|
| `workspace_subscriptions` | **1:1** | `subscription_code`, `subscription_name`, `status`, dates, `commercial_account_id`, `active_contract_term_id`, `plan_name`, `internal_notes` |
| `workspace_entitlements` | **1:N** | `module_key`, `feature_key`, `is_enabled`, `source`, effective dates |
| `workspace_quota_limits` | **1:N** | `quota_key`, `limit_value`, `is_hard_limit`, `source` |
| `workspace_subscription_policies` | **1:1** | grace/past_due/suspension day fields, `enforcement_mode`, suspension allowances |
| `workspace_access_enforcement` | **1:1** | `enforcement_status`, `allow_*` flags, `source`, `expires_at` |

Optional FK on P16 children: `subscription_id` → `workspace_subscriptions.id` (SET NULL on delete).

### 1.4 P15 — Commercial

| Table | Cardinality | Key columns |
|-------|-------------|-------------|
| `commercial_accounts` | **1:1** workspace | account name, owners, billing fields, `status` |
| `commercial_billing_contacts` | N per account | contact fields |
| `commercial_contract_terms` | N per workspace/account | `contract_number`, dates, renewal, value, `status` |
| `commercial_invoices` | N | PDF upload, amounts, links to contract |
| `commercial_invoice_documents` | 1:1 invoice | storage metadata |
| `commercial_payment_records` | N | manual payment tracking |

### 1.5 Module catalog (related, not subscription FK)

| Table | Role |
|-------|------|
| `platform_modules` | Global module registry |
| `workspace_module_settings` | Per-workspace `enabled` flag |

### 1.6 Unrelated name collisions (do not merge)

| Table | Domain |
|-------|--------|
| `hr_employee_contracts` | HR employment |
| `payroll_policies`, `attendance_policies`, `scheduler_fairness_policies` | HR/payroll rules |
| `platform_user_access_reviews` | Platform **user** access (P17) |

---

## 2. Foreign key graph (subscription domain)

```
workspaces (id)
├── tenant_subscriptions.workspace_id [UNIQUE, CASCADE]
├── tenant_entitlement_overrides.workspace_id [CASCADE]
├── workspace_subscriptions.workspace_id [UNIQUE, CASCADE]
│   ├── commercial_account_id → commercial_accounts [SET NULL]
│   └── active_contract_term_id → commercial_contract_terms [SET NULL]
├── workspace_entitlements.workspace_id [CASCADE]
│   └── subscription_id → workspace_subscriptions [SET NULL]
├── workspace_quota_limits.workspace_id [CASCADE]
│   └── subscription_id → workspace_subscriptions [SET NULL]
├── workspace_subscription_policies.workspace_id [UNIQUE, CASCADE]
│   └── subscription_id → workspace_subscriptions [SET NULL]
├── workspace_access_enforcement.workspace_id [UNIQUE, CASCADE]
│   └── subscription_id → workspace_subscriptions [SET NULL]
├── commercial_accounts.workspace_id [UNIQUE, CASCADE]
│   ├── commercial_billing_contacts
│   └── commercial_contract_terms
│       └── commercial_invoices.contract_term_id
└── workspace_module_settings.workspace_id [CASCADE]
```

---

## 3. Duplicated structures

| Duplication | Tables / fields | Risk |
|-------------|-----------------|------|
| **Dual subscription row** | `tenant_subscriptions` + `workspace_subscriptions` | Two statuses, two date sets, divergent edits |
| **Dual entitlements** | `tenant_entitlement_overrides` vs `workspace_entitlements` | Same modules toggled in two places |
| **Triple module gate** | `workspace_module_settings` + both entitlement tables | Operator confusion; only module settings hit routes today |
| **Quota vs limit override** | `workspace_quota_limits` vs `tenant_entitlement_overrides.limit_*` | Same concept, different APIs |
| **Plan naming** | `tenant_subscriptions.plan_code` vs `workspace_subscriptions.plan_name` | No FK link between plan catalog and workspace plan string |

---

## 4. Orphan & integrity gaps

| Issue | Detail |
|-------|--------|
| Cross-workspace contract link | `active_contract_term_id` not validated to match subscription's `workspace_id` in DB |
| Nullable `subscription_id` on children | Orphaned entitlement/quota rows after subscription archived |
| Missing user FKs | `tenant_subscriptions.updated_by`, `tenant_entitlement_overrides.created_by` |
| P16 raw SQL script | `scripts/apply-p16-tables.cjs` may create columns without FKs until Drizzle migrate applied |
| No `tenants` table | Documentation referring to “tenant table” is always `workspaces` |

---

## 5. Nullable / enum chaos

### `workspace_subscriptions.status`

`trial | active | grace_period | past_due | suspended | terminated | archived`

Transition rules in app: `workspace-subscription-transitions.ts` — **not DB CHECK**.

### `tenant_subscriptions.subscription_status`

Derived + overridable in app (`subscription-lifecycle.ts`) — values overlap P16 but stored separately.

### `workspace_access_enforcement.enforcement_status`

`normal | read_only | restricted | suspended_view_only | terminated_view_only`

### `workspace_subscription_policies.enforcement_mode`

`advisory_only | manual_required | automatic_recommended` — **stored but evaluator treats automation as disallowed**.

### `commercial_contract_terms.status`

`draft | active | expired | terminated | archived`

### Entitlement / quota `source`

`manual | subscription_plan | contract_override | trial | system_default` — semantic overlap without strict usage audit.

---

## 6. Dead or low-use structures

| Structure | Assessment |
|-----------|------------|
| `subscription_id` on P16 child tables | Often NULL — optional link underused |
| `feature_key` on `workspace_entitlements` | Frequently `''` — module-level rows dominate |
| `tenant_subscriptions.metadata_json` | Opaque blob — usage unclear in UI |
| P13 GET entitlements API | Route path likely broken — table may be write-only from UI |
| `is_hard_limit` on quotas | No middleware consumes it |

---

## 7. Migration & deployment state

| Table group | In `lib/db/drizzle/*.sql`? | Applied via |
|-------------|---------------------------|-------------|
| Core workspace/modules | Partial (baseline) | Migrations |
| P13 tenant_* / P15 commercial_* | **Not found** in drizzle SQL snapshots | App/schema only — ops must run manual DDL |
| P16 workspace_* | **Not in drizzle SQL** | `scripts/apply-p16-tables.cjs` |

**Risk:** Fresh install from migrations alone may miss entire commercial/subscription domain unless script run.

---

## 8. Recommendations (data model — no implementation)

### 8.1 Should remain

| Table | Reason |
|-------|--------|
| `workspaces` | Core tenant |
| `commercial_accounts`, `commercial_contract_terms`, invoices/payments | Real commercial ops (manual) |
| `workspace_subscriptions` | Target canonical subscription state |
| `workspace_access_enforcement` | Only runtime enforcement store |
| `workspace_module_settings` | Actual product module gates |
| `platform_modules` | Catalog |

### 8.2 Should merge (future)

| From | Into | Notes |
|------|------|-------|
| `tenant_subscriptions` | `workspace_subscriptions` + view/compat layer | Single status + dates |
| `tenant_entitlement_overrides` | `workspace_entitlements` or module settings | One override mechanism |
| Plan fields | Shared `plan_code` FK to catalog table | Today stringly-typed |

### 8.3 Should simplify (future)

| Item | Action |
|------|--------|
| `workspace_subscription_policies` | Keep one row; hide `enforcement_mode` until automation exists |
| `subscription_id` on children | Drop or enforce NOT NULL when subscription exists |
| Quota + P13 limit overrides | Single quota table |

### 8.4 Should remove (only after migration + UI cutover)

| Table | Prerequisite |
|-------|--------------|
| `tenant_subscriptions` | Migrate data; fix GET/PATCH routing |
| `tenant_entitlement_overrides` | Migrate overrides to P16 or deprecate tab |

### 8.5 Should not delete

| Table | Reason |
|-------|--------|
| `commercial_contract_terms` | Active UI and APIs — not a placeholder |
| `hr_employee_contracts` | Different product domain |

---

## 9. Entity–UI mapping

| Table | Primary UI |
|-------|------------|
| `tenant_subscriptions` | Registry list, Overview, Subscription Management modal |
| `workspace_subscriptions` | Subscription State panel |
| `tenant_entitlement_overrides` | Entitlements tab |
| `workspace_entitlements` | Subscription → C) accordion |
| `workspace_quota_limits` | Subscription → D) |
| `workspace_subscription_policies` | Subscription → E) |
| `workspace_access_enforcement` | Subscription → F) |
| `commercial_contract_terms` | Commercial → Contracts |
| `workspace_module_settings` | Workspace admin module pages (not tenant console) |

---

## 10. Summary scorecard

| Criterion | Score | Note |
|-----------|-------|------|
| Normalization | Medium | 1:1 hubs OK; parallel models hurt |
| Referential integrity | Low–Medium | Missing cross-FK checks |
| Single source of truth | **Low** | Dual subscription + entitlements |
| Enterprise completeness | Medium (commercial) / Low (enforcement) | Contracts real; automation fake |
| Operational DDL hygiene | Low | P16 outside migrations |

*Companion: `subscription-platform-architecture-audit.md`, `subscription-console-redesign.md`, `subscription-platform-final-recommendation.txt`.*
