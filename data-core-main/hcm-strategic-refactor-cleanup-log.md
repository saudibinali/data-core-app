# HCM Strategic Refactor — Cleanup Log

**Executed:** 2026-05-20  
**Audit:** `hcm-strategic-refactor-audit.md`

---

## Phase 0 — Audit

- [x] Full inventory of ERP vs HCM artifacts
- [x] Risk / migration / dependency matrix documented

---

## Phase 1 — Code removal (canonical delete)

### API routes (deleted)

- `finance-canonical.ts`, `finance-operations.ts`, `finance-governance.ts`
- `procurement.ts`, `inventory.ts`, `scm-workspace.ts`

### Libraries (deleted directories)

- `artifacts/api-server/src/lib/finance/` (~28 files)
- `artifacts/api-server/src/lib/procurement/` (~14 files)
- `artifacts/api-server/src/lib/inventory/` (~22 files)
- `scm-workspace-activation-service.ts` (+ related activation stubs if present)

### Middleware (deleted)

- `requireFinancePermission.ts`

### UI pages (deleted)

- All `finance-*.tsx`, `procurement-*.tsx`, `inventory-*.tsx` (26 pages)
- `billing-invoices.tsx` (workspace ERP billing module UI)

### DB schema TypeScript (deleted)

- `finance-canonical.ts`, `procurement-canonical.ts`, `inventory-canonical.ts`
- Removed from `lib/db/src/schema/index.ts`

### Docs (deleted)

- `p22-*` (9), `p24-*` (17), `p25-*` (3)
- `p-scm-workspace-activation.md`, `p-fin-workspace-activation.md`, `p-golive-workspace-gate.md`

### Tests (deleted)

- ERP platform smokes: `p-fin-*`, `p-scm-*`, `p-golive*`
- ERP UI smokes: `p24c-*`, `p25c-*`
- All lib tests under deleted finance/procurement/inventory trees

---

## Phase 2 — Refactor (HCM preserved)

| File | Change |
|------|--------|
| `seed/modules.ts` | Removed finance, procurement, inventory, billing modules |
| `workspace-roles.ts` | Removed ERP permission catalogs |
| `module-governance-service.ts` | HCM-only deps: `payroll → hr` |
| `workspace-go-live-service.ts` | HCM-only gate (`hcmGoLiveReady`) |
| `platform-stabilization-service.ts` | No finance/inventory probes |
| `platform-stabilization.tsx` | HCM go-live UI |
| `payroll-migration-service.ts` | Removed `financeEnabled` |
| `financial-export-service.ts` | Removed finance prepare bridge (export lines kept) |
| `workspace-lifecycle-service.ts` | Removed `initFinance` hook |
| `report-definition-registry.ts` | Removed ERP report keys |
| `report-generators.ts` | Removed ERP generators |
| `export-authorization.ts` | Removed finance permission branches |
| `notifications-bus.ts` | Removed procurement/inventory listeners |
| `document-access-service.ts` | HCM-only confidential doc rules |
| `routes/reports.ts` | Removed procurement/inventory export guards |
| `routes/index.ts` | Unregistered ERP routers |
| `App.tsx` | Removed ERP routes/imports |
| `hr-dashboard.tsx` | Payroll ops link instead of finance |
| `settings.tsx` | HCM-only module guidance |
| `seed/forms.ts` | Expense form category `hr` not `finance` |
| `p-sta-stabilization.smoke.test.ts` | Asserts ERP removal |

---

## Phase 3 — Database

| Item | Action |
|------|--------|
| Migrations `0013–0019` | **Retained** in journal (history) |
| `0022_hcm_drop_erp_domains.sql` | **Added** — DROP all ERP tables + delete module rows |
| Apply `0022` | **Manual** — only after DB backup |

---

## Phase 4 — Intentionally retained

- **Commercial / tenant billing** (platform SaaS monetization, super-admin)
- **Payroll canonical + operations + financial export readiness** (no GL posting)
- **Full HCM stack** (HR, leave, attendance, ESS, workflows, docs, notifications)
- **Platform governance / multi-tenant**

---

## Phase 5 — Deferred (optional follow-up)

- Prune dead event types in `lib/core-events` (procurement/inventory publishers removed)
- Regenerate Drizzle snapshot meta after `0022` on CI
- Archive `p-sta-platform-stabilization.md` ERP sections

---

## Verification

```bash
cd artifacts/api-server && npm test -- --run src/lib/platform/__tests__/p-sta-stabilization.smoke.test.ts
```

---

## Operator checklist

1. Backup production database
2. Deploy code without running `0022` first (safe: ERP tables unused)
3. When ready for schema cleanup: `drizzle migrate` / apply `0022_hcm_drop_erp_domains.sql`
4. Re-seed modules: restart API ( `seedModules` upserts HCM catalog)
