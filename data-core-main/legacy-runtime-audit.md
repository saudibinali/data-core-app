# Legacy Runtime Audit — Phase 5

**Status:** Complete (static inventory + runtime telemetry hooks)

## Audited legacy surfaces

| Surface | Replacement | Active writers | Active readers |
|---------|-------------|----------------|----------------|
| `departments` | `hr_org_units` | `routes/departments.ts` | auth, tickets, admin |
| `users.departmentId` | `employees.orgUnitId` | `syncLegacyUserFieldsFromEmployee` | auth, tickets |
| `users.lineManagerId` | reporting chain | same adapter | manager-resolver, workflows |
| `hr_employee_activity` | `workforce_timeline_events` | `hr.ts:logActivity` | activity tab, file aggregate |
| `hr_employee_position_history` | `employee_movements` | position-history POST, movement mirror | position-history GET |
| `approvals` | `approval_instances` | `routes/approvals.ts` | same |
| `workflow_approvals` | `approval_steps` | workflow engine | workflows |
| `leave_approval_steps` | unified approval | `routes/leave.ts` | leave + dual-write |
| `legacy_department_org_map` | native org | org startup backfill | manager-resolver |

## API

- `GET /hr/legacy-audit` — full inventory JSON
- Code: `lib/workforce/stabilization/legacy-audit-inventory.ts`

## Rule

**No deletion** until audit + 30-day zero-traffic telemetry + shadow validation pass.
