# P23-A — Canonical Platform Governance Architecture

This document describes the **target control-plane shape** for ERP platform governance. Implementation in P23-A is **incremental and additive** (no destructive migrations, no billing provider rewrites).

## Platform control plane (logical)

| Plane | Responsibility | Primary artifacts |
|-------|----------------|-------------------|
| **Identity & access** | Platform roles, permission matrix, effective overrides | `platform-permissions.ts`, `platform-effective-permissions.ts`, platform user tables |
| **Tenant governance** | Workspace inventory, lifecycle, subscription metadata (read/write as already modeled) | `routes/tenants.ts`, tenant registry libs |
| **Workspace governance** | Status transitions, lifecycle events, finance enablement hooks | `WorkspaceLifecycleService`, `workspace_lifecycle_events` |
| **Module governance** | Enable/disable with dependency validation | `ModuleGovernanceService`, `workspace_module_settings` |
| **Operational governance** | Ops center aggregates, alerts | `PlatformGovernanceOpsService`, `/platform/governance/ops/overview` |
| **Support governance** | Scoped impersonation sessions | `SupportGovernanceService`, `support_impersonation_sessions` |
| **Audit plane** | Append-only governance decisions | `PlatformGovernanceAuditService`, `platform_governance_audit_logs` |

## Service boundaries

- **`WorkspaceLifecycleService`**: The only writer for **controlled** lifecycle transitions from the platform API (delegated from `PATCH /platform/tenants/:id/lifecycle`). Emits workspace lifecycle rows + governance audit + existing `activity_logs` for backward compatibility.
- **`WorkspaceConfigurationService`**: **Read-only** grouped configuration snapshot; never mutates HR/finance/SMTP—prevents super-admin from becoming a shadow tenant admin.
- **`ModuleGovernanceService`**: Validates dependencies, updates `workspace_module_settings`, writes governance audit `module_governance_toggle`.
- **`SupportGovernanceService`**: Creates time-bound sessions with allowlisted scopes; audits start/end.
- **`PlatformGovernanceAuditService`**: Cross-cutting append-only audit for platform decisions (lifecycle, modules, support, finance hooks).
- **`PlatformGovernanceOpsService`**: Denormalized read model for the **Platform Operations Center** UI.

## RBAC separation (canonical)

| Layer | Roles / actors | Scope |
|-------|----------------|-------|
| **Platform** | `root_platform_owner`, `platform_admin`, `support_admin`, `auditor`, … | Global platform objects, tenant registry, governance ops |
| **Workspace** | `admin`, `manager`, custom roles | Single `workspace_id` data plane |
| **Finance governance** | Workspace finance permissions + existing finance governance flows | Finance batches, reconciliation, approvals |
| **HR / payroll** | `hr.manage`, `hr.payroll.export`, … | Employees, payroll runs, attendance |
| **Support** | `platform.support.session.start/end` | Starts/ends **scoped** sessions only—no carte-blanche |

New permission codes (P23-A):

- `platform.governance.ops.read` — Ops center & platform governance exports.
- `platform.modules.govern` — Controlled module toggles.
- `platform.support.session.start` / `platform.support.session.end` — Support session lifecycle.

## Audit boundaries

- **Workspace `activity_logs`**: Preserved for product/admin UX continuity.
- **`workspace_lifecycle_events`**: Structured lifecycle stream for analytics/compliance.
- **`platform_governance_audit_logs`**: Platform/support decisions with optional HMAC (`PLATFORM_GOVERNANCE_HMAC_SECRET`).

## Tenant isolation enforcement (directional)

- API routes remain the enforcement point (`requirePlatformPermission`, workspace scoping on data queries).
- Support impersonation must **never** bypass SQL workspace filters; sessions are metadata for auditing, not alternate auth tokens in this phase.

---

*Phase: P23-A — ERP Platform Administration & Multi-Tenant Governance Refactor*
