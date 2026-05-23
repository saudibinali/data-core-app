# Workflow Runtime Rebuild — Phase 3

**Status:** Implemented (additive)  
**Default:** `approvalRuntimeMode = legacy`

## Strategic shift

| Before | After (Phase 3) |
|--------|-----------------|
| Technical `trigger_event` workflows | Business **process templates** + embedded approvals |
| Scattered approval UIs | Unified **approval inbox** |
| Hardcoded approver IDs | Org-aware **routing resolver** |

**Preserved:** Legacy workflow engine (`engine.ts`, `executor.ts`) for system automations — not deleted.

## Embedded architecture

```
Domain service (e.g. leave.ts)
  └── ApprovalRuntime.startLeaveApproval()  [dual/unified mode]
        └── approval_instances + approval_steps
              └── routing via reporting chain / org heads
```

Leave submit/approve/reject remain authoritative for leave domain state; unified runtime **dual-writes** and syncs on decisions.

## New package

`artifacts/api-server/src/lib/approval/`

## Workspace cutover

`PATCH /hr/settings`:

```json
{ "approvalRuntimeMode": "legacy" | "dual" | "unified" }
```

| Mode | Behavior |
|------|----------|
| `legacy` | `leave_approval_steps` only |
| `dual` | Legacy + unified tables |
| `unified` | Unified tables (leave API still drives domain TX) |

## UI

- `/process-templates` — business-readable policies (no trigger_event)
- `/self-service/approvals` — unified inbox
- Technical workflow builder restricted to `workflow.manage` admins

## Migration

`0026_approval_runtime_foundation.sql` or `node scripts/migrate-approval-runtime.cjs`
