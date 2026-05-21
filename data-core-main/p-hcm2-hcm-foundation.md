# P-HCM2 — HCM Foundation Closure (Employee Central alignment)

**Date:** 2026-05-20  
**Goal:** Workspace-driven leave cutover + employee↔user linking before Finance/SCM expansion.

## Delivered

### Workspace leave runtime mode
- Migration `0020_hcm_workspace_leave_runtime.sql` → `hr_workspace_settings.leave_runtime_mode`
- Modes: `legacy` | `transition` | `canonical` (default: `transition`)
- `GET/PATCH /api/hr/settings` — admin can set `leaveRuntimeMode`
- `GET /api/hr/leave-cutover/status` merges workspace mode with env pilot flags

| Mode | Canonical submit/approve | Legacy freeze |
|------|--------------------------|---------------|
| legacy | Env pilot only | Env pilot only |
| transition | ON for workspace | Env pilot only |
| canonical | ON | Always ON for workspace |

### Employee ↔ user account linking
- `GET /api/hr/employees/:id/account` — link status
- `POST /api/hr/employees/:id/link-user` — `{ userId }` (workspace admin)
- `DELETE /api/hr/employees/:id/link-user` — unlink
- UI: employee profile → **Login Account** card; HR settings modal → leave runtime selector

### Legacy leave freeze (async)
- `canonical` workspace mode freezes legacy `hr_employee_leaves` writes without env vars
- `assertLegacyLeaveWriteAllowed` is async and checks DB mode

## How to cut over leave (recommended)

1. Set workspace **Leave Runtime** to `transition` (HR → Employees → Settings).
2. Link employees to users on each profile.
3. Validate canonical leave in self-service (`/hr/me/leave`).
4. Set mode to `canonical` when legacy path is no longer needed.

Optional env pilot (unchanged):

```env
LEAVE_CUTOVER_PILOT_WORKSPACE_ID=1
LEGACY_LEAVE_FREEZE=true
```

## Not in scope (P-HCM2)
- Bulk leave data migration from `hr_employee_leaves` → `leave_requests`
- Payroll/attendance canonical cutover (see P-STA)
- GL posting, new ERP modules

## Next recommended
- Bulk leave migration job + reconciliation report
- Employee provisioning wizard (invite user + create employee in one flow)
- Enable `finance` module per tenant after COA setup
