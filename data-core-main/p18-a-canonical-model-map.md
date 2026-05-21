# P18-A — Canonical Model Map

**Phase:** P18-A (decisions only)  
**Date:** 2026-05-19

This map defines **one canonical concept per row** for Workspace/HR. Legacy/overlap items remain in the codebase until planned migration work; they must not receive new product features.

| Concept | Canonical model / table | Legacy / overlap | Decision | Future action |
|---------|-------------------------|------------------|----------|---------------|
| **Workspace** | `workspaces` (`id`) | Platform label “tenant” | `workspaces.id` is the tenant boundary; no second table | None for boundary; document naming in platform APIs |
| **Tenant naming** | Alias → `workspaces.id` | `tenantId` route params, `tenant_subscriptions.workspace_id` | Treat as **workspaceId** in all new design docs; no schema rename now | Optional doc/style guide for API authors |
| **Employee** | `employees` | `users` profile fields; free-text duplicates | **employees** = HR source of truth | User sync policy; optional provisioning flow |
| **User** | `users` (`workspace_id` set) | Overlap with employee contact fields | **users** = login/RBAC only; link via `employees.user_id` | Document invite/link flow; no employee-in-users |
| **Organization unit** | `hr_org_units` (tree: company…team) | `departments` flat list | **hr_org_units** for all new HR org work | Mapping plan from departments; eventual RBAC migration |
| **Department** | — (not canonical for HR) | `departments`, `user_departments` | **Legacy** for users module + `departments.{id}.*` permissions | Deprecation plan after org mapping; do not delete in P18-A |
| **Position** | `hr_positions` (seat/headcount) | `employees.position` free text; job title alone | **hr_positions** for structured seats; discourage free-text for new features | Migrate/report on `employees.position` usage; UI guidance |
| **Job title** | `hr_job_titles` (+ optional `hr_job_grades`) | `employees.position` text; position title fields | **hr_job_titles** for title catalog; positions may reference title | Align employee assignment to title FK |
| **Employee status** | `hr_employee_statuses` (catalog) | `employees.status` text | Catalog is canonical **definition**; row field **not enforced yet** | FK or enforced code sync in later phase |
| **Contract type** | `hr_contract_types` (catalog) | `hr_employee_contracts.contract_type` text | Catalog is canonical **definition**; contract row **not enforced yet** | Align contract rows to catalog codes |
| **Leave request** | `leave_requests` (+ `leave_approval_steps`) | `hr_employee_leaves` | **Target** canonical leave lifecycle | Migration drift fix; bridge; deprecate legacy APIs |
| **Leave balance** | `hr_leave_balances` | `employees.leave_balances` jsonb | **hr_leave_balances** table for structured balances | Stop new logic on jsonb; migrate/consolidate if needed |
| **Payroll** | `hr_payroll_runs`, `hr_payslips`, `hr_payslip_lines`, compensation tables, salary structure tables | None duplicate | **Extend** existing payroll model | Tests, UX, optional permissions later |
| **Attendance** | `hr_attendance`, `hr_shifts`, `hr_work_calendars`, `hr_calendar_holidays`, overtime tables | `hr_employee_leaves` used in attendance UI for some leave views | **Extend** attendance tables; leave via canonical leave model eventually | Unify leave UI on `leave_requests` after migration |
| **HR services** | `hr_services`, `hr_service_categories` | Duplicate self-service concepts | **hr_services** = service catalog | No parallel portal |
| **Forms** | `form_definitions`, `form_submissions`, `form_fields` | — | **Reuse** for HR services and leave sources | Wire leave_requests source FKs when live |
| **Workflows** | `workflow_definitions`, executions, tasks | General `approvals` module | **Reuse** for HR automation; leave uses `leave_approval_steps` for leave domain | Keep domains separate; integrate via events |

---

## Supporting canonical tables (reference)

| Domain | Canonical tables (extend, do not duplicate) |
|--------|-----------------------------------------------|
| Org support | `hr_job_grades`, `hr_work_locations` |
| Employment lookups | `hr_employment_types`, `hr_probation_policies` |
| Documents | `hr_document_types`, `hr_employee_documents` |
| Contracts | `hr_employee_contracts` (after type alignment) |
| Employee extensions | `hr_custom_field_defs`, `hr_custom_field_values`, `hr_employee_position_history`, `hr_employee_notes`, `hr_employee_activity` |
| Workspace HR config | `hr_workspace_settings`, `hr_workspace_counters` |
| Module gating | `workspace_module_settings`, `platform_modules` |

---

## Explicitly non-canonical (do not extend for new features)

| Item | Reason |
|------|--------|
| `departments` for HR org | Legacy user/RBAC model |
| `hr_employee_leaves` for new leave features | Legacy leave path |
| `employees.leave_balances` jsonb for new balance logic | Superseded by `hr_leave_balances` |
| Entitlement-only modules (recruitment, LMS, performance) | No implementation tables yet |

---

**Confirmation:** Documentation only — no schema or code changes in P18-A.
