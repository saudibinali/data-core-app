# P18-A — Do Not Duplicate List

**Phase:** P18-A  
**Date:** 2026-05-19  
**Authority:** Architecture consolidation decisions — **mandatory for all implementers** until superseded by a later ADR.

If a need appears to conflict with this list, **stop** and update the ADR in a decision phase — do not add parallel assets in application code.

---

## Tables and data models

- Do **not** create a new **`employees`** table (e.g. `workspace_employees`, `hr_people`, `staff`).
- Do **not** create a new **`departments`** table for HR org (HR must use **`hr_org_units`**).
- Do **not** create **`org_units_v2`**, **`hr_organization_v2`**, or any second org hierarchy table.
- Do **not** create **`leave_requests_v2`** or a third leave table set.
- Do **not** create new **payroll** table families (duplicate runs, payslips, salary components).
- Do **not** create new **attendance** table families (duplicate attendance/shift/calendar tables).
- Do **not** create a **`users`** alternative for workspace members (e.g. `workspace_accounts` for the same purpose).
- Do **not** create a new **`workspaces`** or **`tenants`** table for HR isolation.
- Do **not** add **`tenant_id`** columns to HR tables when **`workspace_id`** already defines scope.

---

## APIs and backends

- Do **not** add **new leave APIs** on **`hr_employee_leaves`** (legacy maintenance only).
- Do **not** expose **`leave_requests`** in production until migration drift is cleared (P18-B).
- Do **not** add **new HR org CRUD** on **`/departments`** for employee/org placement.
- Do **not** create parallel **`/hr/v2/*`** route trees duplicating existing resources.
- Do **not** split **`hr.ts`** in P18-A (refactor is a later, planned phase with tests).

---

## Frontend and product surfaces

- Do **not** create a **parallel self-service** app or route tree outside **`/self-service`** + **`hr_services`** + forms.
- Do **not** create a second **employee directory** page unrelated to **`/hr/employees`**.
- Do **not** create a second **org admin** UI on departments for HR operators (use Foundation / **`hr_org_units`**).
- Do **not** build **recruitment**, **LMS**, **performance**, or **Finance** modules in this consolidation window.

---

## Permissions and security

- Do **not** create a **new permission system** for workspace/HR (no parallel matrix, no copy of platform P17 overrides).
- Do **not** redesign the **role matrix** or add HR fine-grained permissions until canonical models are stable.
- Do **not** “fix” **`self_service.view`** in P18-A (recorded as known issue only).

---

## Person and account flows

- Do **not** store **employee master data** primarily on **`users`**.
- Do **not** auto-create **`users`** from employee create without an approved **provisioning flow** document.
- Do **not** auto-create **`employees`** from user invite without an approved **HR onboarding flow** document.

---

## ERP / domain expansion

- Do **not** introduce a **new tenant/workspace model** per domain (Finance, Inventory, etc.).
- Do **not** add **legal entity** or **cost center** tables until org consolidation plan exists (backlog).
- Do **not** implement **entitlement catalog modules** that have no tables (recruitment, LMS, performance) as if they were complete domains.

---

## What to do instead

| Need | Use |
|------|-----|
| New HR employee data | Extend **`employees`** + related canonical tables |
| Org structure | **`hr_org_units`** |
| Leave (after P18-B) | **`leave_requests`** |
| Pay / time | Existing **`hr_payroll_*`**, **`hr_attendance_*`** |
| Employee requests | **`hr_services`** + **forms** + **workflows** |
| Access control | Existing **workspace roles** + `hr.view` / `hr.manage` until permissions phase |

---

**Confirmation:** List is normative for planning and implementation gates after P18-A; no code changed in this phase.
