# P20-A — Workforce Event Platform Architecture

**Phase:** P20-A (design only)  
**Date:** 2026-05-19

---

## 1. Vision

Transform attendance from **daily manual records** into a **Workforce Event Platform (WEP)** that:

1. Ingests **immutable raw events** from many sources  
2. **Normalizes** them into canonical workforce events  
3. **Aggregates** into daily summaries compatible with today’s `hr_attendance`  
4. **Governs** conflicts, policies, locks, and audit  
5. **Feeds** payroll, leave, and reporting without vendor lock-in  

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WORKFORCE EVENT PLATFORM                          │
├─────────────────────────────────────────────────────────────────────────┤
│  SOURCES          INGESTION           CORE                 CONSUMERS       │
│  ───────          ─────────           ────                 ─────────       │
│  manual ─────┐                      raw_events ──►     hr_attendance   │
│  web clock ──┤    connectors /       normalization      (legacy view)   │
│  mobile GPS ─┤    webhooks /          engine              daily_summaries │
│  QR ─────────┤    polling jobs         │                  reports (P19)   │
│  biometric ──┤                         ▼                  payroll (read)  │
│  Excel ──────┤                    attendance_events        leave overlay   │
│  vendor API ─┤                         │                  notifications  │
│  bulk API ───┘                         ▼                                   │
│                                 adjustments + locks                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural principles

| Principle | Implication |
|-----------|-------------|
| **Vendor-agnostic** | All vendors implement the same connector contract; no vendor tables in core logic |
| **Event-first** | Raw events are append-only; summaries are derived and rebuildable |
| **Workspace isolation** | Every row scoped by `workspace_id`; cross-tenant leakage impossible at API layer |
| **Legacy coexistence** | `hr_attendance` remains read/write during migration; dual-write then read-switch |
| **Idempotent ingest** | External IDs + hash prevent duplicate punches |
| **Policy outside code** | Late/OT/geofence rules in configurable policies where possible |
| **Audit by default** | Source, actor, device, location (when allowed) stored with events |

---

## 3. Layered components

### 3.1 Source registry (`attendance_sources`)

Logical channels: `manual`, `web`, `mobile_gps`, `qr`, `biometric`, `excel`, `api`, `system`.  
Maps to connector configuration and default trust/priority.

### 3.2 Integration plane

- **Connectors** — pull/push adapters (see integration strategy doc)  
- **Sync jobs** — DB-polled workers (same pattern as P19 export/notification processors; **no Redis required initially**)  
- **Credential vault** — workspace-scoped secrets (encrypted), never returned to browser  

### 3.3 Ingestion plane

- **Raw events** — vendor-native payload + metadata  
- **Validation** — schema, employee match, time bounds  
- **Normalization** — map to `attendance_events` (clock_in, clock_out, break_start, etc.)  

### 3.4 Aggregation plane

- **Shift matching** — assign expected shift per employee/date  
- **Daily summary builder** — produces `attendance_daily_summaries` → mirrors `hr_attendance` fields  
- **Conflict resolver** — source priority, manual override wins  

### 3.5 Governance plane

- **Adjustments** — HR corrections with reason codes  
- **Period locks** — block changes before payroll close  
- **Geofence policies** — validate mobile events (future)  

### 3.6 Consumption plane

- **Existing APIs** — continue serving `hr_attendance` shape during transition  
- **Reports** — P19 `hr.attendance.period` reads summaries/legacy table  
- **Payroll** — read-only adapters in later phase (no P20-A payroll redesign)  
- **Leave overlay** — approved leave marks expected absence without deleting punches  

---

## 4. Multi-source catalog

| Source | Ingest mode | Phase |
|--------|-------------|-------|
| Manual entry | Direct API / UI | Today (legacy) |
| Web clock-in/out | REST + optional geolocation | P20-B/C |
| Mobile GPS | Mobile API + geofence check | P20-D+ |
| QR kiosk | Short-lived token scan | P20-D+ |
| Biometric / device vendor | Connector poll or webhook | P20-E+ |
| Excel/CSV | Import batch + `import_jobs` | P20-C |
| Partner API | Webhook + API key | P20-E+ |
| Bulk upload | Admin file → batch | P20-C |
| System generated | Leave/holiday/scheduler | P20-C |

---

## 5. Processing pipeline (logical)

```
1. Receive payload (API, webhook, poll, file row)
2. Resolve workspace + source + idempotency key
3. Persist attendance_raw_events (status=received)
4. Validate employee, timestamp, device (if any)
5. Normalize → attendance_events
6. Queue aggregation for affected (employee_id, local_date)
7. Run normalization rules (late, missing punch, OT candidate)
8. Upsert attendance_daily_summaries
9. Dual-write hr_attendance (transition flag per workspace)
10. Emit workforce events on bus (attendance.received, attendance.day.finalized)
11. Notify subscribers (optional, P19 notification infra)
```

---

## 6. Event bus (future, aligned with leave)

Extend `appEventBus` with types such as:

- `attendance.raw.received`  
- `attendance.event.normalized`  
- `attendance.day.calculated`  
- `attendance.import.completed`  
- `attendance.sync.failed`  

**P20-A:** Specify only; no implementation.

---

## 7. API surface (planned, not implemented)

| Area | Endpoints (illustrative) |
|------|--------------------------|
| Clock | `POST /hr/workforce/clock` (in/out, source=web) |
| Events | `GET /hr/workforce/events`, `GET .../raw` (admin) |
| Integrations | CRUD `/hr/workforce/integrations`, `POST .../test` |
| Import | `POST /hr/workforce/imports` → `import_jobs` |
| Summaries | `GET /hr/workforce/daily` (replaces list over time) |
| Policies | CRUD geofence, attendance policies |

Legacy `/hr/attendance/*` remains until deprecation window ends.

---

## 8. Deployment & ops

- **Workers:** DB-scheduled sync jobs per workspace integration (interval configurable)  
- **Observability:** `attendance_sync_jobs` status, error counters, dead-letter row flag on raw events  
- **Feature flags:** Per-workspace enable WEP read path vs legacy-only  

---

## 9. Non-goals (P20-A)

- Mobile app binaries  
- Live GPS tracking maps  
- Vendor-specific SDKs  
- Payroll formula changes  
- Dropping `hr_attendance` table  

---

## 10. Phased delivery map

| Phase | Focus |
|-------|--------|
| **P20-B** | Canonical tables + raw/event ingestion + dual-write |
| **P20-C** | Excel import via `import_jobs` + normalization v1 |
| **P20-D** | Web/mobile clock + geofence schema |
| **P20-E** | Vendor connectors (2–3 adapters) |
| **P20-F** | UI workforce center + self-service clock |

---

**Related:** `p20-a-canonical-attendance-models.md`, `p20-a-attendance-integration-strategy.md`
