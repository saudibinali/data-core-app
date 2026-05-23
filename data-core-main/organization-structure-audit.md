# Organizational Structure Audit (Phase 2)

**Scope:** Read-only analysis of departments, divisions, branches, teams, and hierarchy models.

---

## 1. Two Parallel Org Systems

The platform implements **duplicate organization concepts** with different consumers:

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  LEGACY: departments        │     │  HCM: hr_org_units          │
│  (flat list)                │     │  (tree via parentId)        │
├─────────────────────────────┤     ├─────────────────────────────┤
│  Schema: departments.ts     │     │  Schema: hr.ts L15-41       │
│  Attached to: users         │     │  Attached to: employees     │
│  Manager: departments.      │     │  Manager: NOT on unit row   │
│           managerId → user  │     │  (employee directManagerId) │
│  API: /departments          │     │  API: /hr/org-units         │
│  UI: departments.tsx        │     │  UI: hr-foundation.tsx      │
└─────────────────────────────┘     └─────────────────────────────┘
```

**Severity:** High — documented in `workspace-hr-duplication-conflict-risk-report.md`.

---

## 2. HCM Org Units (`hr_org_units`)

### 2.1 Schema

| Column | Purpose |
|--------|---------|
| `type` | `company` \| `branch` \| `division` \| `department` \| `team` |
| `name`, `nameAr`, `code` | Identity |
| `parentId` | Self-referential tree (**no declared FK** in Drizzle) |
| `color`, `displayOrder`, `isActive` | UI / ordering |

**Designed hierarchy:** company → branch → division → department → team (comment in schema).

### 2.2 API (`hr.ts`)

| Route | Required on create |
|-------|-------------------|
| `POST /hr/org-units` | **`name`** only |
| Optional | `type`, `parentId`, `nameAr`, `color`, `displayOrder` |

**PATCH** allows changing `parentId` with **no cycle validation**, **no orphan prevention**, **no “cannot attach to inactive parent”** checks observed in route handler.

### 2.3 Operational status

| Aspect | Status |
|--------|--------|
| CRUD | ✅ Operational |
| Nested hierarchy in DB | ✅ `parentId` supported |
| Visual org tree / chart | ❌ Not found in ops-platform |
| Used by employee roster | ✅ `orgUnitId` filter + display |
| Used by leave routing | ⚠️ Indirect (employee context) |
| Used by workflows | ❌ Uses legacy `departments` on users |
| Department head resolution | ❌ Not on org unit row |
| Matrix organization | ❌ Single `orgUnitId` per employee |

---

## 3. Legacy Departments (`departments`)

### 3.1 Schema

```typescript
// departments.ts — flat structure only
workspaceId, name, description, managerId (integer, no FK)
```

**No `parent_id`** — cannot represent hierarchy in this table.

### 3.2 User attachment

- Primary: `users.departmentId`
- Secondary M:N: `user_departments` with `isPrimary`, `departmentRole`
- User UI supports **multiple departments** with confirmation if >1

### 3.3 Department manager

- `departments.managerId` → intended as **user id**
- Used for department member counts / legacy UX — **not** leave approver chain

### 3.4 Operational status

| Aspect | Status |
|--------|--------|
| CRUD | ✅ `routes/departments.ts`, `departments.tsx` |
| Hierarchy | ❌ Flat only |
| Coexists with HR org | ⚠️ Confusing for admins |
| Product entitlements mention “hierarchy” | May refer to HR org, not this table |

---

## 4. Other Structure Entities

### 4.1 Work locations (`hr_work_locations`)

- Types: office, remote, hybrid, field
- Linked to `hr_positions` and optionally `employees.workLocationId`
- **Operational** in foundation; underused on employee UI

### 4.2 Position seats (`hr_positions`)

- Org-chart **seat**: title + org unit + grade + location + headcount
- Status: vacant \| filled \| frozen \| archived
- `currentOccupancy` — **not auto-updated** when employees assigned (no `positionId` wiring)

### 4.3 Teams

- Represented as `hr_org_units.type = "team"` — not a separate table
- No cross-cutting “project team” outside org tree

### 4.4 Business units / divisions

- Modeled as org unit **types**, not separate entities

---

## 5. Hierarchy Capabilities Checklist

| Capability | Present? | Operational? |
|------------|----------|--------------|
| Hierarchical departments (HCM) | ✅ `parentId` | ✅ API |
| Nested legacy departments | ❌ | — |
| Reporting chains (employee) | ✅ `directManagerId` | ⚠️ Optional |
| Org tree visualization | ❌ | — |
| Matrix org (dual reporting) | ❌ | — |
| Inheritance (policies down tree) | ❌ | — |
| Department ownership | ⚠️ Text + manager on legacy dept only | Partial |
| Org-based approval routing | ❌ | Workflows use user line manager |
| Department head approver | ❌ Type exists in workflows, not resolved |

---

## 6. How Structure Is Created & Maintained

### Create flow (HCM)

1. Admin → HR Foundation → Org Units tab (`hr-foundation.tsx`)
2. POST `/hr/org-units` with name + optional parent
3. Employees assigned via create employee or PATCH (API) — **not in detail UI edit**

### Create flow (legacy)

1. Admin → Departments page
2. POST `/departments` — name required
3. Users assigned in Users admin

### Inheritance

ADO propagation

**Not implemented.** Child org units do not inherit:
- Managers
- Policies
- Approval rules
- Visibility scopes

Each employee carries explicit `orgUnitId`; no “effective org path” computation at runtime beyond joins for display.

---

## 7. Metadata vs Operational

| Layer | Classification |
|-------|----------------|
| `hr_org_units` tree | **Operational** for employee assignment & reporting joins |
| `departments` | **Operational** for user directory & legacy modules |
| `hr_positions` | **Mostly metadata** — foundation CRUD without employee assignment |
| Text `company`/`branch` on employee | **Metadata** — duplicate of structured model |
| Org tab on employee detail | **Read-only display** — metadata if not maintained |

---

## 8. Unused / Incomplete

- Org chart page (marketing mentions in about docs, no ops CRUD chart)
- `employees.positionId` → positions table
- Sync between departments ↔ org units
- FK constraint on `hr_org_units.parentId`
- Tree integrity validation (cycles, depth limits)
- Org-unit-level manager field

---

## 9. Architectural Diagram (Intended vs Actual)

**Intended (schema comments):**
```
Company
 └── Branch
      └── Division
           └── Department
                └── Team
                      └── Employee (orgUnitId)
                      └── Position seat (optional)
```

**Actual consumption:**
```
hr_org_units ──► employees.orgUnitId     (HR modules)
departments  ──► users.departmentId      (users, tickets, legacy)
users.lineManagerId                      (workflows)
employees.directManagerId                (leave)
```

**Two trees + two manager models = structurally weak for enterprise.**

---

## 10. Phase 2 Verdict

| Question | Answer |
|----------|--------|
| Real org hierarchy? | **Yes in HCM table; not unified platform-wide** |
| Operational? | **Partial — HR roster yes; workflows/users no** |
| Enterprise org model? | **Incomplete — dual systems, no chart, no enforcement** |
| Matrix / inheritance / legacy dept? | **No / No / Flat only** |

---

*End of Phase 2 — Organizational Structure Audit.*
