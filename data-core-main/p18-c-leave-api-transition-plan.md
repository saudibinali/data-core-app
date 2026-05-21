# P18-C — Leave API Transition Plan

**Date:** 2026-05-19  
**Type:** Planning only — no route changes.

---

## 1. API inventory

### 1.1 Legacy APIs (`hr.ts`)

| Method | Path | Permission | Table | Writes balance |
|--------|------|------------|-------|----------------|
| GET | `/hr/employees/:id/leaves` | `hr.view` | `hr_employee_leaves` | No |
| POST | `/hr/employees/:id/leaves` | `hr.manage` | `hr_employee_leaves` | No |
| PATCH | `/hr/employees/:id/leaves/:lid` | `hr.manage` | `hr_employee_leaves` | No |
| POST | `/hr/me/leave-requests` | `requireAuth` only | `hr_employee_leaves` | Optional `pending` |
| GET | `/hr/attendance/leaves` | `hr.manage` | `hr_employee_leaves` | No |
| PATCH | `/hr/attendance/leaves/:id` | `hr.manage` | `hr_employee_leaves` | Yes (pending/used) |
| GET | `/hr/me/leave-balances` | `requireAuth` | `hr_leave_balances` | No |
| GET/POST/PATCH | `/hr/leave-balances*` | `hr.manage` / admin | `hr_leave_balances` | Admin |

### 1.2 Canonical APIs (`leave.ts`)

| Method | Path | Permission | Table |
|--------|------|------------|-------|
| POST | `/hr/leave-requests` | `requireAuth` | `leave_requests` + steps + balance |
| GET | `/hr/leave-requests` | `requireAuth` | `leave_requests` (scoped) |
| GET | `/hr/leave-requests/:id` | `requireAuth` | + `leave_approval_steps` |
| PATCH | `/hr/leave-requests/:id/approve` | `requireAuth` + approver logic | |
| PATCH | `/hr/leave-requests/:id/reject` | `requireAuth` + approver logic | |
| PATCH | `/hr/leave-requests/:id/withdraw` | `requireAuth` + owner | |

**Mount:** `routes/index.ts` registers `leaveRouter` after workspace guards.

---

## 2. Conflicts

| Conflict | Severity | Description |
|----------|----------|-------------|
| C1 | **Critical** | `POST /hr/me/leave-requests` vs `POST /hr/leave-requests` — same product action, different tables |
| C2 | **High** | Two approve paths: `PATCH /hr/attendance/leaves/:id` vs `PATCH /hr/leave-requests/:id/approve` |
| C3 | **High** | Self-service list uses `GET /hr/attendance/leaves` which requires **`hr.manage`** — employees get 403 |
| C4 | **Medium** | `daysCount` (client) vs `businessDaysCount` (server) — legacy accepts client days |
| C5 | **Medium** | Status vocab: legacy `pending` vs canonical `pending_approval` |
| C6 | **Low** | HR employee nested CRUD vs canonical admin create (no dedicated HR-on-behalf canonical route yet) |

---

## 3. Transitional routing strategy (future implementation)

### Phase T0 — DB only (L1)

- Canonical endpoints exist; **no UI change**.
- Internal/staging tests call `POST /hr/leave-requests`.

### Phase T1 — Dual-write (optional, **not recommended**)

- Single handler writes both tables — **rejected** due to double balance risk.
- Prefer **single write canonical** + read merge.

### Phase T2 — Read merge API (optional bridge)

- New read endpoint or extended GET returns `legacy[] + canonical[]` with `source: "legacy"|"canonical"` — **only if needed** before data migration.
- Simpler approach: migrate data first, then switch reads.

### Phase T3 — Write redirect (recommended)

| Legacy endpoint | Behavior during bridge |
|-----------------|------------------------|
| `POST /hr/me/leave-requests` | **307/deprecated header** → internally call canonical submit OR return 410 with message to use new path |
| `POST /hr/employees/:id/leaves` | HR proxy: `POST /hr/leave-requests` with `employeeId` override (future) or 410 |
| `PATCH /hr/attendance/leaves/:id` | 410 after manager UI on canonical |

---

## 4. Deprecation phases

| Phase | Legacy writes | Legacy reads | Canonical writes | Canonical reads |
|-------|---------------|--------------|------------------|-----------------|
| **D0** (today) | Allowed | Allowed | Allowed (if DB exists) | Allowed |
| **D1** L1 DB | Allowed | Allowed | Staging only | Staging |
| **D2** L3 UI bridge | Discouraged | Allowed | **Primary for self-service** | UI switched |
| **D3** L5 freeze | **410** new legacy | Allowed | Primary | Primary |
| **D4** L6 read-only | **410** | Merge/historical only | Primary | Primary |
| **D5** L7 cleanup | **410** | Deprecated endpoint | Primary | Primary |

**Deprecation headers:** `Deprecation: true`, `Link: </hr/leave-requests>; rel="successor-version"`.

---

## 5. Frontend cutover timing

| Surface | Switch when |
|---------|-------------|
| `hr-me-leave.tsx` submit | L3 — after DB L1 verified |
| `hr-me-leave.tsx` list | L3 — use `GET /hr/leave-requests` (employee scope) |
| `hr-attendance.tsx` approve | L3/L4 — `PATCH .../approve|reject` |
| `hr-employee-detail.tsx` leaves tab | L4 — after data migration or read merge |

**Do not switch UI before L1 staging verification.**

---

## 6. New legacy write freeze

**Criteria:**

- Canonical POST success rate > 99% on staging for 1 week
- Data migration dry-run report clean
- Balance reconciliation script signed off

**Effect:** `POST /hr/me/leave-requests`, `POST /hr/employees/:id/leaves` return **410 Gone** with error body pointing to canonical path.

---

## 7. Legacy read-only

**Criteria:**

- All active pending legacy rows migrated or closed
- No legacy writes for 30 days (configurable)

**Effect:**

- Legacy PATCH returns 410
- GET legacy endpoints remain for history or return merged view

---

## 8. HR-on-behalf gap

Canonical `POST /hr/leave-requests` submits for **authenticated user’s employee record** only.

**Gap:** HR creating leave for another employee via `/hr/employees/:id/leaves` has **no canonical equivalent** yet.

**Future (not P18-C):** `POST /hr/leave-requests` body `employeeId` + `hr.manage` permission — document in backlog, not implemented now.

---

**Confirmation:** No API changes in P18-C.
