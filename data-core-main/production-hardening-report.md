# Production Hardening Report — Phase 5

## Startup guards (init-sequence)

1. Migrations
2. Org runtime verify (Phase 2)
3. Approval runtime verify (Phase 3)
4. Workforce ops verify (Phase 4)
5. **Legacy compat verify (Phase 5)** ← NEW

Failure → `exit(1)` — no partial boot with missing schema.

## Health endpoints

| Endpoint | Scope |
|----------|-------|
| `GET /health/workforce` | Schema registry + modes + usage (optional workspace) |
| `GET /health/workforce/schema` | Super-admin schema snapshot |
| `GET /health/workforce/metrics` | In-process runtime counters |

## Schema registry

Table `runtime_schema_registry` tracks components 0024–0028 verification status.

## Error contract

Schema mismatch → **503** + `LEGACY_COMPAT_SCHEMA_UNAVAILABLE` + migration hint

## Scripts

```bash
node scripts/validate-schema-drift.cjs
node scripts/migrate-legacy-compat.cjs
```
