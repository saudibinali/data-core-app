# P18-C — Canonical Leave Architecture Plan

**Date:** 2026-05-19  
**Type:** Planning / design only (no implementation)

**References:** P18-A decisions, P18-B drift/readiness audits, `lib/db/src/schema/hr.ts`, `routes/leave.ts`, `routes/hr.ts`.

---

## 1. Current legacy system

### 1.1 Data

| Artifact | Role |
|----------|------|
| `hr_employee_leaves` | Ad-hoc leave rows per employee |
| `hr_leave_balances` | Structured balances (also used by legacy paths) |
| `hr_leave_policies` | Policy catalog (`requires_approval`, `leave_type`) |

**Legacy row shape:** `leave_type`, `start_date`, `end_date`, `days_count` (optional), `status` (`pending` \| `approved` \| `rejected` \| `cancelled`), `reason`, `notes`, single `approved_by` / `approved_at`, no `request_number`, no approval chain table.

### 1.2 APIs (`hr.ts`)

| Endpoint | Behavior |
|----------|----------|
| `GET/POST/PATCH /hr/employees/:id/leaves` | HR admin CRUD on legacy table |
| `POST /hr/me/leave-requests` | **Misnamed** — inserts `hr_employee_leaves`, optional balance `pending` bump (non-transactional) |
| `GET /hr/attendance/leaves` | Admin list (requires `hr.manage`) |
| `PATCH /hr/attendance/leaves/:id` | Approve/reject legacy + balance move |
| `GET /hr/me/leave-balances` | Self-service balances (canonical table) |

### 1.3 UI

- **Self-service:** `hr-me-leave.tsx` → legacy POST + admin list API (permission mismatch — see frontend plan).
- **Attendance admin:** `hr-attendance.tsx` → legacy list/approve.
- **Employee detail:** `hr-employee-detail.tsx` → nested legacy CRUD.

### 1.4 Characteristics

- No overlap/conflict detection across requests.
- No `request_number` or audit-grade lifecycle.
- Balance updates may run **outside** a transaction with row insert.
- No bus events / notifications for legacy path.

---

## 2. Canonical system (target)

### 2.1 Data

| Table | Role |
|-------|------|
| `leave_requests` | Single source of truth for leave lifecycle |
| `leave_approval_steps` | Domain-specific approval chain (Phase 1: single step) |
| `hr_leave_balances` | Balance ledger (`entitled`, `used`, `pending`) |
| `hr_leave_policies` | Rules including `requires_approval` |

### 2.2 APIs (`leave.ts`)

| Endpoint | Role |
|----------|------|
| `POST /hr/leave-requests` | Submit (transactional) |
| `GET /hr/leave-requests` | List (HR all / employee own) |
| `GET /hr/leave-requests/:id` | Detail + steps |
| `PATCH .../approve` \| `reject` \| `withdraw` | State machine + balance |

### 2.3 Lifecycle states (`leave_requests.status`)

```
pending → pending_approval → approved | rejected
pending / pending_approval → withdrawn (employee)
approved → cancelled (HR/admin — deferred API in leave.ts header)
```

**Balance rules (from schema comments, enforced in `leave.ts`):**

| Event | Balance effect |
|-------|----------------|
| INSERT + requires approval | `pending += businessDaysCount` |
| INSERT + auto-approve | `used += businessDaysCount` |
| Approved | `pending -= days`, `used += days` |
| Rejected / withdrawn / cancelled | Release `pending` if was reserved |

**Day counts:**

- `days_requested` — calendar inclusive (server-computed).
- `business_days_count` — work calendar + holidays (`calcBusinessDays`); used for balance and conflicts.

### 2.4 Approval model

- Phase 1: **one** `leave_approval_steps` row (`step_order = 1`).
- Approver resolution: direct manager’s `user_id` → fallback workspace admin.
- Step statuses: `pending` \| `approved` \| `rejected` \| `skipped`.
- `current_approver_id` on request denormalized for notifications.

### 2.5 Request numbering

- Format: `LRQ-{YYYY}{MM}-{4-digit-random}` (`generateRequestNumber()`).
- Uniqueness: `uniqueIndex` on `(workspace_id, request_number)`.
- Migration rows: use `LRQ-MIG-{legacyId}` or counter-based scheme (see mapping plan).

### 2.6 Transactions

All submit/approve/reject/withdraw paths use **`db.transaction`** in `leave.ts`. Legacy `hr.ts` paths do **not**.

### 2.7 Workflow integration

- **Forms:** `source_form_id`, `source_submission_id` on `leave_requests` for form-originated requests.
- **Seed forms:** `forms.ts` documents that generic form submit must **not** emit `leave.requested` until canonical route creates a row (contract requires `leaveRequestId`, computed days).
- **WorkflowEngine:** Supplementary via bus events; must **not** mutate `leave_requests` or balances directly (`leave.ts` header).

### 2.8 Notifications integration

`notifications-bus.ts` listens to bus events from `leave.ts`:

| Event | Notification type | Recipient |
|-------|-------------------|-----------|
| `leave.requested` | `leave_request` | `currentApproverId` |
| `leave.approved` | (employee) | `employeeUserId` |
| `leave.rejected` | (employee) | `employeeUserId` |
| `leave.withdrawn` | (approver) | step approver |

Idempotency keys per `leaveRequestId` reduce duplicates.

### 2.9 Activity / audit

`activity.ts` listener writes `leave_requested`, `leave_approved`, etc. to activity logs from the same bus events.

**Audit implications:**

- Canonical rows carry `request_number`, `requested_by_user_id`, approval actor IDs/timestamps, and immutable step history.
- Legacy rows lack request numbers and multi-step audit; migrated rows should set `created_at` from legacy and add synthetic approval step where possible.

---

## 3. Ownership boundaries

| Data | Scope | Access rule |
|------|-------|-------------|
| `leave_requests`, `leave_approval_steps`, `hr_leave_balances` | `workspace_id` | All queries filter by authenticated workspace |
| Employee linkage | `employee_id` within workspace | Self-service resolves via `employees.user_id = req.userId` |
| Approver | `users.id` within workspace | Manager/admin fallback |

**No cross-workspace joins** without `workspace_id` predicate on both sides.

---

## 4. What becomes what

| Item | Classification | Notes |
|------|----------------|-------|
| `leave_requests` + `leave_approval_steps` | **Canonical** | All new leave features |
| `hr_leave_balances` | **Canonical** | Shared by both paths today |
| `hr_leave_policies` | **Canonical** | Foundation catalog |
| `hr_employee_leaves` | **Legacy → read-only** (after migration) | No new writes after freeze |
| `POST /hr/me/leave-requests` (hr.ts) | **Deprecated** (later) | Misleading name |
| `routes/leave.ts` | **Canonical API** | Already implemented |
| Legacy list/approve in `hr.ts` | **Deprecated** (later) | Replace with canonical |
| `employees.leave_balances` jsonb | **Non-canonical** (P18-A) | Do not extend |

---

## 5. Deprecation timeline (conceptual — execution in L5–L7)

1. **Coexistence:** Both tables populated; UI on legacy, canonical available for testing.
2. **Write freeze:** New legacy inserts return 410/redirect.
3. **Read-only legacy:** Lists merge or dual-read.
4. **Archive:** `hr_employee_leaves` retained for audit; optional `legacy_leave_id` column on canonical (future, not in current schema).

---

**Confirmation:** Architecture plan only — no schema or code changes.
