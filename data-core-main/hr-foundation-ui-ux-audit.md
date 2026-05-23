# HR Foundation UI/UX Audit (Phase 6)

**Scope:** `artifacts/ops-platform/src/pages/hr-foundation.tsx` — "البيانات الأساسية للموارد البشرية".

---

## 1. Page Structure

**Title (AR):** البيانات الأساسية للموارد البشرية  
**Title (EN):** HR Foundation Data  
**Tagline:** "Fully metadata-driven" / "لا قيم ثابتة، كل شيء قابل للتهيئة"

**Admin action:** "Seed Defaults" → `POST /hr/foundation/seed`

### Tabs (11)

| Tab ID | Label (EN) | Icon |
|--------|------------|------|
| statuses | Employee Statuses | UserCheck |
| employment-types | Employment Types | Briefcase |
| contract-types | Contract Types | FileText |
| work-locations | Work Locations | MapPin |
| positions | Positions | Shield |
| doc-types | Document Types | FileText |
| leave-policies | Leave Policies | Calendar |
| probation | Probation Policies | Calendar |
| org-units | Org Units / Departments | Building2 |
| job-grades | Job Grades | Star |
| job-titles | Job Titles | Tags |

**Pattern:** Reusable `SimpleEntityCard` — list + dialog CRUD + auto-code preview.

---

## 2. Is the Segmentation Logical?

### Strengths

- Clear separation of **taxonomy** (grades, titles) vs **policy** (leave, probation) vs **structure** (org, positions)
- Bilingual labels throughout
- Seed button lowers cold-start friction
- Position tab description correctly distinguishes seat vs job title
- Leave policy form exposes operational flags (`requiresApproval`, `paid`, `carryOver`)

### Weaknesses

| Issue | Detail |
|-------|--------|
| **Org + job not under `/foundation/` API** | Same page but split backend — confusing for integrators |
| **Org tab title** | "Org Units / Departments" blurs HCM vs legacy departments page |
| **Probation not seeded** | Tab exists but empty until manual entry — feels incomplete vs other tabs |
| **No custom fields tab** | Custom field defs live elsewhere — foundation incomplete as "all master data" |
| **No salary components** | Payroll foundation separate — not linked from this page |
| **No workspace settings** | Leave runtime mode / numbering not here |

**Verdict:** **Mostly logical** for HR admin mental model; **not exhaustive** for full HCM foundation.

---

## 3. Terminology Correctness

| Term in UI | Correct? | Issue |
|------------|----------|-------|
| Job Title | ✅ | Matches `hr_job_titles` |
| Job Grade | ✅ | Matches `hr_job_grades` |
| Position | ⚠️ | Correct for **seat** — but employee UI also uses "position" as free text |
| Org Unit / Department | ⚠️ | Conflates two platform concepts |
| Employment Type | ✅ | Lookup catalog |
| Contract Type | ⚠️ | Catalog not bound to contract records |
| Document Type | ⚠️ | Catalog not bound to uploaded docs |
| Employee Status | ⚠️ | Catalog not bound to `employees.status` FK |
| Role | ❌ **Not in Foundation** | Platform `users.role` elsewhere — good, but workflows say "role" for approvers |

---

## 4. Confusion Matrix (Position / Title / Role / Dept)

| User thinks… | Foundation tab | Employee runtime | Users module |
|--------------|----------------|------------------|--------------|
| Department | org-units | orgUnitId | departmentIds (legacy) |
| Job title | job-titles | jobTitleId | position text field |
| Position (seat) | positions | **not linked** | — |
| Position (label) | — | position text | position text |
| Role (HR) | — | — | — |
| Role (access) | — | — | users.role |

**Highest confusion:** **Position** (3 meanings) and **Department** (2 systems).

---

## 5. Over-Simplified Areas

| Area | Simplification | Enterprise gap |
|------|----------------|----------------|
| Org units | Flat list + parent dropdown | No tree, no branch type in UI |
| Positions | Manual vacant/filled status | No incumbent picker |
| Leave policies | Single form per policy | No org-specific policy assignment |
| Probation | Name + duration only | No assignment to employment type or grade |
| Job grades | Level number optional | No salary band linkage in UI |
| Document types | Required flag | No enforcement on employee upload |

---

## 6. Dangerous Flexibility in Foundation Context

1. **Seed creates codes** that employee/contract rows may never FK-reference — admin believes system is "configured" while runtime uses free text
2. **Inactive lookup rows** — no guard preventing employee import with deprecated employment type codes
3. **Delete org unit / title** — possible while employees still reference FK (SET NULL on delete — silent orphan)
4. **Leave policy `requiresApproval=false`** — bypasses manager chain entirely regardless of org
5. **allowSelfService on status lookup** — not wired to employee status text validation
6. **Position headcount** — can show 0/5 filled with no actual workforce link — misleading ops view

---

## 7. Missing UX Elements

- Org chart visualization
- "Employees in this unit" count on org row
- Validation: cannot delete unit with children or assigned employees
- Link from position seat to assigned employee(s)
- Preview: "Which leave policy applies to this employee?"
- Warning when Foundation seed not run (empty workspace)
- In-app doc: canonical vs legacy departments
- Sync indicator: employee.status vs foundation status codes

---

## 8. HR Operations Consistency

| Foundation config | Employee detail UI | Consistent? |
|-------------------|-------------------|-------------|
| Org unit | Read-only org tab; editable only at create | ❌ |
| Job title/grade | Same | ❌ |
| Leave policies | Leaves tab uses canonical API | ⚠️ |
| Contract types | Contracts tab uses free-text type | ❌ |
| Document types | Documents tab uses free-text type | ❌ |
| Statuses | Hardcoded select in detail edit | ❌ |

**Foundation admin work does not fully propagate** to employee lifecycle UI.

---

## 9. Positive UX Patterns

- Auto-code generation with `CodePreview` — reduces admin typing errors
- Color dots on statuses/types — good visual scanning
- Wrapped tab list — works on smaller screens
- Arabic/English parity on labels and descriptions
- Position form links to title, unit, grade, location — **good model** if wired to employees

---

## 10. Phase 6 Verdict

| Dimension | Rating |
|-----------|--------|
| Foundation UI completeness | **Good (CRUD)** |
| Terminology clarity | **Moderate** |
| Operational honesty (UI reflects runtime) | **Low** |
| Enterprise admin experience | **Moderate** |

---

*End of Phase 6 — HR Foundation UI/UX Audit.*
