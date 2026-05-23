# Employee Model Audit (Phase 1)

**Scope:** Read-only discovery — no code, schema, API, or UI changes.  
**Date:** 2026-05-20  
**Repo:** `data-core-main/`

---

## Executive Summary

The platform runs **two parallel person models**:

1. **`users`** — login accounts (RBAC, workflows, tickets, legacy departments)
2. **`employees`** — HCM person records (optional link to user; no login required)

There is **no unified workforce identity**. “Member” is a **role string** on users (`admin` | `manager` | `member`), not a workforce entity. Organizational attachment uses **different fields and different org tables** depending on which model you touch.

**Only `fullName` is mandatory** when creating an employee. Department/org unit, manager, job title, and position are **all optional** at API and create-UI level — this is **dangerous flexibility** for enterprise HCM, though intentional for “HR record without full org setup.”

---

## 1. Entity Distinction

| Concept | Table / type | Purpose | Login? |
|---------|--------------|---------|--------|
| **User** | `users` | Workspace account, permissions, tickets, workflow triggers | Yes |
| **Employee** | `employees` | Canonical HR person; payroll, leave, attendance context | No (unless `userId` linked) |
| **Member** | `users.role = "member"` | Default RBAC tier | N/A |
| **Group member** | `group_members` | Collaboration groups — **not** workforce | Via user |
| **Identity overlap** | Both tables carry name, email, phone, employee number, free-text position | Duplication risk | — |

### Schema references

- Users: `lib/db/src/schema/users.ts`
- Employees + org: `lib/db/src/schema/hr.ts` (`employeesTable` L218+)
- Legacy departments: `lib/db/src/schema/departments.ts`
- User↔department M:N: `lib/db/src/schema/user_departments.ts`

### Linking model

```
users (workspace_id)
  ↑ optional 1:1
employees.user_id (unique FK, ON DELETE SET NULL)
```

- **Link/unlink:** `employee-account-service.ts` — sets `userId` only; **no sync** of manager, department, org unit, or position.
- **Provision shortcut:** `POST /hr/employees/provision` — only `fullName` required; may match email to existing user.

**Verdict:** Employee is the **intended HCM canonical person**; user is the **platform account**. They are **not** automatically kept in sync.

---

## 2. How Relationships Are Established

### 2.1 Create employee

| Path | Required | API |
|------|----------|-----|
| Full create | `fullName`; `employeeNumber` if manual numbering | `POST /hr/employees` (`hr.ts` L966) |
| Provision | `fullName` only | `POST /hr/employees/provision` |
| Import | `fullName`; number per numbering mode | `POST /hr/employees/import/*` |

**Defaults on insert:** `status=active`, `employmentType=full_time`; all org fields nullable.

### 2.2 Link to department / org unit

| Model | Field | Target |
|-------|-------|--------|
| **Employee (HCM)** | `employees.orgUnitId` | `hr_org_units.id` (tree: company→branch→division→department→team) |
| **User (legacy)** | `users.departmentId` + `user_departments` M:N | `departments.id` (flat list) |

**No automatic bridge** between `departments` and `hr_org_units`.

### 2.3 Link to manager

| Model | Field | Type |
|-------|-------|------|
| **Employee** | `employees.directManagerId` | Integer self-ref to `employees.id` — **no DB FK constraint** |
| **User** | `users.lineManagerId` | Integer — **no FK** — references another **user id**, not employee id |

### 2.4 Link to position / job

| Layer | Employee field | Notes |
|-------|----------------|-------|
| Job title catalog | `jobTitleId` → `hr_job_titles` | Optional |
| Job grade | `jobGradeId` → `hr_job_grades` | Optional |
| Position seat | `positionId` → `hr_positions` | **Schema only** — not set in POST/PATCH handlers observed |
| Free text | `position` | Fallback label |
| User directory | `users.position` | Separate copy on user row |

### 2.5 Link to administration / branch

| Field | Nature |
|-------|--------|
| `employees.company`, `branch`, `location` | **Free-text** metadata — not FK to org units |
| `employees.workLocationId` | FK → `hr_work_locations` — optional, not in create UI emphasis |
| Org unit `type=branch` | Structured branch in tree — separate from text `branch` field |

---

## 3. Required vs Optional (Enforcement)

### Employee create (`POST /hr/employees`)

| Field | Required? |
|-------|-----------|
| `fullName` | **YES** |
| `employeeNumber` | Conditional (manual/hybrid modes) |
| `orgUnitId` | **NO** |
| `directManagerId` | **NO** |
| `jobTitleId` / `jobGradeId` | **NO** |
| `position` / `positionId` | **NO** |
| `userId` | **NO** |
| Organization (org unit) | **NO** |

### User create (admin / users UI)

| Field | Required? |
|-------|-----------|
| `fullName` (OpenAPI) / first+last (admin route) | **YES** |
| `email` | OpenAPI yes; admin route optional |
| `departmentIds` | **NO** |
| `lineManagerId` | **NO** |
| `position` | **NO** |

### Can you create…?

| Scenario | Allowed? | Consequence |
|----------|----------|-------------|
| Employee without department/org unit | **YES** | Leave/attendance/reporting org context missing |
| Employee without manager | **YES** | Leave approver falls back to workspace admin |
| Employee without job title/position | **YES** | Roster incomplete; free-text `position` optional |
| Employee without operational unit | **YES** | No org enforcement |
| User without employee record | **YES** | Workflows use user manager; HR modules may not see person |
| Employee without user link | **YES** | Self-service attendance/leave (canonical) needs link for user-facing flows |

---

## 4. Logical vs Illogical vs Enterprise-Ready

### Logical (by design)

- Employee without login (contractors, pending onboarding) — common HR pattern
- Optional org at hire when data arrives later — **if** governance catches up before go-live
- Separate user for IT access vs HR record — valid with **explicit link + sync policy**

### Illogical / inconsistent

- Two org systems (`departments` vs `hr_org_units`) with no mapping
- Two manager fields (`lineManagerId` vs `directManagerId`) referencing different entity types
- `positionId` on employee schema with no application wiring
- Text `company`/`branch` alongside structured org tree
- User invite does not create/link employee automatically

### Enterprise-ready parts

- Rich employee schema (personal, employment, emergency, custom fields)
- Org unit tree with types and parentId
- Job grades/titles, position seats (foundation), position history table
- Employee numbering modes (auto/manual/hybrid)
- Import/export with org resolution by name
- Activity log on profile changes

### Dangerous flexibility

- **Zero mandatory org relationships** on employee create
- **No FK** on `directManagerId` / `lineManagerId` — orphan or invalid IDs possible
- **No validation** that manager is in same workspace or active
- **No cycle detection** on manager chain
- Link user↔employee without field sync breaks leave vs workflow approval paths
- Position history records movement **without updating** current employee org fields (audit-only)

---

## 5. Comparison Matrix

| Capability | Users | Employees |
|------------|-------|-----------|
| Primary dept | `departmentId` + M:N | `orgUnitId` |
| Manager | `lineManagerId` (user) | `directManagerId` (employee) |
| Org hierarchy | Flat departments | Nested `hr_org_units` |
| Used by workflows | **YES** (`lineManagerId`) | Indirect |
| Used by canonical leave | Only via `userId` link | **YES** (`directManagerId`) |
| Self-service attendance | N/A | Requires `userId` link |

---

## 6. Key Files

| Area | Path |
|------|------|
| Employee API | `artifacts/api-server/src/routes/hr.ts` |
| Account link | `artifacts/api-server/src/lib/hr/employee-account-service.ts` |
| Create UI | `artifacts/ops-platform/src/pages/hr-employee-new.tsx` |
| Detail UI | `artifacts/ops-platform/src/pages/hr-employee-detail.tsx` |
| Users UI | `artifacts/ops-platform/src/pages/users.tsx` |
| Prior risk report | `workspace-hr-duplication-conflict-risk-report.md` |

---

## 7. Phase 1 Verdict

| Question | Answer |
|----------|--------|
| Is this a workforce platform or user system? | **Hybrid — user system + parallel HR layer** |
| Is org structure enforced? | **No** |
| Is reporting structure real? | **Partial — stored if admins fill it; not mandatory** |
| Enterprise-ready employee model? | **Schema yes; governance no** |

---

*End of Phase 1 — Employee Model Audit.*
