# Org Runtime Architecture

**Phase:** 2 — Organizational Hierarchy & Position Runtime Engine  
**Prerequisite:** Phase 1 `active` on pilot workspace(s)

---

## 1. Target Architecture

```
hr_org_units (tree)
       │
       ├── hr_positions (seats: title + grade + location + headcount)
       │         │
       │         └── employees.positionId (incumbent)
       │
       └── employees.orgUnitId (primary org placement)

Reporting graph (parallel to org tree):
  employees.directManagerId → employee chain
  hr_positions.reportsToPositionId (Phase 2.1) → position hierarchy
```

**Runtime principle:** Resolve org intelligence via **graph services**, not flat IDs or user fields.

---

## 2. New Services (proposed package)

| Service | Responsibility |
|---------|----------------|
| `OrgGraphService` | Load tree, ancestors, descendants, siblings |
| `PositionRuntimeService` | Vacancy, assign, release, occupancy |
| `ReportingHierarchyService` | Manager chain, skip-level, org head |
| `OrgRoutingService` | Approver by unit head, division head (Phase 3 consumer) |

**Path:** `artifacts/api-server/src/lib/workforce/org/`

---

## 3. Schema Additions (additive, idempotent)

| Change | Purpose |
|--------|---------|
| `hr_positions.reports_to_position_id` | Position hierarchy |
| `hr_positions.manager_employee_id` | Optional explicit seat manager |
| `hr_org_units.manager_employee_id` | Unit head (employee FK) |
| `employees.position_id` | **Wire existing column** — enforce in PATCH |
| Trigger or app logic | Update `currentOccupancy` on assign/release |

**Matrix (future):** `employee_org_assignments (employee_id, org_unit_id, role, is_primary)` — Phase 2.5 optional.

---

## 4. API Additions (non-breaking)

| Endpoint | Purpose |
|----------|---------|
| `GET /hr/org-units/tree` | Nested org for UI chart |
| `GET /hr/org-units/:id/employees` | Roster by subtree |
| `POST /hr/positions/:id/assign` | `{ employeeId, effectiveDate }` |
| `POST /hr/positions/:id/vacate` | Release incumbent |
| `GET /hr/employees/:id/reporting-chain` | Ordered manager list |

Legacy endpoints unchanged.

---

## 5. Org Types (canonical)

Align UI with schema: **company, branch, division, department, team** (+ unit alias → department).

**Validation rules:**
- `branch` parent must be `company` or `division`
- `team` parent must be `department` or `division`
- No cycles (Phase 1 validator extended)

---

## 6. Delegation Foundation (Phase 2 prep)

**Table:** `workforce_delegations`

| Column | Purpose |
|--------|---------|
| delegator_employee_id | Who is away |
| delegate_employee_id | Substitute |
| start_date, end_date | Window |
| scope | `all_approvals` \| `org_subtree` \| `leave_only` |

Used by Phase 3 approval runtime; schema only in Phase 2.

---

## 7. Executive Override Routing (foundation)

**Table:** `workforce_executive_overrides` (workspace policy)

- CEO employee id
- HR director employee id
- Escalation ceiling (max chain depth before exec)

Phase 3 consumes; Phase 2 stores config in HR Foundation UI tab.

---

## 8. Migration (Phase 2)

1. Backfill `hr_org_units.manager_employee_id` from department manager maps where possible
2. For employees with jobTitle + orgUnit: suggest matching vacant `hr_positions` row
3. Auto-assign `positionId` only when 1:1 seat match; else manual review queue
4. Recalculate all `currentOccupancy`

**Idempotent:** assignment script skips if positionId already set.

---

## 9. Backward Compatibility

- Employees without `positionId` remain valid until Phase 4 mandatory gate
- Org head resolver falls back to directManagerId if unit head null
- Flat `GET /hr/org-units` list preserved

---

*See also: position-runtime-engine.md, org-traversal-specification.md*
