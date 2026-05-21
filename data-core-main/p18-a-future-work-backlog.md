# P18-A — Future Work Backlog

**Phase:** P18-A (planning backlog only)  
**Date:** 2026-05-19  
**Prerequisite for implementation work:** Decisions in `p18-a-workspace-hr-architecture-decisions.md` and prohibitions in `p18-a-do-not-duplicate-list.md`

---

## Critical (before meaningful HR expansion)

| ID | Item | Why critical | Suggested output |
|----|------|--------------|------------------|
| C1 | **Verify DB migration drift** | `leave_requests` / `leave_approval_steps` in Drizzle may be absent from applied `0000_sad_midnight.sql`; runtime failures if code assumes tables exist | Environment matrix: schema vs DB; list of missing tables |
| C2 | **leave_requests migration / bridge plan** | Dual leave models (`hr_employee_leaves` vs `leave_requests`); P18-A forbids new legacy APIs and production use of canonical until fixed | Written plan: migrate, backfill, API cutover, UI single path, deprecate legacy |
| C3 | **HR tests baseline** | ~145 HR endpoints, almost no dedicated HR tests; refactor unsafe without baseline | Minimal vitest/integration suite per domain (foundation, employees, leave) |
| C4 | **self_service.view permission gap — decision** | Route requires permission not in static registry; P18-A records only | ADR: add to matrix vs fold into `hr.view`; then implement in permissions phase |

**Recommended phase:** **P18-B — Workspace HR Migration Drift & Baseline Tests Audit**

---

## Important (consolidation enablers)

| ID | Item | Description | Depends on |
|----|------|-------------|------------|
| I1 | **departments → hr_org_units mapping plan** | Map legacy departments to org units; impact on `user_departments`, dynamic permissions `departments.{id}.*`, `/departments` UI | C3 optional for safe refactors |
| I2 | **Employee / user sync policy** | When to create user, required fields sync direction, unlink rules, manager line (`direct_manager_id` vs user manager) | B person model decision |
| I3 | **Employee status alignment** | Enforce `employees.status` against `hr_employee_statuses.code` (FK or check) | I2 optional |
| I4 | **Contract type alignment** | Enforce `hr_employee_contracts.contract_type` against `hr_contract_types` | I3 pattern |
| I5 | **Employment / document type alignment** | Same pattern for `employment_type`, `document_type` text fields | I4 pattern |
| I6 | **Leave balance consolidation** | Prefer `hr_leave_balances`; plan retirement of `employees.leave_balances` jsonb for new logic | C2 |
| I7 | **hr.ts split plan** | Domain routers: foundation, employees, payroll, attendance, leave; register in `index.ts` | C3 baseline tests |
| I8 | **Navigation consolidation** | HR hub vs `/departments`; redirect or hide legacy when org mapping ready | I1 |
| I9 | **Position / job title UX rules** | Reduce reliance on `employees.position` free text; promote `positionId` / `jobTitleId` | None |

---

## Later (deferred domains and enhancements)

| ID | Item | Notes |
|----|------|-------|
| L1 | **HR fine-grained permissions** | payroll-only, attendance-only, foundation-admin, employee-read; after I1–I3 stable |
| L2 | **Recruitment** | No tables today; entitlement name only |
| L3 | **Performance management** | Notes types exist; no review cycle domain |
| L4 | **LMS / learning** | Entitlement catalog only |
| L5 | **Finance module** | Must use `workspace_id`; link commercial accounts; separate phase |
| L6 | **Cost centers** | Not in schema; define against org model when needed |
| L7 | **Legal entities** | Commercial `legal_entity_name` only; HR org units may represent company level |
| L8 | **Advanced HR reporting** | `reports.view` permission without dedicated HR reports product |
| L9 | **E2E tests against live DB** | After migration audit |
| L10 | **Employee import / provisioning flow** | Explicit user account creation from employee |

---

## Suggested phase sequence (not started in P18-A)

```
P18-A  Architecture decisions          ← COMPLETE (docs only)
P18-B  Migration drift & test audit   ← RECOMMENDED NEXT
P18-C  Leave migration / bridge       (after C1–C2)
P18-D  Org mapping (departments)      (after C3, I1)
P18-E  Person sync policy + UI flows  (I2)
P18-F  Catalog enforcement (status, contracts, …) (I3–I5)
P18-G  hr.ts split + navigation       (I7–I8, with tests)
P18-H  HR permissions granularity     (L1)
--- later ERP domains (Finance, Recruitment, …) ---
```

Phases C–H are **illustrative**; renumber when scheduling. **Do not start P18-B** as part of P18-A task completion.

---

## Explicitly out of backlog for near term

- Deleting `departments` without mapping plan  
- Production `leave_requests` without C1–C2  
- Platform-style permission overrides for workspace users  
- Greenfield HR schema  
- Fixing unrelated commercial/subscription/platform user work  

---

**Confirmation:** Backlog is planning-only; no work items executed in P18-A.
