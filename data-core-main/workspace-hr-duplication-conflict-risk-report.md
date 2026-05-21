# Duplication / Conflict Risk Report

**Discovery date:** 2026-05-19

---

## 1. Duplicate or overlapping tables

| Risk | Tables / concepts | Severity | Notes |
|------|-------------------|----------|-------|
| **Dual organization** | `departments` vs `hr_org_units` | **High** | Same business concept (org structure); departments tied to **users**, org units to **employees**. Different UIs (`/departments` vs Foundation). |
| **Dual leave** | `hr_employee_leaves` vs `leave_requests` + `leave_approval_steps` | **High** | Both have APIs; structured leave **not in base migration**. |
| **Employee vs user profile** | `employees` vs `users` | **Medium** | Overlapping name, email, phone, department; optional `user_id` link easy to desync. |
| **Employee status** | `employees.status` (text) vs `hr_employee_statuses` (lookup) | **Medium** | Foundation configures statuses; employee row may not FK to lookup. |
| **Position vs job title** | `hr_positions` vs `hr_job_titles` + `employees.position` text | **Low–Medium** | Intentional hierarchy but free-text `position` undermines model. |
| **Contract type** | `hr_employee_contracts.contract_type` text vs `hr_contract_types` lookup | **Medium** | Parallel enum strings vs configurable types. |
| **Leave balance** | `employees.leave_balances` jsonb vs `hr_leave_balances` table | **Medium** | Two storage strategies. |

---

## 2. Duplicate or overlapping modules

| Module A | Module B | Risk |
|----------|----------|------|
| Departments (legacy) | HR org units | Admin configures org twice; reporting lines unclear |
| User management (`/users`) | Employee records (`/hr/employees`) | Inviting user ≠ creating employee |
| General approvals | Leave approval steps | Different systems for “approval” |
| Self-service forms | HR services | Overlap in request submission UX |
| Entitlement catalog (recruitment, LMS, …) | Actual HR code | Product/marketing ahead of implementation |

---

## 3. Duplicate or overlapping APIs

| Pattern | Examples |
|---------|----------|
| Two leave create paths | POST `/hr/employees/:id/leaves` vs POST `/hr/leave-requests` vs POST `/hr/me/leave-requests` |
| Org CRUD twice | `/departments` vs `/hr/org-units` |
| Foundation vs top-level org | `/hr/org-units` vs `/hr/foundation/*` (positions only under foundation prefix) |
| Monolithic file | All HR in single `hr.ts` — hard to see boundaries, risk of copy-paste handlers |

---

## 4. Duplicate frontend surfaces

| UI | Conflict |
|----|----------|
| `/departments` vs Foundation “org units” | Operators may not know which is canonical |
| `users.tsx` vs `hr-employees.tsx` | Two directories of “people” |
| Leave in employee detail vs `/self-service/leave` vs attendance leaves | Three entry points |
| `/hr` dashboard vs `/dashboard` | Two “home” analytics concepts |

---

## 5. Naming conflicts

| Term | Meanings in codebase |
|------|---------------------|
| **Workspace** | `workspaces` table, JWT `workspaceId`, commercial “tenant” |
| **Tenant** | Same ID as workspace in platform routes |
| **Employee** | `employees` HR record |
| **User** | `users` login account |
| **Department** | `departments` table OR `hr_org_units.type=department` |
| **Position** | `hr_positions` seat OR `employees.position` string OR job title |
| **Leave** | `hr_employee_leaves`, `leave_requests`, or jsonb on employee |
| **Status** | workspace / user / employee / contract / leave / position all use `status` text |

---

## 6. workspace vs tenant vs employee vs user vs organization

```
tenantId (API param) ──equals── workspace.id
        │
        ├── users (workspace_id) ──optional──► employees.user_id
        │
        ├── departments (legacy org for users)
        │
        └── hr_org_units (HR org for employees)
                 └── employees (HR canonical person)
```

**Conflict:** Reporting line on employee (`direct_manager_id` → employees) vs `users.lineManagerId` / department manager — may diverge.

---

## 7. Where to EXTEND (do not rebuild)

| Asset | Reason |
|-------|--------|
| `hr_org_units` + Foundation UI | Rich tree model already seeded |
| `employees` + detail page | Broad nested APIs already wired |
| `hr_*` foundation lookups | Configurable per workspace |
| `leave_requests` schema + `leave.ts` | Correct direction for workflow leave — **migrate DB first** |
| `hr_payroll_*` tables + routes | Large investment; extend don't duplicate |
| `workspace_module_settings` | Module gating works |
| `workspace-roles` permission registry | Extend with HR-specific keys (`self_service.view`) |

---

## 8. Where NOT to touch (without migration plan)

| Asset | Reason |
|-------|--------|
| `departments` / `user_departments` | Used by tickets, users, permissions (`departments.{id}.*`); removing breaks RBAC |
| `users` auth columns | Platform/workspace auth boundary |
| `0000_sad_midnight.sql` baseline | Single migration; additive migrations only |
| Monolithic `hr.ts` | High blast radius — refactor only with tests |

---

## 9. Schema drift risks

| Table | Issue |
|-------|-------|
| `leave_requests`, `leave_approval_steps` | In Drizzle schema, **absent from** `0000_sad_midnight.sql` |
| Phase 16 workspace tables | May also be schema-only vs applied DB |

**Action before redesign:** Run `drizzle-kit introspect` or migration diff on target environment — **do not assume** all schema files are deployed.

---

## 10. Permission matrix gaps

- `self_service.view` used in routing but missing from `STATIC_PERMISSION_GROUPS`
- `hr.services.{id}.*` dynamic permissions — ensure UI assigns them on custom roles
- No fine-grained HR permissions (e.g. payroll-only, attendance-only) — only `hr.view` / `hr.manage`

---

**Confirmation:** Discovery only.
