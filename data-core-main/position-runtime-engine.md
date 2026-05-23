# Position Runtime Engine

**Phase:** 2 — Position activation specification

---

## 1. Problem Statement

Today `hr_positions` is Foundation CRUD only. `employees.positionId` is never set. Headcount/occupancy is manual fiction.

**Goal:** Position = **runtime seat** that employees occupy; drives vacancy, reporting, and (Phase 3) approval routing.

---

## 2. Position Lifecycle State Machine

```
vacant ──assign──► filled ──vacate──► vacant
  │                  │
  └──freeze──► frozen ──unfreeze──► vacant
                      │
                      └──archive──► archived (terminal)
```

| Transition | Owner | Rules |
|------------|-------|-------|
| assign | `PositionRuntimeService.assign` | headcount not exceeded; employee workspace match; one primary seat per employee (configurable) |
| vacate | `vacate` | Clear employee.positionId; decrement occupancy |
| freeze | admin | No new assignments |
| archive | admin | Must be vacant |

---

## 3. Assign Algorithm

```
assign(positionId, employeeId, effectiveDate):
  1. Validate position.status in (vacant, filled) and isActive
  2. If position.currentOccupancy >= position.headcount → reject
  3. If employee.positionId set → vacate old seat (or reject if policy=single_seat)
  4. TX:
       UPDATE employees SET positionId, orgUnitId=position.orgUnitId,
              jobTitleId=COALESCE(employee.jobTitleId, position.jobTitleId),
              jobGradeId=COALESCE(employee.jobGradeId, position.jobGradeId)
       UPDATE hr_positions SET currentOccupancy += 1, status='filled'
       INSERT hr_employee_position_history (changeType='position_assign', ...)
  5. Sync user mirrors (Phase 1 compat)
  6. Emit workforce.position.assigned
```

---

## 4. Relationship to Job Title

| Concept | Role |
|---------|------|
| **Job Title** | Catalog / classification |
| **Position** | Instantiated seat in org ("Senior Engineer - Riyadh Branch") |
| Employee | Occupies **one primary position** (Phase 2); title may inherit from seat |

**Rule:** Position.jobTitleId is default for incumbent; employee may override with approval (Phase 4).

---

## 5. Vacant Position Dashboard

**UI (hr-foundation or new Org Console):**
- List seats where `currentOccupancy < headcount` and status=vacant
- Filter by org subtree
- Action: Assign employee / Create requisition (future)

---

## 6. Multiple Incumbents

When `headcount > 1`:
- Same position row; multiple employees share `positionId`
- `currentOccupancy` = count(employees where positionId=X)
- Reporting: position-level manager via `reportsToPositionId`

---

## 7. Acting Positions (Phase 2.2)

**Table:** `workforce_acting_assignments`

- employeeId acts for positionId during date range
- Approvals route to acting employee's userId
- Does not change primary positionId unless `promote_on_end` flag

---

## 8. Validation & Integrity

| Check | When |
|-------|------|
| occupancy = count(employees) | Nightly job |
| position.orgUnitId matches employee.orgUnitId | On assign sync |
| archived position has 0 incumbents | Before archive |

Script: extend `validate-workforce-integrity.cjs` with P1–P5 position checks.

---

## 9. Phase 2 Deliverables (implementation)

- [ ] `PositionRuntimeService` + tests
- [ ] Assign/vacate API routes
- [ ] Employee create/edit: optional position picker
- [ ] Occupancy recompute command
- [ ] Foundation positions tab: link to incumbents list

---

*End of Position Runtime Engine specification.*
