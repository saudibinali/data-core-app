# Workspace / HR API Inventory Report

**Discovery date:** 2026-05-19  
**Primary files:** `artifacts/api-server/src/routes/hr.ts` (~130+ endpoints), `leave.ts`, `workspaces.ts`, `departments.ts`, `modules.ts`

All workspace-scoped routes filter by `req.workspaceId` unless noted. Auth: `requireAuth` on all listed routes.

**Permission shorthand:**

- `hr.view` / `hr.manage` — workspace RBAC
- `admin` — `requireWorkspaceAdmin` (role admin/super_admin)
- `dept.*` — dynamic department permissions
- `—` — auth only or role check inside handler

---

## A. Workspace shell APIs

| Method | Path | File | Purpose | Tables | Permission | R/W |
|--------|------|------|---------|--------|------------|-----|
| GET | `/workspaces/me` | workspaces.ts | Current workspace profile | workspaces | auth | R |
| PATCH | `/workspaces/me` | workspaces.ts | Update branding | workspaces | admin | M |
| GET | `/modules` | modules.ts | List modules + enabled flags | platform_modules, workspace_module_settings | auth | R |
| PATCH | `/modules/:key` | modules.ts | Toggle module | workspace_module_settings | admin | M |
| GET | `/departments` | departments.ts | List departments | departments | departments.view | R |
| POST | `/departments` | departments.ts | Create | departments | departments.create | M |
| GET | `/departments/:id` | departments.ts | Get one | departments | dynamic view | R |
| PATCH | `/departments/:id` | departments.ts | Update | departments | dynamic manage | M |
| DELETE | `/departments/:id` | departments.ts | Delete | departments | dynamic manage | M |

Super-admin workspace CRUD (`/workspaces`, `/workspaces/:id`, stats, users) — **platform scope**, excluded from client workspace app.

---

## B. HR settings & dashboard

| Method | Path | Permission | R/W | Tables |
|--------|------|------------|-----|--------|
| GET | `/hr/settings` | hr.view | R | hr_workspace_settings |
| PATCH | `/hr/settings` | admin | M | hr_workspace_settings |
| GET | `/hr/dashboard` | hr.view | R | employees, aggregates |

---

## C. Employees (core)

| Method | Path | Permission | R/W | Tables |
|--------|------|------------|-----|--------|
| GET | `/hr/employees` | hr.view | R | employees |
| GET | `/hr/employees/:id` | hr.view | R | employees + joins |
| POST | `/hr/employees` | admin | M | employees, counters |
| PATCH | `/hr/employees/:id` | hr.manage | M | employees |
| DELETE | `/hr/employees/:id` | admin | M | employees |
| GET | `/hr/employees/import-template` | hr.manage | R | — |
| POST | `/hr/employees/import/preview` | hr.manage | M | — |
| POST | `/hr/employees/import/confirm` | hr.manage | M | employees |
| GET | `/hr/employees/export` | hr.manage | R | employees |
| POST | `/hr/employees/bulk` | hr.manage | M | employees |

**Nested under `/hr/employees/:id`:**

| Sub-resource | Methods | Permission | Tables |
|--------------|---------|------------|--------|
| custom-fields | GET, PUT :fieldId | view / manage | hr_custom_field_* |
| contracts | GET, POST, PATCH, DELETE | view / manage / admin | hr_employee_contracts |
| documents | GET, POST, DELETE | view / manage / admin | hr_employee_documents |
| leaves (legacy) | GET, POST, PATCH | view / manage | hr_employee_leaves |
| position-history | GET, POST | view / manage | hr_employee_position_history |
| notes | GET, POST, DELETE | view / manage | hr_employee_notes |
| activity | GET | hr.view | hr_employee_activity |
| compensation | GET, POST (under :empId) | hr.manage / admin | hr_employee_compensations |

---

## D. Organization (HR)

| Resource | CRUD path prefix | Permission (read) | Tables |
|----------|------------------|-------------------|--------|
| Org units | `/hr/org-units` | hr.view / admin write | hr_org_units |
| Job grades | `/hr/job-grades` | hr.view / admin write | hr_job_grades |
| Job titles | `/hr/job-titles` | hr.view / admin write | hr_job_titles |
| Custom field defs | `/hr/custom-fields` | hr.view / admin write | hr_custom_field_defs |

---

## E. HR Foundation (`/hr/foundation/*`)

Each entity: GET list, POST, PATCH `:id`, DELETE `:id` — read `hr.view`, write `requireWorkspaceAdmin`.

| Path segment | Table |
|--------------|-------|
| `/statuses` | hr_employee_statuses |
| `/employment-types` | hr_employment_types |
| `/contract-types` | hr_contract_types |
| `/work-locations` | hr_work_locations |
| `/positions` | hr_positions |
| `/document-types` | hr_document_types |
| `/leave-policies` | hr_leave_policies |
| `/probation-policies` | hr_probation_policies |

| Method | Path | Notes |
|--------|------|-------|
| POST | `/hr/foundation/seed` | admin — seeds default foundation data |

---

## F. Payroll (`/hr/payroll/*`)

| Area | Paths | Read perm | Write |
|------|-------|-----------|-------|
| Components | `/hr/payroll/components` | hr.manage | admin |
| Structures | `/hr/payroll/structures`, `.../components` | hr.manage | admin |
| Bands | `/hr/payroll/bands` | hr.manage | admin |
| Runs | `/hr/payroll/runs`, `.../process` | hr.manage | admin |
| Payslips | `/hr/payroll/runs/:runId/payslips` | hr.manage | — |
| Me payslips | `/hr/me/payslips`, `.../:id` | auth (self) | R |

**Tables:** hr_salary_*, hr_payroll_runs, hr_payslips, hr_payslip_lines, hr_employee_compensations*

---

## G. Attendance & overtime

| Prefix | Entities | Permission | Tables |
|--------|----------|------------|--------|
| `/hr/attendance/shifts` | CRUD | manage / admin | hr_shifts |
| `/hr/attendance/calendars` | CRUD + holidays | manage / admin | hr_work_calendars, hr_calendar_holidays |
| `/hr/attendance` | list, create, patch, delete | hr.manage | hr_attendance |
| `/hr/me/attendance` | self | auth | hr_attendance |
| `/hr/attendance/import-*`, export, bulk | import pipeline | hr.manage | hr_attendance |
| `/hr/attendance/leaves` | list legacy leaves | hr.manage | hr_employee_leaves |
| `/hr/overtime/policies` | CRUD | hr.manage | hr_overtime_policies |
| `/hr/overtime/records` | CRUD + calculate | hr.manage | hr_overtime_records |

---

## H. Leave balances & requests

| Method | Path | File | Permission | Tables | Notes |
|--------|------|------|------------|--------|-------|
| GET/POST/PATCH | `/hr/leave-balances` | hr.ts | manage / admin | hr_leave_balances | |
| POST | `/hr/leave-balances/bulk-init` | hr.ts | admin | hr_leave_balances | |
| GET | `/hr/me/leave-balances` | hr.ts | auth | hr_leave_balances | self-service |
| POST | `/hr/me/leave-requests` | hr.ts | auth | leave_requests? | **DB migration risk** |
| POST | `/hr/leave-requests` | leave.ts | auth | leave_requests | structured workflow |
| GET | `/hr/leave-requests` | leave.ts | auth | leave_requests | |
| GET | `/hr/leave-requests/:id` | leave.ts | auth | leave_requests | |
| PATCH | `/hr/leave-requests/:id/approve` | leave.ts | auth | leave_requests, steps | |
| PATCH | `/hr/leave-requests/:id/reject` | leave.ts | auth | same | |
| PATCH | `/hr/leave-requests/:id/withdraw` | leave.ts | auth | same | |

---

## I. HR services & self-service

| Method | Path | Permission | Tables |
|--------|------|------------|--------|
| GET/POST/PATCH/DELETE | `/hr/categories` | auth / admin | hr_service_categories |
| GET/POST/PATCH/DELETE | `/hr/services` | hr.view / admin | hr_services |
| GET | `/hr/services/:id` | hr.view | hr_services |
| GET | `/self-service/services` | auth | hr_services (filtered) |

**Scope:** workspace + HR; integrates `form_definitions`, workflows.

---

## J. Workspace roles & permissions (HR-related)

| Method | Path | File | Purpose |
|--------|------|------|---------|
| GET | `/permissions` | workspace-roles.ts | Static + dynamic permission registry |
| CRUD | `/workspace-roles/*` | workspace-roles.ts | Custom roles |

**HR permission keys in static matrix:**

- `hr.view`, `hr.manage`, `hr.services.manage`
- Dynamic: `hr.services.{serviceId}.view|submit|manage`

**Not in static matrix but used in App.tsx:** `self_service.view`

---

## K. Route count summary

| File | Approx. endpoints |
|------|-------------------|
| `hr.ts` | ~130 |
| `leave.ts` | 6 |
| `workspaces.ts` (client-relevant) | 2 |
| `departments.ts` | 5 |
| `modules.ts` | 2 |
| **Total inventoried** | **~145** |

---

## L. Scope classification

| Scope | Paths |
|-------|-------|
| **workspace** | `/workspaces/me`, `/modules`, `/departments` |
| **HR** | `/hr/*`, `/self-service/services` |
| **HR public** | none (all require auth) |
| **unknown / mixed** | leave approve may check manager chain in handler |

---

**Confirmation:** Read-only discovery; no APIs added or modified.
