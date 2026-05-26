# SSE and multi-instance API (F9.1)

## JWT stateless

API instances are horizontally scalable; **sticky sessions are not required**.

## SSE limitation

Server-Sent Events (`/api/...` stream) are **in-process**. With PM2 cluster or multiple containers:

- Each user connects to one instance; notifications on that instance only unless bridged.
- **SME default:** `instances: 1` for API or accept that SSE may miss events on other instances.

## Scale-out options

1. **Single API + workers** (recommended first): `WORKER_MODE=api` on N API nodes, `WORKER_MODE=worker` on M worker nodes; SSE on one API behind LB with `ip_hash` (optional).
2. **Redis pub/sub bridge** (F10.1): publish notification events to Redis; each API node subscribes and pushes to local SSE connections (future enhancement).
3. **WebSocket gateway** (long-term): central connection service.

## PM2

See `deploy/ecosystem.config.cjs` — `instances: "max"`, `exec_mode: "cluster"`.
