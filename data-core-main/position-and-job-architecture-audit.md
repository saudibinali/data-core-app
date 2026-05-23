# Position & Job Architecture Audit (Phase 3)

**Scope:** Job Title vs Position vs Role vs Grade vs Employment Type — entity truth and wiring.

---

## 1. Terminology Map

| Term in product | Storage | Meaning in codebase |
|-----------------|---------|---------------------|
| **Job Title** | `hr_job_titles` | Catalog label ("Software Engineer") |
| **Job Grade** | `hr_job_grades` | Level band (G5, Senior band) with optional numeric `level` |
| **Position (seat)** | `hr_positions` | Org-chart **seat**: title + unit + grade + location + headcount |
| **Position (free text)** | `employees.position`, `users.position` | Display fallback string |
| **Role** | `users.role` | Platform RBAC: `admin` \| `manager` \| `member` — **not HR job role** |
| **Employment Type** | `employees.employmentType` text + `hr_employment_types` lookup | full_time, contractor, etc. |

**Critical confusion:** "Position" means three different things; "Role" means platform permission tier, not job.

---

## 2. Is Position Entity Real?

### Position seat (`hr_positions`)

**Schema:** Full entity with relations to job title, org unit, grade, work location, status, headcount, occupancy.

**Foundation UI:** Full CRUD with rich form (links to title, unit, grade, location).

**Employee assignment:** `employees.positionId` FK exists — **never set** in `POST/PATCH /hr/employees` or employee UI.

**Occupancy:** `currentOccupancy` / `headcount` — **not auto-updated** when employees hired or moved.

**Verdict:** Position seat is a **real table and admin config entity**, but **not a runtime workforce assignment entity**. Currently **metadata / planning only**.

### Job title on employee

**Real and used:** `employees.jobTitleId` → selected at create, shown on detail, PATCH allowed, import resolves by name.

### Free-text position

**Real but weak:** Used when no title catalog match; undermines structured job architecture.

---

## 3. Position Linkage Checklist

| Link | Position seat | Employee job title |
|------|---------------|-------------------|
| To department/org unit | ✅ `orgUnitId` on seat | ✅ via employee `orgUnitId` (independent) |
| To manager | ❌ | ❌ (manager on employee, not title) |
| To org structure tree | ✅ seat points to one unit | ⚠️ employee points to one unit |
| To approval chain | ❌ | ❌ |
| To salary grade policy | ⚠️ grade FK on seat | ⚠️ `jobGradeId` on employee |
| To workflow routing | ❌ | ❌ |

---

## 4. Enterprise Position Capabilities

| Capability | Supported? |
|------------|------------|
| **Vacant positions** | ✅ `status=vacant` on seat row |
| **Filled positions** | ⚠️ Manual status only — no employee link |
| **Reporting positions** | ❌ No "reports to position" on seat |
| **Acting positions** | ❌ |
| **Multiple incumbents** | ⚠️ `headcount` > 1 on seat; no incumbents table |
| **Position hierarchy** | ❌ No parent position / reports-to seat |
| **Employee occupies seat** | ❌ Not wired |

---

## 5. Employee: Occupies Position vs Department-Only?

**Current state:** Employee is **primarily linked to org unit + job title + optional grade**, with optional free-text `position`.

**Does NOT occupy a Position seat** in application logic.

```
Actual model:
  Employee ──► orgUnitId (department/team node)
           ──► jobTitleId (catalog)
           ──► jobGradeId (catalog)
           ──► directManagerId (person chain)

Intended but unwired model:
  Employee ──► positionId ──► hr_positions (seat in org chart)
```

---

## 6. Job Title ↔ Grade Relationship

- `hr_job_titles.gradeId` optional FK to grade
- Employee carries separate `jobTitleId` and `jobGradeId` — **can diverge** from title's default grade
- No validation that employee grade matches title grade

---

## 7. Employment Type Architecture

**Two layers:**

1. **Foundation lookup** `hr_employment_types` — seeded codes: full_time, part_time, contractor, intern, temporary
2. **Employee column** `employees.employmentType` — text, default `full_time`

**Import validation:** Hardcoded `validEmploymentTypes` set in import preview — must align with seeded codes manually.

**No FK** from employee to `hr_employment_types.id`.

**Runtime:** Employment type does **not** gate leave policies, probation policies, or approval chains in audited routes.

---

## 8. Role vs Job (Platform vs HR)

| | HR job | Platform role |
|---|--------|---------------|
| Field | jobTitleId, position | users.role, customRoleId |
| Used for | Display, roster | Permissions, workflow admin |
| Foundation UI | Job titles tab | Users admin (separate) |

Workflow approver by **role** uses `users.role` string — not HR job title or grade.

---

## 9. Phase 3 Verdict

| Question | Answer |
|----------|--------|
| Position entity real? | **Table yes; workforce assignment no** |
| Job architecture enterprise-grade? | **Catalog layer yes; seat/incumbent model no** |
| Employee occupies position? | **No — department/title model only** |

---

*End of Phase 3 — Position & Job Architecture Audit.*
