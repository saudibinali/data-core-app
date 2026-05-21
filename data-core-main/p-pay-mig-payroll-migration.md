# P-PAY-MIG — Legacy Payroll Migration

**Date:** 2026-05-20  
**Goal:** Close `dual_payroll_models` risk (SAP PA → FI prepare path).

## Delivered

- `GET /api/hr/payroll-migration/report`
- `POST /api/hr/payroll-migration/run` — `dryRun: true` default
- Maps `hr_payroll_runs` → `payroll_runs` with `legacyPayrollRunId`
- Idempotency: `payroll-mig-{legacyId}`
- Creates `payroll_periods` when missing
- Imports `hr_payslips` → `payroll_run_employees` (snapshot, no recalc)
- Stabilization UI + `payrollMigration` in snapshot API

## Status mapping

| Legacy | Canonical |
|--------|-----------|
| draft | draft |
| processing | calculating |
| approved | approved |
| paid | locked |
| cancelled | draft (noted) |

## Cutover sequence (global)

1. P-HCM2 / P-HCM3 — HCM  
2. P-FIN-ENA — Finance activation  
3. **P-PAY-MIG** — this phase  
4. `LEGACY_PAYROLL_FREEZE=true`  
5. `/finance/ops` prepare batches  

## Not in scope

- Payroll recalculation  
- GL posting  
- Deleting `hr_payroll_runs`

## Next

- Procurement/inventory only after finance prepare validated per tenant
