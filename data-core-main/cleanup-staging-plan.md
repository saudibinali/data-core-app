# Cleanup Staging Plan — Phase 5

**Default:** `workforceCleanupStage = none` (production unchanged)

## Stages

| Stage | Behavior | Code impact |
|-------|----------|-------------|
| **none** | Full legacy compat | All adapters active |
| **stage1** | Disable legacy **writes**, reads OK | HTTP 409 on blocked writes |
| **stage2** | stage1 + enhanced monitoring | Daily snapshots |
| **stage3** | Disable adapters (no code deletion) | Skip mirror/sync writes |
| **stage4** | Archival/drop **plan only** | No automatic drops |

## Settings

- `hr_workspace_settings.workforce_cleanup_stage`
- `hr_workspace_settings.legacy_write_policy` (per-surface override)

## Promotion checklist

1. `GET /hr/settings/cutover-readiness` → all checks pass
2. `validate-legacy-readiness.cjs` → zero traffic 30d
3. Promote one stage at a time per workspace
4. Monitor `GET /health/workforce?workspaceId=`

**No big bang. No table drops in Phase 5.**
