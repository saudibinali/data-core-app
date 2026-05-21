# HR Module Inventory Report

**Discovery date:** 2026-05-19

Status key: **complete** | **partial** | **placeholder** | **unknown**

---

## 1. Workspace shell (client container)

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Workspace profile | `routes/workspaces.ts`, `pages/settings.tsx` (partial) | partial | `workspaces` | `/workspaces/me` | settings branding | none dedicated |
| Module enablement | `routes/modules.ts`, `seed/modules.ts` | complete | `platform_modules`, `workspace_module_settings` | `/modules` | sidebar | none |
| Workspace RBAC | `routes/workspace-roles.ts` | complete | custom roles tables | `/workspace-roles`, `/permissions` | `roles.tsx` | platform-access tests only |
| Workspace users | `routes/users.ts` | complete | `users` | `/users` | `users.tsx` | none HR-specific |
| Invitations | `routes/invitations.ts` | complete | `workspace_invitations` | `/invitations` | `users.tsx` | none |
| Legacy departments | `routes/departments.ts` | complete | `departments` | `/departments` | `departments.tsx` | none |

**Dependencies:** auth middleware, `requirePermission`, forms/workflows optional.

---

## 2. HR Foundation (organization & reference data)

| Module | Location | Status | DB tables | API prefix | UI | Tests |
|--------|----------|--------|-----------|------------|-----|-------|
| Org units | `hr.ts` routes, `hr-foundation.tsx` | complete | `hr_org_units` | `/hr/org-units` | Foundation tab | none |
| Job grades | same | complete | `hr_job_grades` | `/hr/job-grades` | Foundation | none |
| Job titles | same | complete | `hr_job_titles` | `/hr/job-titles` | Foundation | none |
| Work locations | same | complete | `hr_work_locations` | `/hr/foundation/work-locations` | Foundation | none |
| Positions | same | complete | `hr_positions` | `/hr/foundation/positions` | Foundation | none |
| Employee statuses | same | complete | `hr_employee_statuses` | `/hr/foundation/statuses` | Foundation | none |
| Employment types | same | complete | `hr_employment_types` | `/hr/foundation/employment-types` | Foundation | none |
| Contract types | same | complete | `hr_contract_types` | `/hr/foundation/contract-types` | Foundation | none |
| Document types | same | complete | `hr_document_types` | `/hr/foundation/document-types` | Foundation | none |
| Leave policies | same | complete | `hr_leave_policies` | `/hr/foundation/leave-policies` | Foundation | none |
| Probation policies | same | complete | `hr_probation_policies` | `/hr/foundation/probation-policies` | Foundation | none |
| Foundation seed | `hr.ts` POST | complete | multiple | `/hr/foundation/seed` | Foundation button | none |
| HR workspace settings | `hr.ts` | partial | `hr_workspace_settings`, counters | `/hr/settings` | embedded in Foundation | none |

**UI:** `artifacts/ops-platform/src/pages/hr-foundation.tsx` (~900+ lines) — tabbed admin for all foundation entities.  
**Utils:** `artifacts/ops-platform/src/lib/hr-utils.ts` (`toCode`, etc.)

**Notes:** No dedicated legal entity or cost center module. Branch/division via org unit `type`.

---

## 3. Employee core

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Employee directory | `hr.ts` | complete | `employees` | `/hr/employees` CRUD | `hr-employees.tsx` | none |
| Employee create/edit | same | complete | same | POST/PATCH | `hr-employee-new.tsx`, `hr-employee-detail.tsx` | none |
| Import/export | `hr.ts` | complete | employees | import-template, preview, confirm, export, bulk | employees UI | none |
| Custom fields | `hr.ts` | complete | defs + values | `/hr/custom-fields`, per-employee | employee detail | none |
| Contracts | `hr.ts` | complete | `hr_employee_contracts` | nested under employee | employee detail | none |
| Documents | `hr.ts` | complete | `hr_employee_documents` | nested | employee detail | none |
| Position history | `hr.ts` | complete | `hr_employee_position_history` | nested | employee detail | none |
| Notes | `hr.ts` | complete | `hr_employee_notes` | nested | employee detail | none |
| Activity log | `hr.ts` | complete | `hr_employee_activity` | nested | employee detail | none |
| Employee numbering | `lib/employeeNumber.ts` | complete | counters + settings | implicit on create | — | none |

**Dependencies:** object storage for documents; optional `users` link.

---

## 4. Leave management (dual paths)

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Legacy employee leaves | `hr.ts` | partial | `hr_employee_leaves` | `/hr/employees/:id/leaves` | employee detail / attendance | none |
| Leave balances | `hr.ts` | complete | `hr_leave_balances` | `/hr/leave-balances`, `/hr/me/leave-balances` | HR admin + self-service | none |
| Structured leave requests | `leave.ts` | partial | `leave_requests`, `leave_approval_steps` | `/hr/leave-requests`, approve/reject/withdraw | `hr-me-leave.tsx`, self-service | none |
| Me leave submit | `hr.ts` | partial | balances + requests | `/hr/me/leave-requests` | self-service | none |
| Attendance-leaves bridge | `hr.ts` | partial | `hr_employee_leaves` | `/hr/attendance/leaves` | `hr-attendance.tsx` | none |

**Notes:** `leave_requests` **schema may not be migrated** — status **partial/unknown** at DB layer. Two parallel leave models active.

---

## 5. Attendance & overtime

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Shifts | `hr.ts` | complete | `hr_shifts` | `/hr/attendance/shifts` | `hr-attendance.tsx` | none |
| Work calendars | `hr.ts` | complete | `hr_work_calendars`, holidays | `/hr/attendance/calendars` | attendance | none |
| Attendance records | `hr.ts` | complete | `hr_attendance` | `/hr/attendance`, `/hr/me/attendance` | attendance | none |
| Attendance import | `hr.ts` | complete | hr_attendance | import/export/bulk | attendance | none |
| Overtime | `hr.ts` | complete | policies + records | `/hr/overtime/*` | attendance | none |

---

## 6. Payroll & compensation

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Salary components | `hr.ts` | complete | `hr_salary_components` | `/hr/payroll/components` | `hr-payroll.tsx` | none |
| Salary structures | `hr.ts` | complete | structures + join | `/hr/payroll/structures` | payroll | none |
| Salary bands | `hr.ts` | complete | `hr_salary_bands` | `/hr/payroll/bands` | payroll | none |
| Employee compensation | `hr.ts` | complete | compensations + items | `/hr/employees/:id/compensation` | employee/payroll | none |
| Payroll runs | `hr.ts` | complete | runs, payslips, lines | `/hr/payroll/runs`, process | `hr-payroll-run.tsx` | none |
| Employee payslips (self) | `hr.ts` | complete | payslips | `/hr/me/payslips` | `hr-me-payslips.tsx` | none |

**Status:** Substantial backend; UI present but depth unknown without UX review — rated **complete** for API+schema+pages existence.

---

## 7. HR services & self-service

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| Service categories | `hr.ts` | complete | `hr_service_categories` | `/hr/categories` | services admin | none |
| HR services catalog | `hr.ts` | complete | `hr_services` | `/hr/services`, `/self-service/services` | `hr-services.tsx`, admin | none |
| Service admin | `hr.ts` | complete | same | CRUD | `hr-services-admin.tsx`, `hr-services-admin-new.tsx` | none |
| Self-service portal | `self-service.tsx` | partial | forms + services | forms submit APIs | `/self-service` | none |

**Dependencies:** `form_definitions`, `workflows` for automation.

---

## 8. HR dashboard & reporting

| Module | Location | Status | DB | API | UI | Tests |
|--------|----------|--------|----|----|-----|-------|
| HR dashboard | `hr.ts` | partial | aggregates | `/hr/dashboard` | `hr-dashboard.tsx` | none |
| Reports permission | workspace-roles | placeholder | — | — | `reports.view` in matrix, no dedicated `/hr/reports` page found | none |

---

## 9. Cross-cutting integrations

| Module | Location | Status | Notes |
|--------|----------|--------|-------|
| Workflows | `routes/workflows.ts` | complete (platform) | HR services can trigger `workflow_event` |
| Forms | `routes/forms.ts` | complete | HR services link `form_id`; leave can reference submission |
| Approvals (general) | `routes/approvals.ts` | complete | Separate from leave_approval_steps |
| Permissions | `workspace-roles.ts` | partial | `hr.view`, `hr.manage`, `hr.services.manage`; dynamic `hr.services.{id}.*` |
| Governance (tenant) | `governance.ts` | unknown | Admin-only `/governance` routes |

---

## 10. Catalog-only modules (entitlement names, no HR implementation)

From `workspace-entitlement-catalog.ts` — **placeholder** relative to workspace HR code:

- recruitment, onboarding (beyond jsonb), performance, lms, succession, ai_automation (partial elsewhere)

---

## 11. Test coverage summary

| Area | Test files found |
|------|------------------|
| HR domain | **No dedicated `hr.test.ts` or `phase-hr*` tests** |
| Workspace quotas/entitlements | `workspace-quota-*.test.ts`, `workspace-entitlement-*.test.ts` (subscription layer, not HR logic) |
| Workflow context | `workflows/__tests__/context.test.ts` |

**Conclusion:** HR Foundation and employee modules are **largely untested** in automated suite.

---

## 12. Dependencies graph (simplified)

```
workspaces
  ├── workspace_module_settings → nav (hr, self-service)
  ├── users ←→ employees (optional user_id)
  ├── departments (legacy) ∥ hr_org_units (HR)
  └── hr_workspace_settings / counters
        └── employees
              ├── foundation FKs (org, title, grade, position, location)
              ├── contracts, documents, leaves, compensation
              └── leave_requests (if migrated) → approval_steps
hr_services → forms, workflows
```

---

**Confirmation:** Discovery only — no code changes.
