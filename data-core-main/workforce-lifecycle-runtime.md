# Workforce Lifecycle Runtime — Phase 4

**Status:** Foundation implemented

---

## Supported lifecycle events

| Event type | Movement applied | Approval process (when dual/unified) |
|------------|------------------|--------------------------------------|
| onboarding | onboarding | hr.onboarding |
| transfer | transfer | hr.transfer |
| promotion | promotion | hr.promotion |
| department_movement | dept_change | — |
| manager_change | manager_change | — |
| offboarding | offboarding | hr.offboarding |
| termination | termination | hr.offboarding |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/hr/employees/:id/lifecycle` | List lifecycle events |
| POST | `/hr/employees/:id/lifecycle` | Initiate event |
| POST | `/hr/employees/:id/lifecycle/:eventId/complete` | Complete + apply movement |

## Flow

1. **Initiate** → `workforce_lifecycle_events` row (pending / in_progress)
2. **Optional approval** when `approvalRuntimeMode` is `dual` or `unified`
3. **Complete** → `recordAndApplyMovement()` updates employee + org runtime + timeline + audit

## Tables

- `workforce_lifecycle_events` — canonical lifecycle state machine
- Links to `employee_movements`, `approval_instances`

## Implementation

`artifacts/api-server/src/lib/workforce/operations/lifecycle-service.ts`

## Defaults

- `skipApproval: true` behavior when approval mode is `legacy` (immediate complete path)
- No legacy deletion; `hr_employee_position_history` still receives mirror writes
