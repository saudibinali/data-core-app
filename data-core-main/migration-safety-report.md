# Migration Safety Report — Phase 1

## Principles applied

- ✅ Additive only — no DROP TABLE / DROP COLUMN
- ✅ Idempotent — `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`
- ✅ Default-safe — `workforce_canonical_mode = 'legacy'`
- ✅ Reversible — new columns/tables can remain unused
- ✅ No legacy deletion

## Migration artifacts

| File | Purpose |
|------|---------|
| `lib/db/drizzle/0024_workforce_canonical_foundation.sql` | Drizzle-tracked migration |
| `scripts/migrate-workforce-foundation.cjs` | Production-safe runner + dept→org backfill |
| `lib/db/drizzle/meta/_journal.json` | Journal entry idx 24 |

## Schema changes

### `hr_workspace_settings` (columns added)

- `workforce_canonical_mode` — default `legacy`
- `workforce_sync_direction` — default `none`

### New tables

- `legacy_department_org_map`
- `workforce_migration_exceptions`

### `hr_employee_documents` (columns added)

- `mime_type`, `checksum`, `storage_key`

## Runtime safety

Endpoints using new schema catch PostgreSQL `42P01` / `42703` and return:

```json
{
  "error": "WORKFORCE_SCHEMA_UNAVAILABLE",
  "message": "...",
  "migrationHint": "Run: node scripts/migrate-workforce-foundation.cjs ..."
}
```

HTTP status: **503** (not 500).

## Execution order (production)

1. Deploy application code (backward compatible)
2. Run migration script (safe to repeat):
   ```bash
   DATABASE_URL=... node scripts/migrate-workforce-foundation.cjs
   ```
3. Verify: `node scripts/validate-workforce-integrity.cjs`
4. Optionally promote workspace: `PATCH /hr/settings` → `workforceCanonicalMode: shadow` then `active`

## Rollback

- Set all workspaces to `legacy` via settings API
- No schema rollback required for emergency (unused columns harmless)
- Do **not** drop new tables until Phase 5 cleanup

## Drift prevention

- Use migration script or drizzle migrate — no manual SQL outside migration system
- Validation script is read-only and safe for CI/cron
