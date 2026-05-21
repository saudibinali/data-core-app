# HCM Strategic Refactor — Pre-Cleanup Audit

**Date:** 2026-05-20  
**Decision:** Pivot from Mixed ERP/HCM → **Enterprise HCM Platform**  
**Policy:** Canonical removal (not feature flags). HCM runtime must remain intact.

---

## 1. Executive summary

| Metric | Count / status |
|--------|----------------|
| ERP domains in codebase | Finance/GL, Procurement, Inventory, SCM orchestration |
| Absent domains | CRM, Manufacturing, standalone Fixed Assets |
| Platform SaaS (keep, refactor) | Commercial accounts, tenant billing, subscriptions |
| HCM core (keep) | HR, payroll, attendance, leave, ESS, workflows, docs, reports, governance |
| Recommended DB strategy | **Keep migrations 0013–0019 in journal** (history); add **`0022_hcm_drop_erp_domains.sql`** to DROP ERP tables |
| Risk level | **High** if ERP tables contain production data — backup before `0022` |

---

## 2. What will be REMOVED

### 2.1 Platform modules (seed)

| Module key | Path | Reason |
|------------|------|--------|
| `finance` | `artifacts/api-server/src/seed/modules.ts` | Full GL / prepare / trial balance |
| `procurement` | same | PR/RFQ/PO/vendor |
| `inventory` | same | WMS runtime |
| `billing` | same | Workspace invoice UI tied to ERP finance narrative |

### 2.2 API routes (delete files + unregister)

- `finance-canonical.ts`, `finance-operations.ts`, `finance-governance.ts`
- `procurement.ts`, `inventory.ts`, `scm-workspace.ts`

### 2.3 Services / libraries (delete directories)

- `artifacts/api-server/src/lib/finance/` (~28 files)
- `artifacts/api-server/src/lib/procurement/` (~14 files)
- `artifacts/api-server/src/lib/inventory/` (~22 files)
- `artifacts/api-server/src/lib/platform/scm-workspace-activation-service.ts`
- `artifacts/api-server/src/lib/platform/procurement-workspace-activation-service.ts` (if exists)
- `artifacts/api-server/src/lib/platform/inventory-workspace-activation-service.ts` (if exists)

### 2.4 DB schemas (delete + drop migration)

| Schema file | Tables (approx.) |
|-------------|------------------|
| `finance-canonical.ts` | 14 finance_* tables |
| `procurement-canonical.ts` | 11 procurement_* tables |
| `inventory-canonical.ts` | 17 inventory_* tables |

**Migrations 0013–0019:** retained in journal for existing environments; superseded by drop migration for HCM-only deployments.

### 2.5 UI (delete pages + App routes)

- Finance: `finance-dashboard.tsx`, `finance-ops.tsx`
- Procurement: 10 pages under `procurement-*.tsx`
- Inventory: 14 pages under `inventory-*.tsx`
- ERP billing module route: `/billing/invoices` (tenant SaaS billing API remains under commercial stack)

### 2.6 Permissions (`workspace-roles.ts`)

Remove catalog entries for modules: `finance`, `procurement`, `inventory`, workspace `billing` module permissions.

### 2.7 Reports, events, tests, docs

- Report registry: all `finance.*`, `procurement.*`, `inventory.*` keys
- Notification listeners for procurement/inventory events
- Smoke/tests: `p-fin-*`, `p-scm-*`, `p24*`, `p25*`, finance/procurement/inventory lib tests
- Strategy docs: `p22-*`, `p24-*`, `p25-*`, `p-scm-*`, `p-fin-*`, `p-golive-*` (ERP-focused)

---

## 3. What will REMAIN

| Domain | Surfaces |
|--------|----------|
| HR / org structure | `hr.ts`, `/hr/**`, departments, groups |
| Employee lifecycle | provisioning, employee-account linking |
| Leave | canonical + migration + runtime modes |
| Attendance | workforce-attendance, import, geofence, integrations |
| Payroll | payroll-canonical, operations, payslips, **export readiness** (no GL posting) |
| ESS/MSS | self-service, manager views |
| Workflows & approvals | workflows seed, governance |
| Documents & notifications | P19 infrastructure |
| HR analytics / report center | HR-scoped reports only |
| Platform core | auth, workspaces, modules (HCM), multi-tenant, platform governance |
| Commercial SaaS | super-admin commercial routes (not workspace ERP) |

---

## 4. What will be REFACTORED (not deleted)

| Area | Change |
|------|--------|
| `module-governance-service.ts` | Dependencies: only `payroll → hr` |
| `workspace-go-live-service.ts` | HCM-only phases (HR, leave, payroll migration, legacy freeze) |
| `platform-stabilization-service.ts` | Remove finance module checks, inventory stock probe |
| `platform-stabilization.tsx` | Remove finance/SCM activation UI cards |
| `financial-export-service.ts` | Keep payroll GL **export lines**; remove `finance-prepare-engine` bridge |
| `payroll-migration-service.ts` | Remove `financeEnabled` / finance enablement import |
| `report-definition-registry.ts` | Strip ERP report keys |
| `report-generators.ts` | Strip ERP generators |
| `notifications-bus.ts` | Remove procurement/inventory listeners |
| `settings.tsx` | HCM-only module guidance |
| `seed/modules.ts` | HCM-first module catalog |
| `seed/forms.ts` | Expense form category: `hr` not `finance` |

---

## 5. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Data loss on ERP tables | **Critical** | Backup DB; run `0022` only after sign-off |
| Broken imports after mass delete | High | Phased compile + smoke tests |
| Orphan `workspace_module_settings` rows | Low | Optional SQL cleanup in `0022` |
| Payroll export users expect finance prepare | Medium | Export endpoints remain; finance batch prepare removed |
| Commercial/billing confusion | Low | Document: SaaS billing ≠ ERP AP |

---

## 6. Migration impact

| Environment | Action |
|-------------|--------|
| **New installs** | Run all migrations through `0021`, then `0022` → HCM-only schema |
| **Existing with ERP data** | Do **not** run `0022` until ERP data exported/archived |
| **Code-only deploy** | Safe without `0022`; ERP tables unused but present |
| **Journal** | Do not delete `0013–0019` files (Drizzle history integrity) |

---

## 7. Dependency impact

```
REMOVED: finance ──► payroll_runs (FK in finance_posting_batches)
REMOVED: procurement ──► finance_cost_centers
REMOVED: inventory ──► procurement PO + finance cost centers
KEPT: payroll ──► employees, hr org (no finance FK in payroll-canonical.ts)
KEPT: commercial_* ──► platform tenants (independent)
```

**Payroll decoupling:** `financial-export-service` no longer calls `financePrepareEngine`.

---

## 8. Execution phases (this PR)

| Phase | Scope | Status |
|-------|-------|--------|
| **0** | This audit document | ✅ |
| **1** | Modules, permissions, routes unregister, delete route files | Pending |
| **2** | Delete lib/finance, procurement, inventory; refactor platform services | Pending |
| **3** | Delete UI pages; App.tsx cleanup | Pending |
| **4** | Schema removal + `0022_hcm_drop_erp_domains.sql` | Pending |
| **5** | Reports, events, seeds, tests, docs, cleanup log | Pending |

---

## 9. Sign-off checklist (operations)

- [ ] Database backup completed
- [ ] No production dependency on ERP tables
- [ ] Workspace admins notified (finance/procurement/inventory URLs removed)
- [ ] `0022` applied only on HCM-only environments

See **`hcm-strategic-refactor-cleanup-log.md`** for file-level deletion log (appended during execution).
