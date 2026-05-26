# RBAC Matrix (F2.3)

Workspace permissions are registered in `artifacts/api-server/src/routes/workspace-roles.ts` (`STATIC_PERMISSION_GROUPS`).

| Module | Permission keys | Typical routes |
|--------|-----------------|----------------|
| users | `users.view`, `users.create`, `users.edit`, … | `/users/*` |
| departments | `departments.*` | `/departments/*` |
| tickets | `tickets.*` | `/tickets/*` |
| approvals | `approvals.*` | `/approvals/*` |
| leave | `leave.view`, `leave.manage`, `leave.submit` | `/hr/leave-requests/*` |
| hr | `hr.view`, `hr.manage`, … | `/hr/*` (except self-service) |
| payroll | `hr.payroll.*` | `/hr/payroll/*` |
| attendance | `hr.attendance.*` | workforce attendance routes |

## Enforcement

- `requirePermission(key)` uses `@workspace/core-permissions` `evaluatePolicy()`.
- **Legacy (default):** `admin` / `manager` bypass permission checks.
- **Strict:** `WORKSPACE_RBAC_STRICT=true` — admin/manager must match role bundles in `lib/core-permissions/src/role-bundles.ts`.

## Rollback

- `WORKSPACE_RBAC_STRICT=false` restores legacy admin/manager bypass.

See also: [rbac-exceptions.md](./rbac-exceptions.md)
