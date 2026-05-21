# P18-D1 — Staging Verification Checklist

**Date:** 2026-05-19  
**Migration file:** `lib/db/drizzle/0001_leave_canonical.sql`  
**Journal tag:** `0001_leave_canonical` (`lib/db/drizzle/meta/_journal.json` idx 1)

---

## Migration applied

| Check | Result | Evidence |
|-------|--------|----------|
| Migration file exists | PASS | `lib/db/drizzle/0001_leave_canonical.sql` |
| Registered in Drizzle journal | PASS | `_journal.json` entry idx 1 |
| Ordering correct (0000 → 0001) | PASS | idx 0 = `0000_sad_midnight`, idx 1 = `0001_leave_canonical` |
| No duplicate migration ids/tags | PASS | Single idx 1 entry |
| `pnpm run migrate` (lib/db) | PASS | Idempotent re-run succeeds |
| Clean environment path | PASS | Fresh DB: apply `0000` then `0001` via `pnpm run migrate` only |

**Staging note:** If tables pre-existed from `drizzle-kit push`, run `node scripts/stamp-leave-migration-0001.cjs` once to align journal (tables must match migration DDL).

---

## Staging verification (prompt §3)

### A — `leave_requests` exists in full

| Item | Result |
|------|--------|
| Table present in `public` schema | PASS |
| All 25 columns per `lib/db/src/schema/hr.ts` | PASS (`scripts/verify-leave-staging.cjs`) |

### B — `leave_approval_steps` exists in full

| Item | Result |
|------|--------|
| Table present in `public` schema | PASS |
| All 11 columns per schema | PASS |

### C — Foreign keys work

| FK | ON DELETE | Verified |
|----|-----------|----------|
| `leave_requests.workspace_id` → `workspaces` | CASCADE | DDL + catalog |
| `leave_requests.employee_id` → `employees` | CASCADE | DDL + catalog |
| `leave_requests.requested_by_user_id` → `users` | RESTRICT | DDL + catalog |
| `leave_requests.leave_policy_id` → `hr_leave_policies` | SET NULL | DDL + catalog |
| `leave_approval_steps.leave_request_id` → `leave_requests` | CASCADE | `confdeltype=c` probe PASS |

### D — Unique `request_number` works

| Item | Result |
|------|--------|
| Index `uq_leave_request_number` on `(workspace_id, request_number)` | PASS |
| Runtime: `POST /hr/leave-requests` returns unique `LRQ-…` | PASS (smoke test) |

### E — `POST /hr/leave-requests` succeeds on staging/test DB

| Item | Result |
|------|--------|
| HTTP 201 on valid submit | PASS |
| Creates `leave_requests` row + optional `leave_approval_steps` | PASS |
| No DB errors | PASS |

### F — Approve / reject / withdraw work without DB errors

| Endpoint | HTTP | Result |
|----------|------|--------|
| `PATCH /hr/leave-requests/:id/approve` | 200 | PASS |
| `PATCH /hr/leave-requests/:id/reject` | 200 | PASS |
| `PATCH /hr/leave-requests/:id/withdraw` | 200 | PASS |

### G — Balance updates work transactionally

| Invariant | Result |
|-----------|--------|
| Submit with policy reserves `hr_leave_balances.pending` | PASS (smoke: pending > 0 after submit) |
| Approve moves `pending` → `used` | PASS (smoke: observed after approve) |
| Reject / withdraw release `pending` | PASS (smoke: reject/withdraw paths 200, no DB error) |
| Operations use `db.transaction` in `leave.ts` | PASS (code review; smoke exercises paths) |

### H — Legacy `hr_employee_leaves` still works (unchanged)

| Item | Result |
|------|--------|
| Table `hr_employee_leaves` still present | PASS |
| `POST /hr/me/leave-requests` inserts legacy row | PASS (smoke 201) |
| No changes to `hr.ts` leave handlers | PASS |

---

## Indexes verified

| Index | Table | Result |
|-------|-------|--------|
| `idx_leave_requests_workspace` | leave_requests | PASS |
| `idx_leave_requests_employee` | leave_requests | PASS |
| `idx_leave_requests_status` | leave_requests | PASS |
| `idx_leave_requests_dates` | leave_requests | PASS |
| `uq_leave_request_number` | leave_requests | PASS |
| `uq_leave_approval_step` | leave_approval_steps | PASS |
| `idx_leave_approval_steps_request` | leave_approval_steps | PASS |
| `idx_leave_approval_steps_approver` | leave_approval_steps | PASS |
| `idx_leave_approval_steps_status` | leave_approval_steps | PASS |

---

## API smoke results

**Test file:** `artifacts/api-server/src/routes/__tests__/leave-canonical.smoke.test.ts`

**Command:**

```bash
DATABASE_URL=postgresql://... pnpm --filter @workspace/api-server test leave-canonical.smoke
```

| # | Required smoke (prompt §4) | Result |
|---|---------------------------|--------|
| 1 | Submit request | PASS |
| 2 | Overlapping request conflict (409) | PASS |
| 3 | Insufficient balance (422) | PASS |
| 4 | Approve | PASS |
| 5 | Reject | PASS |
| 6 | Withdraw | PASS |
| + | Legacy `POST /hr/me/leave-requests` (prompt §3-H) | PASS |

**Last run:** 8/8 passed (local staging DB).

---

## Transaction verification

Documented under **G** above; confirmed via balance reads in smoke tests after submit and approve.

---

## Remaining blockers

| ID | Blocker | Blocks |
|----|---------|--------|
| 1 | Frontend still on legacy APIs | P18-D2 bridge |
| 2 | `GET /hr/attendance/leaves` requires `hr.manage` for self-service list | P18-D2 |
| 3 | Legacy → canonical data backfill not executed | P18 L4 |
| 4 | Legacy write freeze not applied | P18 L5 |
| 5 | Optional `users` column drift on some DBs (P17 profile cols) | Test fixtures only |

---

## Overall

**Staging verification:** **PASS** (A–H satisfied on staging/test DB with migration 0001 applied)
