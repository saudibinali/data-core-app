# Reporting Chain Runtime — Phase 2

## Resolution order

1. **Direct manager** — `employees.directManagerId` walk (primary)
2. **Org unit head** — `hr_org_units.manager_employee_id`
3. **Parent org head** — nearest ancestor unit with a head
4. **Executive HR director** — `workforce_executive_overrides.hr_director_employee_id`

No hardcoded user IDs.

## API

```
GET /hr/employees/:id/reporting-chain
```

Response (`ReportingNode[]`):

```json
{
  "employeeId": 12,
  "fullName": "Sara",
  "userId": 5,
  "orgUnitId": 3,
  "positionId": null,
  "depth": 0,
  "source": "self"
}
```

Subsequent nodes use `source: "direct"`.

## Cycle protection

- `MANAGER_CYCLE` on PATCH/POST when manager assignment creates a loop
- `ManagerCycleError` on reporting-chain GET
- Validator script: `INVALID_REPORTING_CHAIN`

## Depth limit

`workforce_executive_overrides.max_reporting_depth` (default 10).

## Deferred (Phase 3+)

- Position-based reporting (`reportsToPositionId`)
- Active delegation substitution
- Multi-step approval chain consumer
