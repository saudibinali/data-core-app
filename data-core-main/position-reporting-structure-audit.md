# Position & Reporting Structure Audit (Phase 3)

**Scope:** Job positions, grades, reporting lines, manager resolution, delegation, escalation paths.

---

## 1. Position Model Layers

The codebase defines **four overlapping “position” concepts**:

| Layer | Table / field | Meaning | Wired to people? |
|-------|---------------|---------|------------------|
| **Job grade** | `hr_job_grades` | Band/level (G1–G12) | ✅ `employees.jobGradeId` |
| **Job title** | `hr_job_titles` | Catalog title; optional `gradeId` | ✅ `employees.jobTitleId` |
| **Position seat** | `hr_positions` | Org-chart seat (title + unit + grade + location + headcount) | ❌ `employees.positionId` unused in API/UI |
| **Free text** | `employees.position`, `users.position` | Display string | ✅ Optional fallback |

**API:** Position seats CRUD at `POST /hr/foundation/positions` (`hr.ts` L2101+).  
**Foundation UI:** `hr-foundation.tsx` Positions tab.

**Headcount:** `currentOccupancy` on seat — **not updated** when employees assigned.

---

## 2. Reporting Structure Fields

### 2.1 Direct manager (HCM)

| Attribute | Detail |
|-----------|--------|
| Field | `employees.directManagerId` |
| Target | Another `employees.id` (self-ref) |
| DB FK | **Not declared** in Drizzle schema |
| UI create | Optional select in `hr-employee-new.tsx` |
| UI edit | **Not in** `hr-employee-detail.tsx` edit forms (org tab read-only) |
| API PATCH | Allowed via `PATCH /hr/employees/:id` |

### 2.2 Line manager (platform user)

| Attribute | Detail |
|-----------|--------|
| Field | `users.lineManagerId` |
| Target | Another `users.id` |
| DB FK | **Not declared** |
| UI | `users.tsx` edit/create |
| Used by | Workflow approval/notification steps |

### 2.3 Legacy department manager

| Attribute | Detail |
|-----------|--------|
| Field | `departments.managerId` |
| Target | User id (implicit) |
| Used by | Department admin UX — **not** canonical leave |

---

## 3. How the System Resolves “Who Is Manager?”

### 3.1 Canonical leave (`leave.ts`)

**Function:** `findApproverForEmployee()` L212–260

**Priority:**
1. `employees.directManagerId` → load manager employee → require `userId` + `status=active` → approver = that **user**
2. Else first workspace `admin` / `super_admin` (excluding requester)
3. `resolveApproverWithFallback()` may assign **any admin** or even **requester** as last resort

**Not used:** `users.lineManagerId`, `departments.managerId`, org unit manager, department_head workflow type.

### 3.2 Workflow approval step (`steps/approval.ts`)

**`approverType=manager`:**
- Reads **`users.lineManagerId`** for trigger user id (or `employeeId` in trigger data as user id)
- **Does not** walk `employees.directManagerId`

### 3.3 Workflow notification step

Same **`lineManagerId`** pattern on users table.

### 3.4 Department head

- Declared in `workflows/types.ts` as `approverType: "department_head"`
- **Not implemented** in `steps/approval.ts` resolver

---

## 4. Extended Roles (HR Manager, Division Head, etc.)

| Role | Explicit model? | Resolution |
|------|-----------------|------------|
| Direct manager | ✅ `directManagerId` | Leave only (with user link) |
| Line manager (user) | ✅ `lineManagerId` | Workflows only |
| Department manager | ⚠️ `departments.managerId` | Legacy dept UI |
| HR Manager | ❌ | Fallback to workspace admin role |
| Division / branch head | ❌ | Would require org traversal — not implemented |
| Acting manager | ❌ | Not in schema |
| Alternate approver | ❌ | Not in schema |
| Delegation (OOO) | ❌ | Mentioned in `core-approvals` types only |

---

## 5. Escalation Path

| Domain | Escalation behavior |
|--------|---------------------|
| Leave | Single-step Phase 1; fallback admin; no multi-level chain auto-build from org tree |
| Leave approval steps table | Supports multi-step **if populated** — Phase 2+ features partially present |
| Workflows | `onTimeout: escalate` — **simulation only** |
| Position history | Audit record only — no automatic escalation |

**No computed escalation path** from org hierarchy (e.g. skip-level to division head).

---

## 6. Job Movements & Reporting Changes

### Table: `hr_employee_position_history`

Types: promotion, transfer, demotion, lateral, title_change, dept_change, other.

**API:** `GET/POST /hr/employees/:id/position-history`

**Critical behavior:** POST **only inserts history row** — does **not** update `employees.orgUnitId`, `jobTitleId`, `directManagerId`, etc.

**UI:** Job Movements tab on employee detail — displays history.

**Verdict:** Reporting changes are **journal entries**, not live structure updates unless admin separately PATCHes employee.

---

## 7. Runtime-Aware vs Hardcoded

| Mechanism | Runtime-aware? | Notes |
|-----------|----------------|-------|
| Leave approver | ✅ DB lookup | Falls back hard to admin role |
| Workflow manager approver | ⚠️ Partial | User table only |
| Org tree walk for approver | ❌ | Not implemented |
| Role-based approver | ✅ | Workflow step config |
| Job grade in approval rules | ❌ | Not used in approval resolution |
| Position seat occupancy | ❌ | Schema only |

**Hardcoded relations:**
- Workspace admin / super_admin as universal fallback
- Role strings `"admin"`, `"super_admin"`, `"manager"`, `"member"`

---

## 8. Approval Hierarchy Truth Table

| Claimed capability | Real for leave? | Real for workflows? |
|--------------------|-----------------|---------------------|
| Direct manager approval | ✅ If manager has userId | ❌ Uses lineManagerId instead |
| Multi-level sequential | ⚠️ If steps seeded | ❌ Single pause per approval step type |
| Department head | ❌ | ❌ (type only) |
| Delegation | ❌ | ❌ |
| Acting manager | ❌ | ❌ |
| Escalation on timeout | ❌ | ❌ (config fiction) |

**Approval hierarchy is real only where explicitly coded per domain — not unified.**

---

## 9. Position Hierarchy (Grades)

- `hr_job_grades.level` — numeric ordering for display/sort potential
- `hr_job_titles.gradeId` — optional link title → grade
- **No approval routing by grade level** observed
- **No compensation band enforcement** tied to grade in this audit scope

---

## 10. Risks

1. **Split manager fields** — leave and workflows disagree on source of truth.
2. **Manager without login** — direct manager employee without `userId` breaks leave step 1.
3. **Silent fallback to admin** — masks missing org setup.
4. **Position seat model unused** — admins may configure seats that never attach to people.
5. **History vs current state drift** — transfers recorded but employee row unchanged.

---

## 11. Phase 3 Verdict

| Question | Answer |
|----------|--------|
| Reporting structure real? | **Stored optionally; not enforced; split across user/employee** |
| Position hierarchy real? | **Catalog yes; seat assignment no** |
| Runtime-aware hierarchy? | **Leave partial; workflows use different field** |
| Enterprise reporting lines? | **No — missing delegation, acting, escalation, dept head** |

---

*End of Phase 3 — Position & Reporting Structure Audit.*
