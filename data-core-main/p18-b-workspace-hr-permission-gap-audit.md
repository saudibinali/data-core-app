# P18-B — Workspace / HR Permission Gap Audit

**Date:** 2026-05-19  
**Sources:** `workspace-roles.ts`, `hr.ts`, `leave.ts`, `ops-platform/src/App.tsx`, `lib/permissions` / static registry (if present).  
**No permissions added. No role matrix changes.**

---

## 1. Current HR permission keys (workspace roles)

From `artifacts/api-server/src/routes/workspace-roles.ts` (HR module group):

| Key | Label | Typical use |
|-----|-------|-------------|
| `hr.view` | View HR module | Read-only HR (intended) |
| `hr.manage` | Manage employee profiles | Admin HR operations |
| `hr.services.manage` | Manage HR services catalog | Service builder |

**Missing from registry (known gap):**

| Key | Referenced by | Status |
|-----|---------------|--------|
| `self_service.view` | `App.tsx` `ProtectedRoute` for `/self-service` | **Frontend expects; backend registry does not define** |

---

## 2. Backend route protection patterns

### 2.1 `requirePermission("hr.manage")`

Used on majority of admin HR routes (employees list, mutations, foundation admin, payroll admin, attendance admin, etc.).

### 2.2 `requirePermission("hr.view")`

**Rare or absent** on hr.ts — most read endpoints use `hr.manage` instead.  
**Gap:** No true read-only HR role at API layer.

### 2.3 `requireWorkspaceAdmin`

Used for:

- `POST /hr/payroll/runs/:id/process` — **financial operation**
- Some settings / destructive operations

**Gap:** Admin bypasses `hr.manage` — workspace owner can run payroll without explicit HR permission.

### 2.4 `requireAuth` only (no permission)

| Route (examples) | Exposure |
|------------------|----------|
| `GET /hr/categories` | Any authenticated workspace member |
| `GET /self-service/services` | Filtered by role in handler — **custom logic** |
| `GET /hr/me/payslips` | Any user with linked employee |
| `GET /hr/me/attendance` | Same |
| `GET /hr/me/leave-balances` | Same |
| `POST /hr/me/leave-requests` | **Any authenticated user** can create legacy leave row |
| `GET /hr/dashboard` | **Auth only** — may leak aggregates |

**Severity:** Medium–High for payroll/leave self-service; intentional for employee portal but **no `self_service.view` check on API**.

### 2.5 `leave.ts`

- Uses `requireAuth` + **in-handler** workspace/employee/approver checks
- Does **not** use `hr.manage` for HR-wide list — uses role detection in handler
- Finer than hr.ts but **not aligned** with static permission registry

---

## 3. Frontend route guards (`App.tsx`)

| Path | Guard |
|------|-------|
| `/self-service` | `self_service.view` |
| `/self-service/leave` | **No `requiredPermission`** — only `moduleKey="hr"` (weaker than parent hub) |
| `/hr`, `/hr/employees`, payroll, attendance | `hr.manage` |
| `/hr/me/*` (payslips, leave, attendance) | Typically **employee layout** — may be weaker guard |

**Gap:** Frontend references `self_service.view` but permission may not exist in role editor → users cannot assign it consistently.

**Gap:** All HR admin pages behind single `hr.manage` — no payroll-only or attendance-only UI roles.

---

## 4. Coarse permissions

| Issue | Impact |
|-------|--------|
| Single `hr.manage` for employees + payroll + attendance + foundation | Over-privilege |
| No `hr.payroll.run`, `hr.payroll.view`, `hr.attendance.manage` | Cannot delegate safely |
| `hr.view` unused at API | Read-only HR role non-functional |
| Workspace admin ⊃ all HR mutations | Owner can process payroll without HR training |

---

## 5. Duplicated permission logic

| Location | Pattern |
|----------|---------|
| `hr.ts` | Repeated `requirePermission("hr.manage")` per route |
| `GET /self-service/services` | Manual role name / permission checks inside handler |
| `leave.ts` | Custom approver + employee scope |
| Ops `ProtectedRoute` | Duplicates backend intent (can drift) |

---

## 6. Dangerous access scenarios

| Scenario | Risk level | Notes |
|----------|------------|-------|
| Member calls `POST /hr/me/leave-requests` without self_service permission | **Medium** | Creates legacy leave |
| Member with employee link reads payslips via `/hr/me/payslips` | **Low–Medium** | Expected for ESS; wrong link = wrong data if scope bug |
| Workspace admin runs payroll process | **High** | Financial |
| `hr.manage` holder exports all employees | **High** | PII bulk export |
| No permission on `GET /hr/dashboard` | **Medium** | Aggregate leakage |
| Canonical `GET /hr/leave-requests` lists all workspace requests for HR role | **Medium** | Depends on handler role detection |

---

## 7. Future granularity needs (document only — do not implement)

Suggested keys for a later phase (not P18-B):

- `self_service.view` — register in workspace-roles
- `hr.payroll.view`, `hr.payroll.manage`, `hr.payroll.process`
- `hr.attendance.view`, `hr.attendance.manage`
- `hr.leave.approve`, `hr.leave.manage`
- `hr.foundation.manage`
- `hr.employee.export`

---

## 8. Gap summary

| ID | Gap | Severity |
|----|-----|----------|
| P1 | `self_service.view` missing from registry | **High** (UI/backend drift) |
| P2 | `hr.view` not enforced on read APIs | **Medium** |
| P3 | Self-service APIs auth-only | **Medium** |
| P4 | Payroll process = workspace admin | **High** |
| P5 | Single `hr.manage` coarse grain | **Medium** |
| P6 | leave.ts vs hr.ts permission model mismatch | **Medium** |
| P7 | `/self-service/leave` missing `self_service.view` guard | **Medium** |

---

## 9. Risks if refactor proceeds without permission design

- Split files may copy inconsistent guards
- New routes might inherit `requireAuth` only by mistake
- Frontend `ProtectedRoute` will not match new backend splits

**Recommendation:** Fix **registry gap (P1)** and document **ESS auth-only contract** before granular permissions redesign (explicitly deferred per P18-A).

---

**Confirmation:** No permissions added. No role matrix modified.
