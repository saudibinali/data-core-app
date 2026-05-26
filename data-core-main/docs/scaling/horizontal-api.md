# Horizontal API scaling (F10.5)

## Reference topology

```
                    ┌─────────────┐
                    │   Nginx LB  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      ┌─────────┐    ┌─────────┐    ┌─────────┐
      │ API :8080│    │ API :8080│    │ API :8080│
      │ WORKER_  │    │ WORKER_  │    │ WORKER_  │
      │ MODE=api │    │ MODE=api │    │ MODE=api │
      └────┬────┘    └────┬────┘    └────┬────┘
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                    ┌─────────────┐
                    │ PostgreSQL  │
                    │  (primary)  │
                    └──────┬──────┘
                           │ optional
                    ┌──────▼──────┐
                    │ read replica│
                    └─────────────┘

      ┌─────────┐    ┌─────────┐
      │ Worker  │    │ Worker  │   WORKER_MODE=worker
      └────┬────┘    └────┬────┘
           └──────────────┘
                    │
           ┌────────▼────────┐
           │ Redis (optional)│
           └─────────────────┘
```

## Environment matrix

| Variable | API | Worker |
|----------|-----|--------|
| `DATABASE_URL` | required | required |
| `DATABASE_READ_URL` | optional | optional |
| `REDIS_URL` | optional | optional |
| `WORKER_MODE` | `api` or `embedded` | `worker` |
| `JWT_SECRET` | required | required (shared) |

## Docker Compose profiles

- Default: `api` + `web` + `postgres`
- `docker compose --profile scale up -d worker redis` for worker + Redis

## Read replica lag

Monitor replication lag on PostgreSQL. Dashboard/report reads use `dbForRead()` when `DATABASE_READ_URL` is set.

## Rollback

Set `WORKER_MODE=embedded` and single API instance; remove `DATABASE_READ_URL` and `REDIS_URL`.
