# P18-B — Workspace / HR Data Ownership Audit

**Date:** 2026-05-19  
**Rule (P18-A):** HR business data is **`workspace_id` scoped**; platform tables are global.

---

## 1. Workspace-scoped tables (HR)

All tables in `lib/db/src/schema/hr.ts` include `workspace_id` (NOT NULL) except none — **full HR schema is workspace-scoped.**

Includes:

- `employees`, all `hr_*` tables, `leave_requests`, `leave_approval_steps`
- Legacy `hr_employee_leaves`, `hr_leave_balances`

**Safe boundary:** Queries must always filter `workspace_id = req.workspaceId` from auth context.

---

## 2. Platform / global tables (not workspace-owned)

| Table / area | Scope | HR interaction |
|--------------|-------|----------------|
| `users` | Global identity | Linked via `employees.user_id` |
| `platform_user_*` (P17) | Platform | No direct HR row |
| `tenants` | Legacy commercial | **Risk:** some code paths still use `tenantId` |
| `tenant_subscriptions` | Tenant-scoped commercial | Not workspace_id |
| `workspaces` | Container | Parent of HR data |
| `workspace_members`, `workspace_roles` | Per workspace | Access control |

---

## 3. APIs using `tenantId` vs `workspace_id`

| Pattern | Where | Risk |
|---------|-------|------|
| `req.workspaceId` from auth | **hr.ts**, **leave.ts** (primary) | **Safe** when middleware sets correctly |
| `tenantId` in commercial / subscription routes | P14/P16 routes | **Unclear** if HR module gating mixes tenant + workspace |
| `workspace_subscriptions` (P16) | `workspace_id` | **Safe** — aligned with P18-A |
| `tenant_subscriptions` | `tenant_id` | **Risky** if same org has multiple workspaces under one tenant |

**Finding:** HR routes reviewed use **`workspaceId`** on inserts and `where` clauses for HR tables. No systematic `tenantId` filter on `employees` in hr.ts.

**Residual risk:** Joins from HR to `users` without workspace check on user row — mitigated if `employees.workspace_id` enforced and employee resolved within workspace first.

---

## 4. Inconsistent ownership / dual models

| Item | Issue | Severity |
|------|-------|----------|
| `departments` vs `hr_org_units` | Both workspace-scoped; employees may reference `department_id` **and** `org_unit_id` | **Medium** — duplicate org truth |
| `employees.leave_balances` jsonb | Denormalized cache vs `hr_leave_balances` table | **Low** — same workspace |
| `tenant_subscriptions` vs `workspace_subscriptions` | Two subscription models | **Medium** — wrong gate for HR module |
| Platform user on `users` without workspace | Login outside workspace context | **Low** for HR if routes require workspace |

---

## 5. Potential data leakage vectors

| Vector | Condition | Severity |
|--------|-----------|----------|
| Missing `workspace_id` in `where` | IDOR on `:id` routes | **Critical** if present |
| `GET /hr/employees/:id` | Uses `and(eq(id), eq(workspaceId))` pattern (standard) | **Low** if consistent |
| Export endpoints | Large result sets — must filter workspace | **High** if bug |
| `leave.ts` list for HR | Must not return other workspace requests | **Medium** — verify handler |
| Self-service `/hr/me/*` | Must resolve employee by `user_id` **within** workspace | **High** if user linked to wrong workspace employee |
| Cross-workspace user membership | User in workspace A requests with workspace B context | Middleware should block | **Medium** |

---

## 6. Dangerous joins

| Join | Risk |
|------|------|
| `employees` ⋈ `users` without workspace on both sides | User from another tenant visible |
| `hr_employee_leaves` ⋈ `employees` | Safe if both filtered by same `workspace_id` |
| Payroll run ⋈ employees | Safe if `hr_payroll_runs.workspace_id` matches |
| HR ⋈ `tenant_subscriptions` | **Risky** — wrong commercial scope |

**Audit sample:** hr.ts consistently uses `eq(table.workspaceId, workspaceId)` on mutations reviewed — **no systematic leakage pattern found in static review**, but **not proven by tests**.

---

## 7. Ownership classification

| Boundary | Classification |
|----------|----------------|
| All `hr_*` + `employees` + leave canonical | **Safe** (designed workspace-scoped) |
| `users` / platform tables | **Safe** (global by design) |
| `tenant_*` commercial vs `workspace_*` P16 | **Risky** — dual model |
| `departments` legacy + `hr_org_units` | **Unclear** — which is authoritative (P18-A: org_units canonical) |
| Self-service employee resolution | **Risky** without integration tests |

---

## 8. Recommendations (audit only)

1. Enforce **single subscription source** per workspace for module gating (P16 `workspace_subscriptions`).
2. Migrate employee `department_id` references to `org_unit_id` over time (data, not audit).
3. Add tests for cross-workspace IDOR on employees, payslips, leave (P18-C tests phase).
4. Document: **`tenantId` must not appear in new HR queries.**

---

**Confirmation:** No data modified. No API changes.
