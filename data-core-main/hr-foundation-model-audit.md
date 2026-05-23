# HR Foundation Model Audit (Phase 1)

**Scope:** Read-only audit of "البيانات الأساسية للموارد البشرية" / HR Foundation master data.  
**Date:** 2026-05-20  
**No modifications performed.**

---

## Executive Summary

The platform **does have an HR Foundation layer** — workspace-scoped, admin-configurable master data with a unified UI (`hr-foundation.tsx`) and API surface (`/hr/foundation/*` plus top-level org/job routes). The design intent is **metadata-driven HCM** ("no hardcoded enums").

However, foundation data is predominantly **lookup/configuration tables**, not **runtime organizational intelligence**. Many foundation entities are **CRUD-complete but weakly bound** to employee runtime rows (text codes instead of FKs). Exceptions: **leave policies** and **org units** have partial operational impact.

**Classification:** **Semi-structured HCM foundation** — metadata-heavy shell with selective runtime hooks.

---

## 1. Foundation Component Inventory

| Component | Table | API | UI Tab | Seed defaults |
|-----------|-------|-----|--------|---------------|
| **Employee statuses** | `hr_employee_statuses` | `/hr/foundation/statuses` | statuses | ✅ |
| **Employment types** | `hr_employment_types` | `/hr/foundation/employment-types` | employment-types | ✅ |
| **Contract types** | `hr_contract_types` | `/hr/foundation/contract-types` | contract-types | ✅ |
| **Work locations** | `hr_work_locations` | `/hr/foundation/work-locations` | work-locations | ✅ |
| **Document types** | `hr_document_types` | `/hr/foundation/document-types` | doc-types | ✅ |
| **Leave policies** | `hr_leave_policies` | `/hr/foundation/leave-policies` | leave-policies | ✅ |
| **Probation policies** | `hr_probation_policies` | `/hr/foundation/probation-policies` | probation | ❌ (manual add) |
| **Positions (seats)** | `hr_positions` | `/hr/foundation/positions` | positions | ❌ |
| **Org units** | `hr_org_units` | `/hr/org-units` | org-units | ❌ |
| **Job grades** | `hr_job_grades` | `/hr/job-grades` | job-grades | ❌ |
| **Job titles** | `hr_job_titles` | `/hr/job-titles` | job-titles | ❌ |

**Bootstrap:** `POST /hr/foundation/seed` seeds statuses, employment types, contract types, document types, leave policies, work locations (`hr.ts` L1840–1909).

**Schema source:** `lib/db/src/schema/hr.ts`  
**UI source:** `artifacts/ops-platform/src/pages/hr-foundation.tsx`  
**API monolith:** `artifacts/api-server/src/routes/hr.ts` (Foundation section L1835+)

---

## 2. Classification Matrix

### 2.1 Master data (configurable catalogs)

| Entity | Purpose |
|--------|---------|
| Job grades / titles | Career taxonomy |
| Contract / document / employment type codes | Label catalogs |
| Employee statuses | Intended lifecycle vocabulary |
| Work locations | Site taxonomy |
| Probation policies | Duration templates |

### 2.2 Runtime operational data

| Entity | Runtime role |
|--------|--------------|
| **Org units** | `employees.orgUnitId` FK — roster, filters, reports |
| **Leave policies** | `leavePolicyId` on requests; `requiresApproval`; balance mutations |
| **Leave balances** | `hr_leave_balances` — deduct/restore on approve/reject/cancel |
| **Employees** | Operational person records (outside foundation UI but fed by it) |

### 2.3 Organizational structure

| Entity | Structural role |
|--------|-----------------|
| `hr_org_units` | Tree (`parentId`, typed levels) |
| `hr_positions` | Seat definition (title + unit + grade + location + headcount) |
| Legacy `departments` | **Parallel** flat org for users — not in Foundation UI |

### 2.4 HR governance data

| Entity | Governance flags |
|--------|------------------|
| Employee statuses | `isDefault`, `isFinal`, `allowSelfService` |
| Leave policies | `requiresApproval`, `paid`, `carryOver` |
| Document types | `isRequired`, `hasExpiry` |
| Probation policies | `durationDays`, `extendable` |
| `hr_workspace_settings` | `leaveRuntimeMode`, employee numbering mode |

---

## 3. Used vs Placeholder vs Unbound

| Component | Used at runtime? | Binding quality | Verdict |
|-----------|------------------|-----------------|---------|
| **Org units** | ✅ | FK on employee | **Operational (partial)** |
| **Job titles / grades** | ✅ | FK on employee; import by name | **Operational (partial)** |
| **Leave policies** | ✅ | FK on leave request + balance | **Operational** |
| **Work locations** | ⚠️ | FK on employee + position seat | **Underused** |
| **Positions (seats)** | ❌ | `employees.positionId` unused in app | **Placeholder / config only** |
| **Employee statuses (lookup)** | ❌ | `employees.status` is free text | **UI-only catalog** |
| **Employment types (lookup)** | ⚠️ | `employees.employmentType` text; import validates against hardcoded set | **Dual model** |
| **Contract types (lookup)** | ❌ | `hr_employee_contracts.contractType` text | **Unbound** |
| **Document types (lookup)** | ❌ | `hr_employee_documents.documentType` text | **Unbound** |
| **Probation policies** | ❌ | No FK; `employees.probationEndDate` manual | **Config only** |
| **Policy accrual fields** | ❌ | `annualDays`, `accrualType` not accrual-engine driven in leave routes | **Metadata** |

---

## 4. The "Dynamic Foundation" Pattern

Foundation tables follow a consistent pattern:

- Workspace-scoped rows with `code`, bilingual names, `displayOrder`, `isActive`
- Auto-code generation via `_computedCode` / `toCode()` in UI
- Full CRUD from `hr-foundation.tsx` `SimpleEntityCard`

**Runtime pattern on employee/contract/document rows:**

- Many fields remain **string codes** (`status`, `employmentType`, `contractType`, `documentType`)
- Foundation lookups **mirror** those strings when seeded (e.g. code `full_time`) but **no FK enforces** alignment
- Admin can add lookup row `"consultant"` while employee API still accepts only hardcoded import enum unless code matches

**Result:** Foundation feels enterprise; employee records often behave like **legacy CRUD with optional picklists**.

---

## 5. API Route Split (Architectural Note)

| Prefix | Entities |
|--------|----------|
| `/hr/foundation/*` | Statuses, employment/contract types, locations, positions, documents, leave, probation |
| `/hr/org-units`, `/hr/job-grades`, `/hr/job-titles` | Structural/job taxonomy (same UI page, different routes) |

This split is **organizational inconsistency** — all are "foundation" conceptually but two API namespaces.

---

## 6. Related Non-Foundation HR Config

Also workspace-scoped but outside Foundation tabs:

- `hr_custom_field_defs` — metadata-driven employee fields
- `hr_salary_components` — payroll foundation
- `hr_workspace_settings` — leave runtime mode, numbering
- `hr_service_categories` — self-service catalog

---

## 7. Phase 1 Verdict

| Question | Answer |
|----------|--------|
| Real Foundation HR Architecture? | **Yes as metadata layer; no as org intelligence engine** |
| Master data vs runtime intelligence? | **~80% lookup / ~20% runtime** |
| Enterprise workforce thinking? | **Schema/UI yes; binding/governance incomplete** |

---

*End of Phase 1 — HR Foundation Model Audit.*
