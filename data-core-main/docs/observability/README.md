# Observability (F8)

## Structured logs

- HTTP `req.id` from `x-request-id` header or generated UUID (`app.ts`).
- After authentication, logs include `workspaceId`, `userId`, and `userRole` (child logger in `requireAuth`).

## Metrics

- `GET /api/health/metrics` — Prometheus text format (super_admin only).
- Disable with `METRICS_ENABLED=false`.
- In-process counters via `observability-metrics.ts` (reset on restart).

## Workforce health

- `GET /api/health/workforce` — workspace/runtime health.
- `GET /api/health/sse-connections` — SSE connection counts (super_admin).

See [../runbooks/deploy.md](../runbooks/deploy.md) for pre/post deploy checks.

## Alerting

Operational thresholds: [alerting-rules.md](./alerting-rules.md).

## Error tracking (optional)

Set `SENTRY_DSN` in production and initialize your APM SDK in the API process entrypoint when you adopt Sentry or OpenTelemetry (F8.3). Until then, unhandled errors are logged with `reqId` via the global Express error handler.
