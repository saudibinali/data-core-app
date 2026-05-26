# RBAC Exceptions (F2.3)

Routes intentionally using **`requireAuth` only** (no workspace permission key). Documented for SOC 2 / access review.

## Self-service (actor = self)

| Route | Reason |
|-------|--------|
| `GET /auth/me`, `POST /auth/change-password` | Authenticated user profile |
| `GET /users/me` | Current user record |
| `POST /hr/leave-requests` | Employee submits own leave (employee profile required) |
| `PATCH /hr/leave-requests/:id/withdraw` | Employee withdraws own pending request |
| `GET /hr/me/leave-policies` | Self-service policy list |
| `GET /hr/me/payslips`, `GET /hr/me/payslips/:id` | Own payslips only (scoped by linked employee) |
| `GET /hr/leave-requests`, `GET /hr/leave-requests/:id` | List/detail: own rows unless `leave.view` / legacy admin |

## Platform / setup (non-workspace)

| Route | Reason |
|-------|--------|
| `POST /auth/login`, `POST /auth/logout` | Public auth |
| `GET /platform/branding` | Public branding |
| `/setup/*` | First-run wizard |

## Super admin

| Route | Reason |
|-------|--------|
| `/platform/*` | Platform RBAC via `requirePlatformPermission` (P17), not workspace keys |

## Fixed in F2.3

| Route | Was | Now |
|-------|-----|-----|
| `GET /hr/categories` | `requireAuth` | `requirePermission("hr.view")` |
| `PATCH …/leave-requests/:id/approve` | `requireAuth` | `requirePermission("leave.manage")` |
| `PATCH …/leave-requests/:id/reject` | `requireAuth` | `requirePermission("leave.manage")` |

## Review cadence

- Re-audit when adding routes under `artifacts/api-server/src/routes/`.
- Weekly stale-permission report: `platform_access_review_weekly` activity log (F2.7).
