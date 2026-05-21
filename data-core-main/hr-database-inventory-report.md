# HR Database Inventory Report

**Discovery date:** 2026-05-19  
**Sources:** `lib/db/src/schema/hr.ts`, `departments.ts`, `workspaces.ts`, `modules.ts`, `users.ts`, `user_departments.ts`, `lib/db/drizzle/0000_sad_midnight.sql`

**Legend — completeness:**

- **Complete:** table in Drizzle schema + present in `0000_sad_midnight.sql`
- **Schema only:** in Drizzle, **missing from** `0000_sad_midnight.sql` (migration drift)
- **Partial:** implemented but overlapping another table
- **Placeholder:** catalog/reference only, no dedicated table

---

## Summary counts

| Category | Tables |
|----------|--------|
| HR core (`hr.ts`) | 38 table definitions |
| Workspace shell (HR-related) | 4 (`workspaces`, `workspace_module_settings`, `hr_workspace_*`) |
| Legacy org (parallel) | 3 (`departments`, `user_departments`, links via `users`) |
| **Total inventoried** | **45** |

**tenantId:** None of these tables use `tenant_id`; all use `workspace_id` where scoped.

---

## Workspace shell tables

### `workspaces`

| Field | Value |
|-------|-------|
| **Purpose** | Root tenant / organization container |
| **PK** | `id` serial |
| **workspaceId** | N/A (is the workspace) |
| **tenantId** | No |
| **FKs** | None |
| **Indexes** | `slug` UNIQUE |
| **Enums** | `status`: active (default), API: suspended, disabled |
| **Completeness** | Complete |

### `workspace_module_settings`

| Field | Value |
|-------|-------|
| **Purpose** | Enable/disable nav modules per workspace |
| **PK** | `id` serial |
| **workspaceId** | Yes, NOT NULL, FK → workspaces CASCADE |
| **FKs** | workspaces |
| **Indexes** | UNIQUE (`workspace_id`, `module_key`) |
| **Completeness** | Complete |

### `hr_workspace_settings`

| Field | Value |
|-------|-------|
| **Purpose** | HR employee numbering configuration |
| **PK** | `workspace_id` (PK) |
| **workspaceId** | Yes |
| **Columns** | `numbering_mode` (auto\|manual\|hybrid), `numbering_start_from`, `updated_at` |
| **Completeness** | Complete |

### `hr_workspace_counters`

| Field | Value |
|-------|-------|
| **Purpose** | Atomic counters per workspace (e.g. employee number) |
| **PK** | Composite (`workspace_id`, `counter_name`) |
| **workspaceId** | Yes |
| **Columns** | `current_value` (default 1000), `updated_at` |
| **Completeness** | Complete |

---

## Legacy organization (parallel to HR)

### `departments`

| Field | Value |
|-------|-------|
| **Purpose** | Flat department list for **users** module (not HR org tree) |
| **PK** | `id` |
| **workspaceId** | Yes NOT NULL |
| **Columns** | `name`, `description`, `manager_id` (no FK in schema) |
| **Relations** | `user_departments`, `users.department_id` |
| **Completeness** | Complete — **duplicates concept** of `hr_org_units` type=department |

### `user_departments`

| Field | Value |
|-------|-------|
| **Purpose** | Many-to-many users ↔ departments |
| **PK** | `id` |
| **workspaceId** | No (via user/department) |
| **Columns** | `user_id`, `department_id`, `is_primary`, `department_role` |
| **Completeness** | Complete |

---

## Organization structure (HR Foundation)

### `hr_org_units`

| Field | Value |
|-------|-------|
| **Purpose** | Hierarchical org: company → branch → division → department → team |
| **PK** | `id` |
| **workspaceId** | Yes |
| **Columns** | `type`, `name`, `name_ar`, `code`, `parent_id` (self-ref), `color`, `display_order`, `is_active` |
| **Indexes** | workspace, parent, type |
| **Enums (text)** | `type`: company \| branch \| division \| department \| team |
| **Completeness** | Complete |
| **Notes** | No separate `legal_entities` or `cost_centers` tables — use org unit types or free text on employee |

### `hr_job_grades`

| Field | Value |
|-------|-------|
| **Purpose** | Pay/grade bands (G1–G12 style) |
| **PK** | `id` |
| **workspaceId** | Yes |
| **Columns** | `name`, `name_ar`, `code`, `level`, `description`, `display_order` |
| **Completeness** | Complete |

### `hr_job_titles`

| Field | Value |
|-------|-------|
| **Purpose** | Job title catalog |
| **PK** | `id` |
| **workspaceId** | Yes |
| **FKs** | `grade_id` → hr_job_grades |
| **Completeness** | Complete |

### `hr_work_locations`

| Field | Value |
|-------|-------|
| **Purpose** | Office / remote / hybrid / field locations |
| **PK** | `id` |
| **workspaceId** | Yes |
| **Enums** | `type`: office \| remote \| hybrid \| field |
| **Completeness** | Complete |

### `hr_positions`

| Field | Value |
|-------|-------|
| **Purpose** | Headcount seats (title + org unit + location), distinct from job title |
| **PK** | `id` |
| **workspaceId** | Yes |
| **FKs** | job_title, org_unit, job_grade, work_location |
| **Enums** | `status`: vacant \| filled \| frozen \| archived |
| **Columns** | `headcount`, `current_occupancy` |
| **Completeness** | Complete |

---

## Employee core

### `employees`

| Field | Value |
|-------|-------|
| **Purpose** | Canonical HR person record (may exist without login) |
| **PK** | `id` |
| **workspaceId** | Yes NOT NULL |
| **tenantId** | No |
| **FKs** | `user_id` → users (optional unique); org_unit, job_title, job_grade, position, work_location; `direct_manager_id` self-ref |
| **Indexes** | workspace, user, org_unit, status, manager; UNIQUE (workspace_id, employee_number) |
| **Status enum (text)** | active \| on_leave \| suspended \| terminated \| resigned |
| **Employment type (text)** | full_time \| part_time \| contractor \| intern \| temporary |
| **Personal** | nationality, gender, DOB, marital_status, address, national_id, passport |
| **Employment** | hire_date, end_date, probation_end_date |
| **Org (denormalized)** | `position` text fallback, `company`, `branch`, `location` free text |
| **JSON** | `leave_balances`, `onboarding_data` |
| **Completeness** | Complete — **partial overlap** with `users` profile fields |
| **Notes** | `status` text may not sync with `hr_employee_statuses` lookup |

### `hr_custom_field_defs` / `hr_custom_field_values`

| Field | Value |
|-------|-------|
| **Purpose** | Metadata-driven extra employee fields |
| **workspaceId** | defs: yes; values: via employee |
| **Sections** | personal \| employment \| org \| emergency \| custom |
| **Field types** | text, number, date, dropdown, multi_select, boolean, attachment, linked |
| **Completeness** | Complete |

### `hr_employee_activity`

| Field | Value |
|-------|-------|
| **Purpose** | Per-employee audit trail |
| **workspaceId** | Yes |
| **Columns** | `action`, `description`, `changes` jsonb, `performed_by` |
| **Completeness** | Complete |

### `hr_employee_notes`

| Field | Value |
|-------|-------|
| **Purpose** | HR notes on employee |
| **workspaceId** | Yes |
| **Enums** | note_type: general \| performance \| disciplinary \| commendation \| confidential |
| **Completeness** | Complete |

### `hr_employee_position_history`

| Field | Value |
|-------|-------|
| **Purpose** | Job movement / transfer history |
| **workspaceId** | Yes |
| **Enums** | change_type: promotion \| transfer \| demotion \| lateral \| title_change \| dept_change \| other |
| **Completeness** | Complete |

---

## Foundation lookup tables (configurable per workspace)

| Table | Purpose | workspaceId | Unique per WS | Completeness |
|-------|---------|-------------|---------------|--------------|
| `hr_employee_statuses` | Dynamic employee lifecycle statuses | Yes | `code` | Complete |
| `hr_employment_types` | Employment type catalog | Yes | `code` | Complete |
| `hr_contract_types` | Contract type catalog | Yes | `code` | Complete |
| `hr_document_types` | Document type catalog | Yes | — | Complete |
| `hr_leave_policies` | Leave rules (days, accrual, approval) | Yes | — | Complete |
| `hr_probation_policies` | Probation duration rules | Yes | — | Complete |

---

## Employment records

### `hr_employee_contracts`

| Purpose | Employment contracts per employee |
| workspaceId | Yes |
| FKs | employee, created_by → users |
| Enums | contract_type: permanent \| fixed_term \| probation \| freelance \| part_time; status: draft \| active \| expired \| terminated |
| Columns | dates, salary text, currency, attachments jsonb |
| Completeness | Complete |

### `hr_employee_documents`

| Purpose | Official documents (ID, passport, etc.) |
| workspaceId | Yes |
| Enums | document_type: national_id \| passport \| iqama \| driving_license \| certificate \| other |
| Storage | `object_path`, file metadata |
| Completeness | Complete |

---

## Leave domain (dual implementation)

### `hr_employee_leaves`

| Purpose | **Legacy/simple** leave records on employee |
| workspaceId | Yes |
| Enums | leave_type: annual \| sick \| emergency \| maternity \| paternity \| unpaid \| other; status: pending \| approved \| rejected \| cancelled |
| Completeness | Complete |
| Notes | **Overlaps** `leave_requests`; still used by HR routes |

### `hr_leave_balances`

| Purpose | Per-employee leave balance buckets |
| workspaceId | Yes |
| FKs | employee, optional leave_policy |
| Completeness | Complete |

### `leave_requests` ⚠️

| Purpose | **Structured** leave lifecycle (Phase 1 leave domain) |
| workspaceId | Yes |
| FKs | employee, requested_by_user, leave_policy, approvers |
| Enums | status: pending \| pending_approval \| approved \| rejected \| withdrawn \| cancelled |
| Columns | `days_requested`, `business_days_count`, `request_number`, form source FKs |
| Completeness | **Schema only** — **NOT in `0000_sad_midnight.sql`** |
| Notes | APIs in `leave.ts`; migration drift risk |

### `leave_approval_steps` ⚠️

| Purpose | Multi-step approval chain for leave_requests |
| workspaceId | No (via leave_request) |
| Completeness | **Schema only** — **NOT in migration** |

---

## Attendance & time

| Table | Purpose | workspaceId | Completeness |
|-------|---------|-------------|--------------|
| `hr_shifts` | Shift definitions | Yes | Complete |
| `hr_work_calendars` | Work week patterns | Yes | Complete |
| `hr_calendar_holidays` | Holidays per calendar | Via calendar | Complete |
| `hr_attendance` | Daily attendance records | Yes | Complete |
| `hr_overtime_policies` | OT rules | Yes | Complete |
| `hr_overtime_records` | OT entries | Yes | Complete |

---

## Payroll & compensation

| Table | Purpose | workspaceId | Completeness |
|-------|---------|-------------|--------------|
| `hr_salary_components` | Pay component definitions | Yes | Complete |
| `hr_salary_structures` | Salary structure templates | Yes | Complete |
| `hr_salary_structure_components` | Structure ↔ component join | Via structure | Complete |
| `hr_salary_bands` | Min/max bands per grade | Yes | Complete |
| `hr_employee_compensations` | Employee comp packages | Yes | Complete |
| `hr_employee_compensation_items` | Line items per package | Via compensation | Complete |
| `hr_payroll_runs` | Payroll run batches | Yes | Complete |
| `hr_payslips` | Payslips per run/employee | Yes | Complete |
| `hr_payslip_lines` | Payslip line items | Via payslip | Complete |

---

## HR services & catalog

| Table | Purpose | workspaceId | Completeness |
|-------|---------|-------------|--------------|
| `hr_services` | HR service catalog (forms/workflows) | Yes | Complete |
| `hr_service_categories` | Service grouping | Yes | Complete |

Links: `form_id` → form_definitions, optional `workflow_event`.

---

## Concepts requested but NOT found as tables

| Concept | Finding |
|---------|---------|
| **Legal entities** | No `hr_legal_entities`; commercial `legal_entity_name` on `commercial_accounts` only |
| **Cost centers** | No dedicated table |
| **Divisions / branches** | Modeled as `hr_org_units.type`, not separate tables |
| **Recruitment** | Entitlement catalog only — no HR tables |
| **Onboarding** | `employees.onboarding_data` jsonb only |
| **Performance** | Note types only — no review cycles table |
| **Learning (LMS)** | Entitlement catalog only |
| **Succession** | Entitlement catalog only |

---

## Related non-HR tables (workspace-scoped, HR integrations)

| Table | HR relationship |
|-------|-----------------|
| `users` | Optional login; `employees.user_id` |
| `form_definitions` / `form_submissions` | HR services, leave request source |
| `workflow_definitions` | HR service automation |
| `approvals` | General approvals module (separate from leave approval steps) |

---

**Confirmation:** Discovery only — no schema or migration changes made.
