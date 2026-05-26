# Alerting rules (F8.4 — operations)

Wire these thresholds to your monitoring stack (Prometheus Alertmanager, Grafana, Datadog, etc.) using `GET /api/health/metrics` and application logs.

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| API 5xx rate | > 1% of requests over 5m | critical | Check logs by `req.id`; rollback deploy if post-release |
| Migration startup failure | process exits code 1 after `db:migrate` | critical | See [incident-db-migration-failed.md](../runbooks/incident-db-migration-failed.md) |
| Event outbox backlog | `event_outbox_pending` > 100 for 10m | warning | Enable drain or fix worker; check `EVENT_OUTBOX_PUBLISH_MODE` |
| SSE connections spike | `health/sse-connections` total > expected baseline ×3 | warning | Investigate reconnect loops / proxy timeouts |
| PostgreSQL disk | volume > 80% | warning | Run `pnpm run db:backup`; plan retention |
| Integrity CI failure | `validate:canonical-cutover` exit 1 on deploy | critical | Block release; fix data or flags |

## Log queries

- Filter structured logs: `workspaceId`, `userId`, `req.id`
- Correlation: HTTP `x-request-id` header matches log `req.id`

## Staged failure test

1. Set `METRICS_ENABLED=true` on staging.
2. Trigger a controlled 500 on a test route.
3. Confirm alert fires within the configured window.
