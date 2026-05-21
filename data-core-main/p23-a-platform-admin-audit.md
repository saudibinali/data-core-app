# P23-A — Platform Administration Audit

This document captures the **as-found** state of platform administration and multi-tenant governance prior to the P23-A control-plane refactor, and the gaps that motivated the change.

## Super-admin & duplicated responsibilities

- **God-mode coupling**: Legacy `super_admin` without `platformRoleCode` maps to root-equivalent permissions, while product features also overloaded `super_admin` for tenant operations. The same actor could touch **platform subscription policy**, **tenant lifecycle**, and **workspace HR/finance settings** without a hard boundary.
- **Duplicated lifecycle writes**: Workspace lifecycle transitions lived entirely in `routes/tenants.ts` (status update + `activity_logs`) while pure validation lived in `workspace-lifecycle.ts`. Any extension (finance hooks, governance audit) would have duplicated the route logic.
- **Settings chaos**: Finance, HR, SMTP, and module flags were reachable through different surfaces without a **single read façade** describing domain separation for platform viewers.

## Tenant isolation gaps

- **Cross-tenant reads** are generally gated by `tenants.read`, but **support tooling** had no first-class, **scoped impersonation** model with expiry, allowlisted scopes, and a dedicated audit stream.
- **Platform audit vs workspace audit** were not clearly separated; platform-level decisions could not be replayed independently of workspace `activity_logs`.

## Workspace configuration chaos

- Multiple tables (`finance_workspace_settings`, `hr_workspace_settings`, `workspace_module_settings`, `workspace_smtp_configs`, …) without a **canonical grouped snapshot** for read-only platform diagnostics.
- Risk: platform operators use super-admin UI paths that mutate tenant configuration directly instead of going through tenant-admin APIs.

## Platform permission issues

- Fine-grained platform RBAC existed (`platform-permissions.ts`) but lacked explicit codes for **governance operations**, **module governance**, and **support sessions**, forcing everything into coarse roles or implicit root behavior.

## Module activation issues

- Module toggles could ignore **dependency ordering** (e.g. payroll/finance depending on HR foundations) without a central guard.

## Support / admin tooling issues

- No structured **support impersonation session** (scopes, TTL, break-glass flag, consent reference) persisted for audit and compliance review.

## Billing / subscription coupling

- Subscription and commercial surfaces remain adjacent to tenant registry routes; P23-A **does not** add billing providers or change subscription storage—only clarifies **governance boundaries** so subscription state is not the only isolation story.

## Security gaps (non-exhaustive)

- **Unrestricted impersonation** risk wherever “act as tenant admin” might be added without session records.
- **Export authorization** previously short-circuited all reports for `super_admin`, which would undermine **platform report** entitlements if introduced without an explicit check.

## Architectural debt addressed in P23-A (incremental)

- Additive tables: `workspace_lifecycle_events`, `platform_governance_audit_logs`, `support_impersonation_sessions`.
- Services: lifecycle execution, module governance, workspace configuration façade, support governance, governance audit append-only log, ops aggregates.
- Routes + UI: Platform Operations Center (read-heavy) with permission `platform.governance.ops.read`.
- Reports: five `platform.*` JSON exports gated on `platform.governance.ops.read` (not blanket super-admin for those keys).

## Remaining gaps (explicit)

- **No destructive delete** path for workspaces; archival remains status-based.
- **MFA / break-glass policy enforcement** is documented as hooks—full enterprise MFA is deferred to **P23-B** (identity / SSO governance).
- **Signed governance actions** optional via `PLATFORM_GOVERNANCE_HMAC_SECRET` on audit rows—clients should treat this as an evolution path, not a full HSM-backed signing service.

---

*Phase: P23-A — ERP Platform Administration & Multi-Tenant Governance Refactor*
