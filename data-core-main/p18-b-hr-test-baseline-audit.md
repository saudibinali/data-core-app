# P18-B — HR Test Baseline Audit

**Date:** 2026-05-19  
**Method:** Grep/glob across `artifacts/api-server/src/**/*.test.ts`, `artifacts/ops-platform/src/**/*.test.ts`, `scripts/phase-*.test.ts`.  
**No tests written or modified.**

---

## 1. HR-specific tests found

| File | HR relevance | What it covers |
|------|--------------|----------------|
| `artifacts/api-server/src/routes/workspace-entitlement.test.ts` | **Indirect** | P16 workspace subscriptions, entitlements, quota — not employee/leave/payroll |
| `artifacts/api-server/src/routes/workspace-entitlement-quota.test.ts` | **Indirect** | Quota enforcement |
| `artifacts/api-server/src/routes/workspace-entitlement-quota-usage.test.ts` | **Indirect** | Usage metering |
| `artifacts/api-server/src/routes/workspace-entitlement-quota-usage-2.test.ts` | **Indirect** | Usage edge cases |
| `artifacts/api-server/src/routes/workspace-entitlement-quota-usage-3.test.ts` | **Indirect** | Usage edge cases |
| `artifacts/api-server/src/routes/workflow.test.ts` | **Indirect** | Workflow engine — may touch HR service automation paths |
| `artifacts/api-server/src/routes/workflow-approvals.test.ts` | **Indirect** | Generic approvals — not leave_requests |
| `artifacts/api-server/src/routes/workflow-approvals-2.test.ts` | **Indirect** | Same |
| `artifacts/api-server/src/routes/workflow-approvals-3.test.ts` | **Indirect** | Same |

**Not found:**

- `hr.test.ts`, `leave.test.ts`, `phase-hr*.test.ts`
- Any test importing `routes/hr.ts` or `routes/leave.ts` directly
- Ops-platform component tests for HR pages

**Approximate HR domain coverage:** **~0%** of `hr.ts` / `leave.ts` route surface (estimated **0 of ~170+** HR-related HTTP handlers).

---

## 2. Coverage by domain

| Domain | Routes (approx) | Dedicated tests | Coverage |
|--------|-----------------|-----------------|----------|
| Foundation (org, grades, titles, catalogs) | ~40+ in hr.ts | None | **0%** |
| Employee CRUD + import/export | ~15 | None | **0%** |
| Leave (legacy + canonical) | ~10 hr + 6 leave.ts | None | **0%** |
| Payroll runs / payslips | ~15 | None | **0%** |
| Attendance / overtime | ~20 | None | **0%** |
| HR services / self-service catalog | ~10 | None | **0%** |
| Permissions (hr.view, hr.manage) | All routes | None dedicated | **0%** |
| Workspace subscription (HR module gate) | P16 routes | **Partial** | ~60% of entitlement layer only |

---

## 3. High-risk APIs without tests

| Endpoint / behavior | Risk |
|---------------------|------|
| `POST /hr/payroll/runs/:id/process` | Computes payslips for all active employees — financial impact |
| `DELETE /hr/employees/:id` | Hard delete employee |
| `POST /hr/employees/import/confirm` | Bulk upsert |
| `POST /hr/me/leave-requests` | Self-service leave (legacy table) |
| `POST /hr/leave-requests` (leave.ts) | Balance reservation + transactions |
| `PATCH /hr/attendance/leaves/:id` | Legacy approve |
| Payroll run `DELETE` / status transitions | Data loss |
| `GET /hr/me/payslips` | PII exposure if scope wrong |
| `GET /hr/employees/export` | Bulk PII export |

---

## 4. Modules without tests (complete list for HR)

- `artifacts/api-server/src/routes/hr.ts` (entire file)
- `artifacts/api-server/src/routes/leave.ts` (entire file)
- All `artifacts/ops-platform/src/pages/hr-*.tsx`
- `hr-me-leave.tsx`, `self-service.tsx` (HR sections)
- `lib/db/src/schema/hr.ts` (no schema contract tests)

---

## 5. Minimal baseline required before refactor (proposal only)

Implement in a future **P18-C — HR Baseline Tests Implementation** phase (not now):

### 5.1 Foundation smoke (5–8 tests)

- `GET /hr/org-units` — workspace isolation (wrong workspace → empty/403)
- `POST /hr/org-units` + `PATCH` — happy path
- Catalog: `GET /hr/foundation/employee-statuses` returns seeded defaults after workspace seed

### 5.2 Employee tests (8–12 tests)

- `POST /hr/employees` — create with required fields
- `GET /hr/employees/:id` — 404 cross-workspace
- `PATCH /hr/employees/:id` — update status
- `DELETE /hr/employees/:id` — requires admin (expect 403 for member)
- Import preview — one valid row, one invalid status

### 5.3 Leave tests (6–10 tests)

- **After** leave tables migrated: `POST /hr/leave-requests` — balance decrements
- `POST /hr/leave-requests` — conflict same dates → 409
- Legacy: `POST /hr/me/leave-requests` — documents current behavior until deprecated
- `GET /hr/me/leave-balances` — employee sees own only

### 5.4 Payroll smoke (4–6 tests)

- Create draft run → `POST .../process` → payslip count matches compensated employees
- Non-admin cannot process run
- `GET /hr/me/payslips` — only own employee

### 5.5 Attendance smoke (3–5 tests)

- `POST /hr/attendance/records` — workspace scoped
- Import preview one row

### 5.6 Permission smoke (5–8 tests)

- `hr.manage` required for `GET /hr/employees` (member → 403)
- `requireAuth`-only routes: document expected behavior for `/hr/categories`, `/hr/me/payslips` (see permission audit)
- `self_service.view` — route registry test once permission exists

**Estimated minimal suite:** **~35–45 tests** to establish a refactor safety net.

---

## 6. Test infrastructure notes

- API tests use existing pattern: `scripts/phase-*.test.ts` or colocated `*.test.ts` with test DB helpers.
- HR routes need workspace + employee fixture (user linked to `employees.user_id`).
- `leave.ts` tests **require** migration for `leave_requests` before they can run in CI.

---

## 7. Verdict

| Question | Answer |
|----------|--------|
| Safe to refactor `hr.ts` without new tests? | **No** |
| Safe to switch leave canonical without tests? | **No** |
| Existing tests sufficient? | **No** |

---

**Confirmation:** No tests added. Audit only.
