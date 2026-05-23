# Runtime Usage Tracking — Phase 5

## Table: `legacy_compat_usage_events`

Event types: `route_hit`, `adapter_read`, `adapter_write`, `shadow_mismatch`, `write_blocked`, `adapter_skipped`

## Instrumented paths

- `GET/POST /departments`, `GET/POST /hr/employees/:id/position-history`
- `syncLegacyUserFieldsFromEmployee`, movement position-history mirror
- Shadow manager mismatches in `manager-resolver`

## API

- `GET /hr/legacy-usage?days=30` — summary + recent events

## Scripts

```bash
WORKSPACE_ID=1 DAYS=30 node scripts/validate-legacy-readiness.cjs
node scripts/aggregate-legacy-usage.cjs
```

## Gate

Promote cleanup only when `validate-legacy-readiness` reports **ZERO ACTIVE DEPENDENCIES**.
