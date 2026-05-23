# Observability & Monitoring — Phase 5

## Persistent telemetry

- `legacy_compat_usage_events` — every legacy route/adapter hit
- `legacy_cutover_snapshot` — daily rollup per workspace
- `runtime_schema_registry` — migration verification state

## In-process metrics

`GET /health/workforce/metrics` exposes:
- Legacy route/adapter counters
- Org cache hit/miss
- Approval inbox queries
- Startup diagnostics buffer

## Startup diagnostics

`pushStartupDiagnostic()` records component verify results during boot.

## Leave cutover metrics

Existing in-process leave counters included in `GET /health/workforce` response.

## Scheduled job (recommended)

Cron: `node scripts/aggregate-legacy-usage.cjs` daily after traffic validation window.
