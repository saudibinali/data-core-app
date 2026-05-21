# Workspace / HR Redesign Readiness Report

**Discovery date:** 2026-05-19

---

## 1. Is the current structure ready for redesign?

**Partially ready.** The HR Foundation and Employee Core are **substantially implemented** (schema + APIs + admin UI). However, **organizational duplication**, **dual leave systems**, and **schema–migration drift** mean redesign should start with **consolidation decisions**, not greenfield tables.

**Readiness score (qualitative):**

| Area | Ready? | Comment |
|------|--------|---------|
| Workspace boundary | Yes | Clear `workspace_id` isolation |
| HR Foundation data model | Yes | Org, grades, titles, positions, lookups |
| Employee core | Yes | Rich model + UI |
| Payroll / attendance | Mostly | Backend heavy; UX uneven |
| Leave | No | Must pick canonical model + migrate |
| Org structure (single model) | No | Must merge departments vs hr_org_units |
| HR permissions | No | Too coarse; gaps in catalog |
| Automated tests | No | Almost no HR tests |

---

## 2. What exists today (fact base)

- **38+ HR tables** in `lib/db/src/schema/hr.ts` (plus workspace shell tables)
- **~145 HTTP endpoints** for workspace/HR in `hr.ts`, `leave.ts`, shell routes
- **14 HR-focused pages** in ops-platform + Foundation admin
- **Configurable foundation** per workspace (statuses, types, policies, org tree)
- **Employee lifecycle** with contracts, documents, notes, activity, import/export
- **Payroll engine** tables and processing endpoint (`/hr/payroll/runs/:id/process`)
- **Integration hooks** to forms and workflows via HR services

---

## 3. What is missing

| Gap | Impact |
|-----|--------|
| Legal entities / cost centers | Enterprise org accounting |
| Recruitment, performance, LMS tables | Entitlement names only |
| Unified org model | Operational confusion |
| Single leave workflow | Data inconsistency |
| Employee ↔ user sync rules | Duplicate master data |
| HR-specific RBAC granularity | Cannot delegate payroll-only admin |
| E2E / unit tests for HR | Regressions likely on refactor |
| Applied migration for `leave_requests` | Production runtime errors if code deployed without migrate |
| Dedicated HR API module split | Maintainability |
| `reports.view` HR reporting page | Permission without product |

---

## 4. What to stabilize BEFORE building new HR permissions

1. **Canonical person model:** Decide `employees` as HR source of truth; define when `users` row is created and synced fields.
2. **Canonical org model:** Pick `hr_org_units` OR `departments` (recommend org units for HR; map departments for legacy RBAC or migrate permissions to org unit IDs).
3. **Canonical leave model:** Deprecate `hr_employee_leaves` or bridge to `leave_requests`; apply migration.
4. **Align employee.status** with `hr_employee_statuses` (FK or enforced code).
5. **Fix permission catalog:** Add `self_service.view`; define HR sub-permissions if needed (payroll, attendance, foundation, employees).
6. **Verify DB = schema** on staging (especially `leave_requests`, any P16 tables if in scope later).

---

## 5. What NOT to build now

- New parallel `workspace_employees` or `org_departments_v2` tables
- Second leave table set
- Duplicate Foundation admin screens
- New tenant table (workspace already is tenant)
- Platform-user-style permission overrides for workspace (different product)
- Full recruitment/performance/LMS until foundation consolidation done

---

## 6. Recommendations

| Decision | Recommendation |
|----------|----------------|
| Overall strategy | **Reorder and consolidate existing assets** — not greenfield |
| Organization | **Extend `hr_org_units`**; plan deprecation path for `departments` with RBAC migration |
| Employees | **Continue on `employees`**; strengthen user linking and sync |
| Leave | **Standardize on `leave_requests`**; migrate data from `hr_employee_leaves`; one API surface |
| APIs | **Split `hr.ts` by domain** when touching code (foundation, employees, payroll, attendance) — later phase |
| Frontend | **Unify navigation** under `/hr` hub; hide or redirect legacy `/departments` when ready |
| Permissions | **Extend workspace role matrix** after canonical models fixed |
| Payroll/attendance | **Defer redesign** — extend current modules unless blocking |

| Phase | Action |
|-------|--------|
| **Defer** | Recruitment, LMS, performance modules |
| **Defer** | Legal entity module until org model settled |
| **Now (planning only)** | Migration audit, duplication decision doc, permission matrix design |
| **Later** | Physical refactor of `hr.ts`, comprehensive test suite |

---

## 7. Risk if redesign starts without decisions

- Third org/leave/employee model
- Broken `departments.{id}` dynamic permissions
- Partial migrations leaving APIs pointing at missing tables
- UI showing inconsistent headcount / org charts

---

**Confirmation:** Discovery only — no redesign work performed.
