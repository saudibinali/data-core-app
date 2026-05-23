# Governance Finalization — Phase 5

## Rollout readiness API

`GET /hr/settings/cutover-readiness`

Checks:
- Org runtime active
- Approval dual/unified
- Governance shadow/active
- Zero legacy traffic (30d)
- Cleanup stage still `none`

## Recommended promotion order

1. `orgRuntimeMode`: legacy → shadow → **active**
2. `approvalRuntimeMode`: legacy → dual → unified
3. `workforceGovernanceMode`: legacy → shadow → **active**
4. `workforceCleanupStage`: none → stage1 (only after zero-traffic gate)

## Enterprise policy

`workforceActivationRequires` JSON enforced when governance active (Phase 4).

## Daily snapshots

`legacy_cutover_snapshot` stores modes + hit counts for compliance audit.
