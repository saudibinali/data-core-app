# Performance Optimization Report — Phase 5

## Indexes added (0028)

- `workforce_timeline_events (workspace_id, employee_id, occurred_at DESC)`
- `employee_movements (workspace_id, employee_id, effective_date DESC)`
- `approval_instances (workspace_id, status, created_at DESC)`
- `approval_steps (approver_user_id, status, due_at) WHERE pending`
- `hr_employee_activity (workspace_id, created_at DESC)`
- `hr_employee_position_history (workspace_id, employee_id, effective_date DESC)`

## Application optimizations

| Area | Change |
|------|--------|
| Org traversal | 60s TTL cache per workspace (`org-cache.ts`) |
| Approval inbox | Default limit 100, max 500 |
| Timeline / movements | Existing limits preserved (100–500) |
| Employee file | Parallel Promise.all aggregate (Phase 4) |

## Metrics

In-process counters: `org.traversal_cache_hit/miss`, `approval.inbox_query`, `employee_file.aggregate`

## Safety

All optimizations additive; legacy query paths unchanged.
