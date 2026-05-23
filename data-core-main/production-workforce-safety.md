# Production Workforce Safety — Phase 4

**Status:** Startup guards active

---

## Startup sequence (after migrations)

1. Org runtime schema verify (Phase 2)
2. Approval runtime schema verify (Phase 3)
3. **Workforce operations schema verify (Phase 4)** ← NEW
4. Workflow engine, seeds, processors…

Failure at step 3 → server **exit(1)** (same pattern as org/approval).

## Phase 4 schema requirements

| Object | Required |
|--------|----------|
| `employee_movements` | table |
| `workforce_lifecycle_events` | table |
| `workforce_timeline_events` | table |
| `workforce_audit_log` | table |
| `hr_workspace_settings.workforce_governance_mode` | column |
| `hr_employee_documents.category_code` | column |

## API safety contract

All new Phase 4 routes return:

- **503** + `WORKFORCE_OPS_SCHEMA_UNAVAILABLE` + migration hint on schema mismatch
- **400** with `code` on governance/validation failures
- Never unhandled schema errors → HTTP 500

## Deployment checklist

```bash
node scripts/migrate-workforce-operations.cjs
node scripts/validate-workforce-operations.cjs
# restart api-server (init-sequence runs verifyWorkforceOpsSchema)
```

## Cutover defaults (production-safe)

| Setting | Default | Production impact |
|---------|---------|-------------------|
| workforceGovernanceMode | legacy | No new blocks |
| orgRuntimeMode | legacy | Unchanged from Phase 2 |
| approvalRuntimeMode | legacy | Unchanged from Phase 3 |

Promote per workspace when ready: shadow → active.

## Rollback

Migration 0027 is additive only. Rollback = leave tables in place (unused) or drop tables manually; no legacy API breakage.
