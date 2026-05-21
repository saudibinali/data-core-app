# P21-A — Payroll Readiness Decision

**Date:** 2026-05-19  
**Phase:** P21-A (architecture only)

---

## Decision matrix

| Capability | Status | Rationale |
|------------|--------|-----------|
| **Canonical payroll DB** | **PARTIAL** | Legacy `hr_*` tables exist; canonical model **designed** but not migrated |
| **Compensation engine** | **PARTIAL** | Structures + packages work; no versioning discipline, text money, no bands in calc |
| **Payroll calculations** | **BLOCKED** | Legacy process ignores attendance/leave; not production-ready |
| **Payslip generation** | **PARTIAL** | Data model + APIs exist; no PDF, no issue workflow, auto-approve |
| **Accounting readiness** | **PARTIAL** | GL/bank/journal **designed**; no fields, exports, or mappings |
| **Payroll operations readiness** | **PARTIAL** | Admin UI for setup/runs; no locks, review, or ops integration |

---

## Overall P21-A verdict

| Area | GO / PARTIAL / BLOCKED |
|------|------------------------|
| Architecture documentation | **GO** |
| Production payroll execution | **BLOCKED** |
| P21-B foundation start | **GO** (approved to proceed) |

---

## Gate criteria for P21-B (Canonical Payroll DB)

| # | Criterion | Owner |
|---|-----------|-------|
| 1 | Approve canonical model doc | HR product |
| 2 | Approve decimal money migration plan | Engineering |
| 3 | Define `payroll.*` permissions | Security |
| 4 | No destructive drop of `hr_*` tables | Engineering |

---

## Gate criteria for payroll calculation GO (post P21-B/C)

| # | Criterion |
|---|-----------|
| 1 | `PayrollAttendanceAdapter` reads locked summaries |
| 2 | Preview vs final run separation |
| 3 | Attendance period lock enforced |
| 4 | Correction run pattern implemented |
| 5 | Smoke tests: 10 employees, 1 period, reconcile totals |

---

## Gate criteria for accounting readiness GO

| # | Criterion |
|---|-----------|
| 1 | `gl_account_code` on all components |
| 2 | `hr.payroll.journal.json` export from locked run |
| 3 | Cost center on every line |

---

## Dependencies on P20 platform

| P20 deliverable | Payroll dependency | Status |
|-----------------|-------------------|--------|
| `attendance_daily_summaries` | Primary input | **GO** |
| Leave overlay on summaries | Paid/unpaid days | **BLOCKED** |
| Period lock | Close process | **BLOCKED** |
| P20-F ops | Replay governance | **GO** |
| Import adjustments | Overrides | **GO** |

---

## Risks accepted in P21-A

1. Legacy payroll UI remains available—must be labeled non-production.  
2. Dual salary sources until `employees.salary` deprecated.  
3. Text money persists until P21-B migration.

---

## Recommended next phase

**P21-B — Canonical Payroll DB & Compensation Engine Foundation**

Deliverables:

- Migrations for canonical tables (alongside legacy)  
- Decimal money types  
- `compensation_packages` service with supersede semantics  
- Read adapters (attendance period days) — **no full calc rollout**  
- `payroll_locks` + API enforcement hooks  

**Do not** enable bank disbursement or ERP posting in P21-B.

---

## Sign-off checklist

- [x] Current payroll audited  
- [x] Canonical models specified (11 entities)  
- [x] Compensation architecture documented  
- [x] Calculation pipeline documented  
- [x] Attendance/leave integration documented  
- [x] Policy strategy documented  
- [x] Payslip/reporting strategy documented  
- [x] Accounting export readiness documented  
- [x] Security/compliance documented  
- [x] No code migrations in P21-A  
- [x] No production payroll rollout  
