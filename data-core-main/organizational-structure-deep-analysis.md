# Organizational Structure — Deep Analysis (Phase 2)

**Scope:** `hr_org_units` and related structural models in HR Foundation context.

---

## 1. Supported Structure Types

### Schema design (`hr.ts` L9–41)

Documented hierarchy: **company → branch → division → department → team**

| Type | In schema comment | In Foundation UI select | Notes |
|------|-------------------|-------------------------|-------|
| Company | ✅ | ✅ | Root org node |
| Branch | ✅ | ❌ **Missing in UI** | Can only be set via API if type string accepted |
| Division | ✅ | ✅ | |
| Department | ✅ | ✅ | |
| Team | ✅ | ✅ | |
| Unit | ❌ | ✅ **Extra in UI** | UI adds `unit` not in schema header comment |
| Business unit | ❌ | ❌ | No dedicated type |
| Matrix structure | ❌ | ❌ | Single `orgUnitId` per employee |

### Legacy parallel: `departments`

- Flat table — **no hierarchy**
- Used by **users**, not Foundation UI
- Competes with org units for admin attention

---

## 2. Hierarchy Mechanics

### 2.1 Parent/child

- `hr_org_units.parentId` — self-referential integer (**no Drizzle FK declared**)
- Foundation UI: parent select from flat list (`ouOpts`) — **no tree visualization**
- POST/PATCH `/hr/org-units` — **no cycle detection**, no max depth, no "child type must be below parent type" rules

### 2.2 Org tree

| Capability | Status |
|------------|--------|
| Store tree in DB | ✅ |
| Render org chart | ❌ |
| Traverse tree at runtime | ❌ (no approval/org service) |
| Effective org path (breadcrumbs) | ⚠️ Display name join only |
| Inherit policies down tree | ❌ |

### 2.3 Reporting relationships

**Not stored on org unit row.** Reporting is **employee-level** via `directManagerId`, separate from org tree.

There is **no** "manager of department" field on `hr_org_units` (contrast: legacy `departments.managerId` → user).

---

## 3. Operational vs Metadata

| Aspect | Classification |
|--------|----------------|
| Admin CRUD org units | ✅ Operational |
| Assign employee to unit | ✅ Operational (`orgUnitId`) |
| Filter employee list by unit | ✅ Operational |
| Approval routing by unit | ❌ Metadata only |
| Permission inheritance by unit | ❌ Not implemented |
| Headcount by unit | ⚠️ Count via employee join — no enforced budget |
| Position seats per unit | ⚠️ Config on `hr_positions.orgUnitId` — seats not filled |

**Verdict:** **Partially operational** — assignment and reporting joins work; **organizational intelligence does not**.

---

## 4. Binding Model

### Employee → structure

```
employees.orgUnitId → hr_org_units.id (optional FK)
employees.directManagerId → employees.id (optional, no FK)
employees.positionId → hr_positions.id (unused in application)
```

### Position seat → structure

```
hr_positions.orgUnitId → hr_org_units.id
hr_positions.jobTitleId, jobGradeId, workLocationId
status: vacant | filled | frozen | archived
headcount, currentOccupancy (manual — not auto from assignments)
```

### Manager → structure

- **No link** between manager and org unit at unit level
- Department manager concept exists only on **legacy** `departments.managerId`

---

## 5. Inheritance & Routing

| Concern | Implemented? |
|---------|--------------|
| Policy inheritance (leave, probation) down org tree | ❌ |
| Approval routing to unit head | ❌ |
| Workflow `department_head` approver | ❌ (type exists, resolver missing) |
| Visibility scope by org subtree | ❌ |
| Delegation by org | ❌ |

Leave approver: `employees.directManagerId` → linked user — **ignores org tree entirely**.

---

## 6. Multi-Level Hierarchy Support

**Technical:** Yes — unlimited depth via `parentId` chain.

**Practical enterprise features missing:**

- Matrix reporting (dual orgUnitId)
- Dotted-line manager
- Regional branch rollups with automated approver escalation
- Cross-functional team membership outside tree

---

## 7. Foundation UI — Org Units Tab

**Location:** `hr-foundation.tsx` → "Org Units / Departments"

**Strengths:**
- Bilingual names, type badge, parent selector, active flag
- Describes hierarchy in card description

**Weaknesses:**
- Flat list — admin cannot see tree shape
- Missing `branch` type in UI despite schema intent
- Label mixes "Org Units" and "Departments" — reinforces dual-model confusion with `/departments` page
- No employee count per unit in list
- No validation feedback on invalid parent chains

---

## 8. Comparison: Intended vs Actual

```
INTENDED (schema comment):
  company → branch → division → department → team

UI OFFERS:
  company → division → department → team → unit

RUNTIME CONSUMES:
  employees.orgUnitId (single node, optional)
  + directManagerId (orthogonal graph)

PLATFORM LEGACY ALSO USES:
  departments (flat) on users
```

---

## 9. Phase 2 Verdict

| Question | Answer |
|----------|--------|
| Hierarchical? | **Yes in data model** |
| Org tree real? | **Stored, not visualized or traversed** |
| Operational runtime? | **Partial — employee placement only** |
| Enterprise org intelligence? | **No** |

---

*End of Phase 2 — Organizational Structure Deep Analysis.*
