# P23-A — Platform Governance Refactor (Delivery Notes)

## Control plane architecture

P23-A introduces an **additive governance layer** on top of existing Workforce / Payroll / Finance surfaces:

- **Ops read model**: `GET /api/platform/governance/ops/overview` (`platform.governance.ops.read`).
- **Workspace configuration façade**: `GET /api/platform/governance/workspaces/:workspaceId/configuration` (`tenants.read`) returns grouped read-only snapshots; it does **not** mutate tenant settings.
- **Module governance API**: `PATCH /api/platform/governance/workspaces/:workspaceId/modules/:moduleKey` with body `{ "enabled": true|false }` (`platform.modules.govern`).
- **Support governance API**:
  - `POST /api/platform/governance/support-sessions/start`
  - `POST /api/platform/governance/support-sessions/:sessionId/end`
  - `GET /api/platform/governance/support-sessions/active`

## Lifecycle model

- **Non-destructive** transitions continue to map to `workspaces.status` values (`active`, `suspended`, `locked`, `disabled`, `pending_activation`).
- `WorkspaceLifecycleService` centralizes writes and emits:
  - `activity_logs` (existing contract),
  - `workspace_lifecycle_events` (new),
  - `platform_governance_audit_logs` (new),
  - optional **finance enablement** hook on `activate` when `initFinance` is supplied.

## RBAC separation

- New platform permission codes are registered in **both** server (`artifacts/api-server/.../platform-permissions.ts`) and ops UI config (`artifacts/ops-platform/.../platform-permissions-config.ts`).
- **Platform reports** (`platform.*`) require `super_admin` **and** `platform.governance.ops.read` — they no longer rely on blanket “admin bypass” inside `assertExportAuthorized`.

## Support governance

- Sessions are **time-bound** (max 60 minutes), **scope-allowlisted**, one active session per actor, persisted to `support_impersonation_sessions` with audit rows `support_impersonation_start` / `support_impersonation_end`.

## Module governance

- `MODULE_DEPENDENCIES` enforces ordering (e.g. `payroll` → `hr`, `finance` → `hr`). Core modules cannot be disabled.

## Reporting

Five JSON report keys (via `generated_reports` / existing export job pipeline):

- `platform.workspace.lifecycle`
- `platform.module.governance`
- `platform.support.audit`
- `platform.impersonation.audit`
- `platform.governance.actions`

## UI

- **Platform Operations Center**: `/super-admin/platform-ops` (nav: “Platform Ops”), backed by the ops overview endpoint.

## Security hardening (hooks & boundaries)

- **Tenant isolation**: Data queries remain workspace-scoped; platform routes use explicit permission gates.
- **Scope separation**: Configuration façade is read-only for platform operators; mutations go through governed APIs.
- **Signed governance actions**: Optional HMAC on governance audit rows when `PLATFORM_GOVERNANCE_HMAC_SECRET` is set.
- **Admin MFA / external IAM**: **Out of scope for P23-A** — tracked for **P23-B** per phase plan.

## Remaining gaps

- Impersonation sessions are **audited** but do not yet swap JWT identity for in-product “view as user” UX—that remains a careful P23-B/P24 design item.
- Ops overview aggregates are **foundational**; deeper health metrics can reuse existing tenant health routes.
- Cross-workspace platform reports are intentionally **scoped to the export job workspace** to avoid accidental bulk exfiltration from a single job context.

---

*Phase: P23-A — ERP Platform Administration & Multi-Tenant Governance Refactor*
