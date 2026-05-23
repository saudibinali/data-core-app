# HR Movement Runtime — Phase 4

**Status:** Implemented

---

## Canonical table

`employee_movements` tracks org, manager, title, and status transitions with full before/after context.

| Field | Purpose |
|-------|---------|
| movement_type | transfer, promotion, manager_change, onboarding, termination, … |
| from/to org_unit_id | Department / org transitions |
| from/to manager_id | Reporting chain changes |
| from/to job_title_id | Title changes |
| effective_date | When change takes effect |
| applied_at | When employee row was updated |
| lifecycle_event_id | Link to lifecycle |
| approval_instance_id | Link to approval |

## API

| Method | Path |
|--------|------|
| GET | `/hr/employees/:id/movements` |
| POST | `/hr/employees/:id/movements` |

## Behavior

`recordAndApplyMovement()`:

1. Validates org linking (cycle detection, valid org unit/manager)
2. Inserts `employee_movements`
3. **Mirrors** to legacy `hr_employee_position_history` (compat)
4. Updates `employees` org/manager/title/status when `applyImmediately !== false`
5. Syncs legacy user fields via `syncLegacyUserFieldsFromEmployee`
6. Appends timeline + audit events

## Implementation

`artifacts/api-server/src/lib/workforce/operations/movement-service.ts`
