# Production Workflow Safety — Phase 3

## Startup sequence (after org runtime)

1. Drizzle migrations (includes 0026)
2. Org runtime checks (Phase 2)
3. **Approval runtime schema verify** (`approval_instances`, `approval_steps`, `approval_process_policies`, `approval_runtime_mode`)
4. **SLA escalation sweep** on boot
5. Workflow engine start (legacy automations)

Failure → **process.exit(1)** — API does not start with incomplete approval schema.

## Request-time safety

`handleApprovalRouteError` → HTTP **503** + `APPROVAL_RUNTIME_SCHEMA_UNAVAILABLE` + migration hint.

## Dependencies

Approval runtime requires Phase 2 org schema (`workforce_executive_overrides`, `hr_org_units.manager_employee_id`).

## Deploy checklist

```bash
node scripts/migrate-approval-runtime.cjs
# verify server starts
# PATCH /hr/settings { "approvalRuntimeMode": "dual" } on pilot workspace
# test leave submit → inbox item appears
# test approve from inbox
```

## Rollback

Set `approvalRuntimeMode: legacy` — unified tables remain unused.
