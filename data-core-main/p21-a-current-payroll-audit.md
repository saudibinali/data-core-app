# P21-A — Current Payroll Audit

**Phase:** P21-A (architecture only — no migrations, no execution rollout)  
**Date:** 2026-05-19  
**Scope:** Existing schema, APIs, UI, and cross-module coupling in `data-core-main`

---

## 1. Executive audit summary

The platform already has a **legacy HR payroll stack** (`hr_*` tables) with monthly runs, payslips, salary structures, and a basic process endpoint. It is **compensation-centric** (structure + basic salary) and **does not consume** the P20 Workforce Event Platform (`attendance_daily_summaries`, canonical leave overlays) during calculation.

P21-A treats this stack as **source material** for a canonical model—not as production payroll execution for enterprise rollout.

---

## 2. Database tables (payroll-related)

| Table | Purpose (as-is) | Workspace isolation | Notes |
|-------|-----------------|---------------------|-------|
| `hr_salary_components` | Component catalog (base, allowance, deduction, bonus, overtime) | `workspace_id` | `code` unique per workspace |
| `hr_salary_structures` | Template packages | `workspace_id` | `currency_code`, default flag |
| `hr_salary_structure_components` | Structure ↔ component bridge | via structure | amounts as **text** |
| `hr_salary_bands` | Grade min/mid/max | `workspace_id` | Not wired into process loop |
| `hr_employee_compensations` | Employee assignment (effective dates) | `workspace_id` | status: draft \| active \| superseded |
| `hr_employee_compensation_items` | Per-employee overrides | via compensation | |
| `hr_payroll_runs` | Monthly run header | `workspace_id` | **Unique** `(workspace, year, month)` |
| `hr_payslips` | Per-employee snapshot | `workspace_id` | `working_days` / `absent_days` columns **unused** in process |
| `hr_payslip_lines` | Line items at run time | via payslip | Denormalized component names |
| `hr_overtime_records` | OT approval workflow | `workspace_id` | `payroll_run_id`, `payslip_id` FKs exist; **not populated** by process |
| `employees.salary` | Free-text legacy field | `workspace_id` | Parallel to compensation engine |

### Workforce platform tables (payroll consumers — not read today)

| Table | Payroll relevance |
|-------|-------------------|
| `attendance_daily_summaries` | Canonical day facts: `worked_minutes`, `late_minutes`, `overtime_minutes`, `status` |
| `attendance_events` / `attendance_raw_events` | Evidence chain |
| `attendance_adjustments` | Post-ingest corrections |
| `hr_attendance` | Legacy dual-write target; still used by OT records FK |
| `leave_requests` | Approved leave; **no** attendance overlay generation |
| `hr_leave_balances` | Entitlement accounting; separate from payroll deduction |

---

## 3. Payroll-related fields on non-payroll tables

| Location | Fields | Risk |
|----------|--------|------|
| `employees` | `salary` (text) | Duplicate source of truth vs `hr_employee_compensations` |
| `hr_overtime_policies` | `salary_component_id` | Designed for OT→payslip mapping; unused in process |
| `hr_overtime_records` | `calculated_amount`, `payroll_run_id`, `payslip_id` | Linkage schema only |
| `hr_attendance` | `overtime_minutes`, `late_minutes`, `status` | Not read by payroll process |
| `attendance_daily_summaries` | `legacy_attendance_id` | Bridge only; payroll does not follow |

---

## 4. API surface (`artifacts/api-server/src/routes/hr.ts`)

| Area | Endpoints | Permission | Behavior |
|------|-----------|------------|----------|
| Components | CRUD `/hr/payroll/components` | manage / admin | Catalog |
| Structures | CRUD + structure components | manage / admin | Templates |
| Bands | CRUD `/hr/payroll/bands` | manage / admin | Reference data |
| Runs | CRUD `/hr/payroll/runs` | manage / admin | Monthly period via year+month |
| **Process** | `POST .../runs/:id/process` | **workspace admin** | Rebuilds all payslips; sets run **approved** immediately |
| Payslips | List/detail per run | `hr.manage` | |
| Self-service | `/hr/me/payslips` | authenticated employee | Read own payslips |

### Process algorithm (simplified)

1. Load active employees with **active** `hr_employee_compensations`.
2. Expand structure components + employee overrides.
3. Compute gross = basic + allowances + bonus + overtime (structure lines only).
4. Net = gross − deductions.
5. **Skip** employees without compensation.
6. **Does not read:** attendance summaries, leave, holidays, approved OT records.
7. **Does not set:** `working_days`, `actual_days`, `absent_days` on payslip.
8. Deletes and recreates payslips on re-process (destructive within run).

---

## 5. UI surface

| Page | Route | Capabilities |
|------|-------|--------------|
| `hr-payroll.tsx` | `/admin/hr/payroll` | Components, structures, bands, runs, process trigger |
| `hr-payroll-run.tsx` | `/admin/hr/payroll/runs/:id` | Run detail, payslip list |
| `hr-me-payslips.tsx` | self-service | Employee payslip history |
| `hr-dashboard.tsx` | link to payroll | Navigation only |

No payroll lock UI, no period close, no GL export, no bank file UI.

---

## 6. Attendance interactions (current)

| Path | Status |
|------|--------|
| Payroll → `attendance_daily_summaries` | **None** |
| Payroll → `hr_attendance` | **None** |
| OT records → legacy `hr_attendance.id` | Optional FK; canonical events not linked |
| Summary → payslip days | **Blocked** (fields exist, unused) |
| Period lock before payroll | **None** |
| P20-F ops replay affecting closed payroll | **Uncontrolled** (no lock) |

---

## 7. Leave interactions (current)

| Path | Status |
|------|--------|
| Approved `leave_requests` → attendance `on_leave` | **No** |
| Unpaid leave → deduction component | **No** |
| Leave balance → payroll | **No** (balance is HR-only) |
| Holiday calendar → paid non-working day | **No** |

---

## 8. Reporting & export usage

| Report key | Module | Payroll coupling |
|------------|--------|------------------|
| `hr.attendance.period` | P19 reports | Reads legacy/summary paths; **not** payroll |
| `hr.employees.roster` | HR | No salary in export by default |
| Workforce ops reports (P20-F) | JSON | Operational only |
| **No** `hr.payroll.*` report definitions | — | Gap |

`generated_reports` + `export_jobs` can host future payroll exports; no payroll-specific generators registered today.

---

## 9. Document registry & notifications

| Capability | Payroll usage |
|------------|---------------|
| `documents` / folders (`payroll` folder type) | Supported in `folder-service`; not mandatory for payslips |
| Payslip PDF | **Not implemented** (data API only) |
| Notifications | No `payroll.*` bus events in `@workspace/core-events` |
| Email payslip | **None** |

---

## 10. Workspace settings

| Table | Payroll fields |
|-------|----------------|
| `hr_workspace_settings` | **Only** employee numbering (`numbering_mode`, `numbering_start_from`) |
| `workspace_module_settings` | Module enablement |
| **No** payroll calendar, cutoff, tax profile, or lock config |

---

## 11. Money & precision risks

- All monetary amounts stored as **`text`** (string decimals).
- Process uses JavaScript `parseFloat` (binary float rounding risk).
- No currency scale enforcement (2 vs 3 decimal places).
- No multi-currency run splitting (single `currency_code` on run).

---

## 12. Security & permissions (as-is)

| Action | Gate |
|--------|------|
| View payroll | `hr.manage` |
| Process run | `requireWorkspaceAdmin` |
| View own payslip | any authenticated user with employee link |
| Salary components CRUD | workspace admin |

No field-level salary masking in APIs; payslip detail returns full amounts to `hr.manage`.

---

## 13. Gaps & risks (prioritized)

| # | Gap | Severity | Notes |
|---|-----|----------|-------|
| G1 | No attendance/leave inputs to calculation | **Critical** | Payslip days cosmetic |
| G2 | No payroll period lock / retro control | **Critical** | Post-close edits possible |
| G3 | Process auto-approves run | **High** | Skips review workflow |
| G4 | Text money + float math | **High** | Enterprise compliance risk |
| G5 | Duplicate salary sources (`employees.salary` vs compensation) | **Medium** |
| G6 | OT approval not consumed | **Medium** | Double-pay risk if manually added |
| G7 | No tax/social insurance engine | **Expected** | Out of P21-A scope |
| G8 | No accounting export | **Expected** | Design only in P21-A |
| G9 | `hr_payroll_runs` = calendar month only | **Medium** | No semi-monthly/custom cycles |
| G10 | Re-process deletes payslips | **Medium** | Needs versioning in canonical model |

---

## 14. Coexistence strategy (P21-A → P21-B)

- **Do not** drop `hr_*` payroll tables in P21-A.
- Introduce **canonical names** as views/aliases or parallel tables in P21-B with migration adapters.
- Payroll process remains **disabled for production rollout** until P21-B+ validates read adapters from `attendance_daily_summaries` and lock model.

---

## 15. References

- `lib/db/src/schema/hr.ts` — payroll section (~L767–1016)
- `artifacts/api-server/src/routes/hr.ts` — process endpoint (~L2712)
- `p20-a-attendance-payroll-leave-interaction.md`
- `workflow-phase-20a-report.txt` through `workflow-phase-20f-report.txt`
