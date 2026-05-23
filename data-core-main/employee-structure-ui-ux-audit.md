# Employee Structure UI/UX Audit (Phase 5)

**Scope:** User-facing flows for employee creation, org assignment, manager/position assignment, and structure visualization.

---

## 1. Surface Map

| Flow | Page / component | Path |
|------|------------------|------|
| Create employee (full) | `hr-employee-new.tsx` | `/hr/employees/new` |
| Employee list / filter | `hr-employees.tsx` | `/hr/employees` |
| Employee detail | `hr-employee-detail.tsx` | `/hr/employees/:id` |
| HR foundation (org, positions, lookups) | `hr-foundation.tsx` | HR → Foundation |
| Legacy departments | `departments.tsx` | `/departments` |
| User directory | `users.tsx` | `/users` |
| HR dashboard shortcuts | `hr-dashboard.tsx` | Links to **both** departments and HR modules |

---

## 2. Employee Creation Flow

### 2.1 `hr-employee-new.tsx` — strengths

- Collects org unit, job title, job grade, direct manager (optional selects)
- Sends numeric IDs for org fields on submit
- Supports employment type, dates, personal data
- Clear “none” option for optional org fields

### 2.2 Gaps

| Gap | Impact |
|-----|--------|
| No validation that manager ≠ self | Bad data possible |
| No warning when org/manager left empty | Silent incomplete hire |
| No prompt to link/create user account | Self-service blocked later |
| No `positionId` / work location picker | Seat model unused |
| No sync preview with user record if email matches | Duplicate identity |

### 2.3 Provision / import paths

- Minimal provision API not exposed as primary UI wizard step
- Import template marks org fields **optional** — bulk incomplete hires easy

---

## 3. Department / Org Unit Assignment

### Two admin paths (confusing)

| Path | UI | Model |
|------|-----|-------|
| **HR Foundation → Org Units** | Tree-capable list with `parentId` | `hr_org_units` |
| **Departments page** | Flat department CRUD | `departments` |

**Employee create** uses **HR org units only**.  
**User create** uses **legacy departments only**.

**Architectural issue:** Operators maintaining **two org directories** without guidance on canonical source. Entitlement copy may say “organization structure” while both exist.

### Why optional department is an HCM architectural issue

In enterprise HCM systems, **organizational unit assignment is a core invariant** because:

1. **Cost allocation & budgeting** — payroll and finance post by org unit
2. **Approval routing** — manager chains often derive from org placement
3. **Policy application** — leave, attendance, work rules vary by unit/location
4. **Compliance & audit** — headcount reporting requires known placement
5. **Security scope** — row-level “see my department” filters break with NULL org

Allowing `orgUnitId = NULL` with only `fullName` required makes the system behave as a **contact list**, not a **workforce system**. Operations “work” via admin fallbacks (e.g. leave → admin approver), **hiding** structural gaps until scale/compliance exposure.

---

## 4. Manager Assignment Flow

### Employee path

- **Create:** optional `directManagerId` select (`hr-employee-new.tsx`)
- **Detail:** Org tab shows `managerName` — **read-only**
- **Edit mode:** Profile + employment fields editable — **org/manager NOT in edit UI**
- **API:** PATCH supports `directManagerId` — UI gap only

### User path

- **Create/edit:** `lineManagerId` select (`users.tsx`)
- Independent from employee manager

### UX confusion

| User belief | Reality |
|-------------|---------|
| “I set manager on employee detail” | Cannot — must recreate via API or only at create |
| “User manager = employee manager” | **Not synced** |
| “Department manager approves leave” | **Not used** in canonical leave |

---

## 5. Position Assignment Flow

| Surface | Job title/grade | Position seat |
|---------|-----------------|---------------|
| Create employee | ✅ Selects | ❌ |
| Detail org tab | Display only | ❌ |
| HR Foundation | Catalog CRUD | Seat CRUD |
| Free-text `position` | Create form | Display fallback |

**Enterprise gap:** Position management split across foundation seats (vacant/filled) and employee free-text — **no filled/vacant lifecycle in employee UI**.

---

## 6. Org Structure Visualization

| Expected in enterprise HCM | Present? |
|----------------------------|----------|
| Org chart (tree/graph) | ❌ |
| Manager chain view | ❌ |
| Span of control metrics | ❌ |
| Vacant position dashboard | ⚠️ Foundation list only |
| Drill-down unit → employees | ⚠️ Filter on employee list by orgUnitId |

**Flat lists** replace hierarchy visualization — admins must mentally reconstruct tree from `parentId`.

---

## 7. Employee Detail — Tab Analysis

| Tab | Org relevance | Issue |
|-----|---------------|-------|
| Profile | Account link card | Good — highlights user link |
| Org Structure | Read-only InfoRows | **No edit** despite PATCH API support |
| Job Movements | History list | Records transfer without updating current org |
| Leaves | Legacy + canonical overlap | Multiple leave UX entry points |
| Notes | Disciplinary as note type | Not a structured case flow |

---

## 8. Dangerous Optional Fields (UX + API)

| Field optional | Risk |
|----------------|------|
| `orgUnitId` | Broken reporting; false sense of “employee complete” |
| `directManagerId` | Wrong approver (admin fallback) |
| `userId` link | Self-service HR blocked |
| `jobTitleId` | Generic roster; policy by title impossible |
| User `departmentIds` empty | Workflow/dept features noop |
| User `lineManagerId` empty | Workflow approval step skips |

---

## 9. Missing Mandatory Relationships (Recommended for enterprise — not implemented)

| Relationship | Current | Enterprise norm |
|--------------|---------|-----------------|
| Employee → org unit | Optional | Required at hire (or within grace period) |
| Employee → direct manager | Optional | Required for non-executive roles |
| Employee → job title OR position seat | Optional | Required |
| User ↔ employee link | Optional | Required for workforce self-service tenants |
| Single org model | Dual | One canonical tree |

---

## 10. HR Inconsistencies in UI

1. **Two people directories** — Users vs HR Employees
2. **Two department systems** — `/departments` vs Foundation org units
3. **Edit asymmetry** — can set org at create, cannot fix in detail UI
4. **Dashboard links** — may send admin to wrong org tool
5. **Status vocabulary** — employee status text vs foundation status lookup not visibly FK-linked
6. **“Position” label** — means job title, free text, or seat depending on screen

---

## 11. Enterprise Risks (UX-driven)

| Risk | Mechanism |
|------|-----------|
| Compliance / audit failure | Incomplete org data accepted silently |
| Approval to wrong person | Admin fallback when manager missing |
| Data drift | User updated; employee stale (no sync) |
| Admin training burden | Dual models without in-app canonical guidance |
| Failed self-service rollout | Employees created without user link |

---

## 12. Confusing Flows Checklist

- [ ] Admin creates user → expects HR record → **not auto-created**
- [ ] Admin creates employee → expects login → **must link account separately**
- [ ] Admin edits org on detail page → **no controls in edit mode**
- [ ] Admin logs job transfer → **current org unchanged**
- [ ] Admin configures position seats → **never assigns to employee**
- [ ] Employee uses self-service leave → **needs prior linking**

---

## 13. Phase 5 Verdict

| Area | Maturity |
|------|----------|
| Create employee (initial org capture) | **Good** |
| Maintain org over lifecycle | **Poor** |
| Unified org admin | **Poor** |
| Manager assignment UX | **Fragmented** |
| Structure visualization | **Absent** |
| Enterprise enforcement in UI | **Absent** |

---

*End of Phase 5 — UI/UX Structure Audit.*
