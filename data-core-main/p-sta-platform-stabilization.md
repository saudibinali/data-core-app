# P-STA — Platform Infrastructure Stabilization

**Date:** 2026-05-20  
**Goal:** HCM/ERP foundation integrity before new domains (per enterprise audit).

## Delivered

### Finance workspace module
- `finance` in `seed/modules.ts` → `/finance`, `finance.view`, depends on `hr`
- Finance permissions in roles UI (`workspace-roles.ts`)
- UI: `/finance` dashboard, `/finance/ops` (replaces HR-only moduleKey)

### Legacy write freeze (opt-in via env)
| Env | Effect |
|-----|--------|
| `LEGACY_LEAVE_FREEZE` | Existing leave pilot freeze (unchanged) |
| `LEGACY_PAYROLL_FREEZE` | Blocks legacy `/hr/payroll/runs*` writes → 410 |
| `LEGACY_ATTENDANCE_FREEZE` | Blocks `POST /hr/attendance` → 410 |
| `PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID` | Pilot workspace for payroll/attendance freeze |
| `PLATFORM_STABILIZATION_ALL_WORKSPACES` | Applies pilot cutover to all workspaces |
| `LEAVE_CUTOVER_PILOT_WORKSPACE_ID` | Leave pilot (existing) |

Canonical endpoints returned in 410 JSON bodies.

### Stabilization API
`GET /api/workspace/stabilization` (requires `hr.manage`):
- Module enablement + dependencies
- Legacy vs canonical row counts (leave, payroll)
- Cutover flag status
- Risk flags + recommendations

### UI
- `/admin/platform/stabilization` — workspace admin snapshot
- HR dashboard link “Stabilization”

## How to enable cutover (example)

```env
PLATFORM_STABILIZATION_ALL_WORKSPACES=true
LEGACY_LEAVE_FREEZE=true
LEGACY_PAYROLL_FREEZE=true
LEGACY_ATTENDANCE_FREEZE=true
```

Or pilot one workspace:

```env
PLATFORM_STABILIZATION_PILOT_WORKSPACE_ID=1
LEGACY_PAYROLL_FREEZE=true
```

## Not in scope (P-STA)
- Leave data migration
- departments → hr_org_units migration
- GL posting
- New ERP modules

## Next recommended
- P-HCM2: employee–user provisioning, leave production cutover
- Enable finance module per tenant after COA setup
