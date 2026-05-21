# P18-B — Leave Migration Readiness Audit

**Date:** 2026-05-19  
**Scope:** Readiness to adopt `leave_requests` as canonical leave (per P18-A). **No migration executed.**

---

## 1. Canonical target (decided in P18-A)

| Role | Artifact |
|------|----------|
| **Canonical (future)** | `leave_requests`, `leave_approval_steps`, `hr_leave_balances` |
| **Legacy (maintain, no new features)** | `hr_employee_leaves` |

---

## 2. Database readiness

| Piece | Schema | Baseline migration `0000` | API depends on it |
|-------|--------|---------------------------|-------------------|
| `hr_leave_balances` | Yes | **Yes** | `hr.ts`, `leave.ts` |
| `hr_leave_policies` | Yes | Yes | `leave.ts`, Foundation UI |
| `hr_employee_leaves` | Yes | Yes | `hr.ts` (legacy paths) |
| `leave_requests` | Yes | **No** | `leave.ts` |
| `leave_approval_steps` | Yes | **No** | `leave.ts` |

**Missing DB pieces (production blocker):**

- `leave_requests` table + indexes + unique `(workspace_id, request_number)`
- `leave_approval_steps` table + indexes + FK cascade

Until migrated, **`routes/leave.ts` will fail at runtime** on DBs provisioned from journal-only migrate.

---

## 3. API usage map

### 3.1 Canonical module — `artifacts/api-server/src/routes/leave.ts`

| Method | Path | Table(s) | Transactions | Permission |
|--------|------|----------|--------------|------------|
| POST | `/hr/leave-requests` | leave_requests, balances, steps | **Yes** (`db.transaction`) | `requireAuth` + in-handler checks |
| GET | `/hr/leave-requests` | leave_requests | No | workspace + employee scope |
| GET | `/hr/leave-requests/:id` | leave_requests, steps | No | same |
| PATCH | `.../approve` | leave_requests, balances, steps | **Yes** | approver logic in handler |
| PATCH | `.../reject` | same | **Yes** | same |
| PATCH | `.../withdraw` | same | **Yes** | same |

**Registered:** `routes/index.ts` imports `leaveRouter` (after `workspaceAccessWriteGuard`).

**Strengths:** Documented invariants, conflict detection, balance reservation, bus events (per file header).

### 3.2 Legacy module — `artifacts/api-server/src/routes/hr.ts`

| Method | Path | Actual table | Notes |
|--------|------|--------------|-------|
| GET/POST/PATCH | `/hr/employees/:id/leaves` | `hr_employee_leaves` | Admin/HR nested CRUD |
| POST | `/hr/me/leave-requests` | **`hr_employee_leaves`** | **Misleading path name** — NOT `leave_requests` |
| PATCH | `/hr/attendance/leaves/:id` | `hr_employee_leaves` | Approve/reject legacy |
| GET | `/hr/attendance/leaves` | `hr_employee_leaves` | List for attendance UI |
| GET | `/hr/me/leave-balances` | `hr_leave_balances` | Self-service balances |
| GET/POST/PATCH | `/hr/leave-balances` | `hr_leave_balances` | Admin balance mgmt |

**Legacy characteristics (from `leave.ts` header + code review):**

- No `db.transaction` on `/hr/me/leave-requests` (balance update separate from insert)
- No `leave_approval_steps`
- No request number / business-day calculation
- Partial balance update when `leavePolicyId` provided

### 3.3 API conflicts

| Conflict | Severity |
|----------|----------|
| Same path name `/hr/me/leave-requests` writes **different table** than canonical POST `/hr/leave-requests` | **Critical** |
| Two approve flows: `leave.ts` PATCH approve vs `hr.ts` PATCH `/hr/attendance/leaves/:id` | **High** |
| Employee detail may use nested `/employees/:id/leaves` while self-service uses `/hr/me/leave-requests` (legacy) | **High** |
| List UI uses `/hr/attendance/leaves` (legacy) not `/hr/leave-requests` | **High** |

---

## 4. Frontend usage

| UI | File | APIs called | Model |
|----|------|-------------|-------|
| Self-service leave | `hr-me-leave.tsx` | `GET /hr/me/leave-balances`, `GET /hr/attendance/leaves`, `POST /hr/me/leave-requests`, policies from Foundation | **Legacy** for submit + list |
| Self-service hub | `self-service.tsx` | Links to `/self-service/leave` | — |
| HR Foundation | `hr-foundation.tsx` | `/hr/foundation/leave-policies` | Policies only (canonical support) |
| Employee detail | `hr-employee-detail.tsx` (expected) | Likely nested leaves API | **Legacy** (typical pattern) |
| Attendance admin | `hr-attendance.tsx` | Attendance + leave list endpoints | **Mixed** |

**UI conflict:** Employee-facing flow does **not** call `leave.ts` canonical endpoints today.

---

## 5. Workflows / forms

| Integration | Status |
|-------------|--------|
| `leave_requests.source_form_id`, `source_submission_id` | Schema supports form-origin requests — **ready when table exists** |
| `leave.ts` bus events / notifications | Referenced in `events/listeners/notifications-bus.ts` (uses `leaveRequestsTable`) — **blocked without table** |
| Workflow engine | Supplementary only per `leave.ts`; must not mutate leave tables directly |
| Generic `approvals` table | **Intentionally not used** (ticketId NOT NULL) |

---

## 6. Migration blockers (checklist)

| # | Blocker | Type |
|---|---------|------|
| 1 | No SQL migration in journal for `leave_requests` / `leave_approval_steps` | DB |
| 2 | Production UI wired to legacy endpoints | Product |
| 3 | Path `/hr/me/leave-requests` semantic lie (legacy writer) | API design |
| 4 | Dual approve/reject paths | API |
| 5 | Possible historical data only in `hr_employee_leaves` | Data migration |
| 6 | Balance logic differs (transactional canonical vs partial legacy) | Business rules |

---

## 7. Required bridge strategy (plan only — not executed)

### Phase L1 — DB (prerequisite)

1. Add Drizzle migration creating `leave_requests` and `leave_approval_steps` matching `hr.ts` schema.
2. Verify on staging with `information_schema` and smoke `POST /hr/leave-requests`.

### Phase L2 — API routing (no new legacy features)

1. **Deprecate** new usage of:
   - `POST /hr/me/leave-requests` (hr.ts)
   - `POST /hr/employees/:id/leaves` (hr.ts) for new clients
2. Point self-service submit to **`POST /hr/leave-requests`** (leave.ts) or shared service layer later.
3. Keep legacy PATCH/list temporarily with `Deprecation` response headers or internal-only.

### Phase L3 — Data bridge

1. One-time script (future): copy `hr_employee_leaves` → `leave_requests` where mappable (status mapping, generate `request_number`, set `business_days_count`).
2. Rows that cannot map → remain legacy + report.

### Phase L4 — UI

1. `hr-me-leave.tsx`: switch list to `GET /hr/leave-requests`, submit to `POST /hr/leave-requests`.
2. Align approve UI for managers with `leave.ts` approve/reject or HR inbox (future).

### Phase L5 — Decommission

1. Remove legacy handlers after traffic zero + retention policy.
2. Archive `hr_employee_leaves` read-only or drop table only after legal/audit sign-off.

---

## 8. Readiness verdict

| Dimension | Status |
|-----------|--------|
| Canonical code exists (`leave.ts`) | **Yes** |
| Canonical DB on clean migrate | **No — blocked** |
| UI aligned | **No** |
| Safe to enable in production today | **No** |
| Safe to plan migration | **Yes** |

**Overall leave migration readiness:** **NOT READY** — blocked on **D1 migration** + **API/UI bridge**.

---

**Confirmation:** No migration run. Documentation only.
