# P18-A — Workspace HR Architecture Consolidation Decisions

**Phase:** P18-A (decisions and documentation only)  
**Date:** 2026-05-19  
**Status:** Accepted for planning — **no implementation in this phase**  
**Inputs:** Workspace/HR discovery reports (2026-05-19)

---

## Purpose

Lock architectural boundaries before expanding toward a larger ERP. Prevent parallel models, duplicate tables, and conflicting APIs while the existing HR Foundation remains the base to extend.

---

## Decision record

### A. Workspace boundary

| Item | Decision |
|------|----------|
| **Isolation key** | `workspace_id` is the **only** client data isolation boundary for HR and all workspace-scoped domains. |
| **HR tables** | Must **not** introduce `tenant_id` on HR or employee tables. Tenancy is expressed via `workspace_id` → `workspaces.id`. |
| **Platform naming** | `tenantId` in platform APIs (e.g. `/platform/tenants/:tenantId/*`) is treated as **`workspaces.id`** today. This is a naming alias, not a second entity. |
| **Relationship change** | **No change now** to the workspace/tenant relationship. Do not split tenant from workspace or add a mapping table in P18-A. |
| **Future domains** | Finance, procurement, and other ERP modules must reuse the same `workspace_id` boundary — no new tenant/workspace pair per domain. |

**Rationale:** Discovery confirms 1:1 tenant ↔ workspace and 40+ tables already keyed by `workspace_id`. Introducing `tenant_id` on HR would duplicate the boundary and invite drift.

---

### B. Person model

| Item | Decision |
|------|----------|
| **Source of truth (HR person)** | `employees` is the **canonical** record for anyone managed as an employee in HR (identity, org placement, employment, documents, payroll linkage). |
| **Login account** | `users` is a **login and RBAC account** only (authentication, workspace role, custom role permissions). |
| **Link** | `employees.user_id` is an **optional** FK to `users.id`. Not every employee has a user; not every user is an employee. |
| **Prohibited (now)** | Do **not** create employee master data inside `users` (no “employee profile” as primary in users table). |
| **Prohibited (now)** | Do **not** auto-create `users` inside employee create APIs without an explicit, documented **account provisioning flow** in a later phase. |
| **Future** | A dedicated “link or invite user for employee” flow may be defined in P18+ after sync policy is written. |

**Rationale:** Discovery shows overlapping fields (name, email, department) and two UIs (`/users` vs `/hr/employees`). Splitting roles prevents a third “person” table.

---

### C. Organization model

| Item | Decision |
|------|----------|
| **Canonical HR org** | `hr_org_units` is the **primary** organizational hierarchy for HR (company → branch → division → department → team). |
| **Legacy model** | `departments` (+ `user_departments`) remains a **legacy, user-centric, RBAC-oriented** model. It is **temporary** and must not receive new HR features. |
| **Prohibited (now)** | Do **not** build new HR org features on `departments`. Do **not** add HR employee FKs to `departments` as the long-term design. |
| **Prohibited (now)** | Do **not** delete `departments` or migrate data in P18-A. Removal requires a **migration plan** (RBAC dynamic keys `departments.{id}.*`, tickets, users UI). |
| **Future** | A **departments → hr_org_units mapping plan** (and optional deprecation) is backlog work after audit and tests. |

**Rationale:** High-severity duplication risk in discovery. HR Foundation UI and employee FKs already target `hr_org_units`.

---

### D. Leave model

| Item | Decision |
|------|----------|
| **Future canonical** | `leave_requests` (+ `leave_approval_steps`) is the **target** model for leave lifecycle (approval, balances integration, audit). |
| **Legacy** | `hr_employee_leaves` is a **legacy/simple** model (employee-nested CRUD, attendance bridge). |
| **Prohibited (now)** | Do **not** add **new** leave APIs or product features on `hr_employee_leaves`. Maintenance-only until bridge/deprecation. |
| **Prohibited (now)** | Do **not** use `leave_requests` in **production** until **migration drift** is resolved (schema exists in Drizzle; may be missing from applied `0000_sad_midnight.sql`). |
| **Future** | **Migration and bridge plan** required: DB migration, data backfill from `hr_employee_leaves`, API/UI single entry point, then deprecate legacy paths. |

**Rationale:** Two active API surfaces and possible schema–DB mismatch make production use of `leave_requests` unsafe without P18-B audit.

---

### E. Employee status model

| Item | Decision |
|------|----------|
| **Catalog** | `hr_employee_statuses` is the **configurable catalog** per workspace (code, labels, flags). |
| **Current storage** | `employees.status` is **free text** today (e.g. active, on_leave, terminated). |
| **Prohibited (now)** | Do **not** add new status transition logic, workflows, or enforcement until a later decision: **FK to catalog** and/or **enforced code** alignment. |
| **Future** | Align `employees.status` with `hr_employee_statuses.code` (FK or check constraint) in a dedicated alignment phase. |

---

### F. Contracts / types

| Item | Decision |
|------|----------|
| **Catalog** | `hr_contract_types` is the **configurable catalog** per workspace. |
| **Current storage** | `hr_employee_contracts.contract_type` is **text** (parallel string enums). |
| **Prohibited (now)** | Do **not** add new contract-type business logic or validations tied only to text enums. |
| **Future** | Unify on catalog codes (FK or enforced reference) in a later alignment phase. |

**Same pattern applies where discovery noted overlap:** `hr_employment_types` vs `employees.employment_type`, `hr_document_types` vs `hr_employee_documents.document_type` — extend catalogs first, enforce references later.

---

### G. Payroll / attendance

| Item | Decision |
|------|----------|
| **Existing assets** | Payroll (`hr_salary_*`, `hr_payroll_runs`, `hr_payslips`, …) and attendance (`hr_attendance`, `hr_shifts`, calendars, overtime) are **in scope for extension**, not replacement. |
| **Prohibited (now)** | **No rebuild** of payroll or attendance domains. **No duplicate tables** (e.g. `payroll_runs_v2`, `attendance_records_v2`). |
| **Future** | Improve UX, tests, and permissions granularity after core person/org/leave decisions are stable. |

---

### H. HR services / forms / workflows

| Item | Decision |
|------|----------|
| **Service catalog** | `hr_services` (+ `hr_service_categories`) is the **canonical** HR service catalog (links to `form_definitions`, optional `workflow_event`). |
| **Integrations** | Forms (`form_definitions`, submissions) and workflows (`workflow_definitions`) are **existing integration points** — reuse them. |
| **Prohibited (now)** | Do **not** build a **parallel** self-service or request portal outside `hr_services` + forms + `/self-service` module. |
| **Self-service route** | `/self-service` remains the employee portal surface; consolidation of leave/forms happens via catalog + leave canonical model, not a new subsystem. |

---

### I. Permissions

| Item | Decision |
|------|----------|
| **HR granular permissions** | **Not in scope** for the next development waves until person, org, and leave models are stable. |
| **Current matrix** | Continue using `hr.view`, `hr.manage`, `hr.services.manage`, and workspace role matrix as-is. **No role matrix changes in P18-A.** |
| **Known issue** | `self_service.view` is required by `App.tsx` for `/self-service` but is **missing** from `STATIC_PERMISSION_GROUPS` in `workspace-roles.ts`. **Record only — do not fix in P18-A.** |
| **Future** | HR fine-grained permissions (payroll-only, foundation-only, etc.) come **after** canonical model alignment and baseline tests. |

---

### J. API structure

| Item | Decision |
|------|----------|
| **Current state** | `artifacts/api-server/src/routes/hr.ts` is a **monolith** (~130 endpoints, ~4000+ lines). Acknowledged maintainability risk. |
| **Prohibited (now)** | **No split/refactor** of `hr.ts` in P18-A or immediate follow-up without a **test baseline** and explicit refactor plan. |
| **Future** | Split by domain (foundation, employees, payroll, attendance, leave) after P18-B migration audit and HR tests exist. |

---

### K. Future ERP expansion

| Item | Decision |
|------|----------|
| **HR position** | Current HR stack is the **first operational domain** inside the workspace boundary. |
| **Finance** | Future finance module must use **`workspace_id`** and commercial links already on workspace/commercial tables — **no new tenant/workspace entity**. |
| **Planned domains (deferred)** | Recruitment, performance, LMS, legal entities, cost centers — **catalog names may exist** in entitlements; **no tables or APIs** until HR consolidation phases complete. |
| **Rule** | Any new domain attaches to **`workspaces.id`** via `workspace_id`; it does not introduce a parallel isolation model. |

---

## Out of scope for P18-A (explicit)

- Code changes, migrations, APIs, permissions, role matrix updates  
- Refactor of `hr.ts`, deletion of `departments`, production enablement of `leave_requests`  
- Finance, recruitment, LMS, performance, workspace permission redesign  
- Bug fixes (including `self_service.view` gap)

---

## Related artifacts

| Document | Role |
|----------|------|
| `p18-a-canonical-model-map.md` | Concept → table mapping |
| `p18-a-do-not-duplicate-list.md` | Hard prohibitions for implementers |
| `p18-a-future-work-backlog.md` | Prioritized follow-up work |
| `workflow-phase-18a-report.txt` | Phase closure summary |

---

## Confirmation

**P18-A — Workspace HR Architecture Consolidation Decisions: DOCUMENTATION ONLY — COMPLETE**
