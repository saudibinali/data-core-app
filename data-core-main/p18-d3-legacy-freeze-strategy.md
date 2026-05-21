# P18-D3 — Legacy Leave Freeze Strategy

**Date:** 2026-05-19  
**Status:** Documented only — **not applied** in P18-D3.

---

## 1. Objectives

Stop new inconsistent writes to `hr_employee_leaves` while preserving read access for history and rollback.

---

## 2. Freeze timeline (planned)

| Phase | When | Legacy POST | Legacy PATCH | Legacy GET |
|-------|------|-------------|--------------|------------|
| **Now (D2–D3)** | Active | Allowed | Allowed | Allowed |
| **Soft freeze (D4 pilot)** | Per workspace flag | 410 + message | Allowed for open legacy pending | Allowed |
| **Hard freeze (D4+)** | All prod workspaces | 410 | 410 except read | Allowed |
| **Read-only (D6)** | Post-migration | 410 | 410 | Allowed |

---

## 3. When to block legacy submit

**Gate (all required):**

1. `CANONICAL_LEAVE_SUBMIT` enabled and stable ≥ 14 days in pilot workspace.
2. Data migration batch complete for that workspace.
3. Support runbook published.
4. `LEGACY_LEAVE_FREEZE` ready (env + code path in `hr.ts` — **wired in P18-D4**, not D3).

**Affected routes:**

- `POST /hr/me/leave-requests`
- `POST /hr/employees/:id/leaves`

**Response (planned):** `410 Gone` + `{ error, code: "LEGACY_LEAVE_FROZEN", use: "POST /hr/leave-requests" }`

---

## 4. When legacy APIs become read-only

| Route | Read-only means |
|-------|-----------------|
| `PATCH /hr/attendance/leaves/:id` | 410 on freeze |
| `PATCH /hr/employees/:id/leaves/:lid` | 410 on freeze |
| `GET` list endpoints | Remain 200 for audit/history |

**Timing:** After canonical approval UI enabled and no open legacy `pending` rows (or all migrated to `pending_approval`).

---

## 5. Preventing duplicate inserts

| Control | Owner |
|---------|-------|
| Never dual-write | Architecture (enforced) |
| Legacy freeze before broad canonical submit | Ops flag |
| Canonical overlap check | `leave_requests` only today — **add legacy overlap check in P18-D4** before submit cutover |
| Migration idempotency | `LRQ-MIG-{legacyId}` unique |
| UI dedup badges | Frontend P18-D4 |

---

## 6. Preventing balance double-processing

| Risk | Mitigation |
|------|------------|
| Legacy pending + canonical pending | Freeze legacy writes first |
| Approve both rows same dates | Freeze legacy PATCH; single approval UI |
| Migration double-count | Reconciliation script per `p18-c-legacy-to-canonical-mapping-plan.md` §7 |
| Legacy non-transactional balance | Freeze; canonical uses `FOR UPDATE` in transaction |

**Emergency query (monitoring):**

```sql
-- Pending balance vs open requests (per employee/policy/year)
SELECT b.employee_id, b.leave_policy_id, b.year,
       b.pending::numeric AS balance_pending,
       COALESCE(SUM(lr.business_days_count) FILTER (
         WHERE lr.status IN ('pending_approval','pending')
       ), 0) AS canonical_open_days
FROM hr_leave_balances b
LEFT JOIN leave_requests lr ON lr.employee_id = b.employee_id
  AND lr.leave_policy_id = b.leave_policy_id
  AND EXTRACT(YEAR FROM lr.start_date::date) = b.year
GROUP BY 1,2,3,b.pending;
```

---

## 7. Open sessions & stale clients

| Scenario | Handling |
|----------|----------|
| Browser tab open during freeze | Next submit returns 410; show banner “Refresh — leave system updated” |
| Mobile cache | Short cache headers on leave list; version bump in API error payload |
| HR mid-approval on legacy row | Complete before freeze window OR migrate row first |
| In-flight legacy POST | Rare race: freeze returns 410; user retries canonical |

**Communication:** In-app banner when `VITE_LEGACY_LEAVE_FREEZE=true`.

---

## 8. Feature flags

| Flag | Env (API) | Purpose |
|------|-----------|---------|
| `canonicalLeaveRead` | `CANONICAL_LEAVE_READ` | Documented; D2 already reads canonical |
| `canonicalLeaveSubmit` | `CANONICAL_LEAVE_SUBMIT` | Gate new writes |
| `canonicalLeaveApprove` | `CANONICAL_LEAVE_APPROVE` | Gate manager UI |
| `legacyLeaveFreeze` | `LEGACY_LEAVE_FREEZE` | Return 410 on legacy writes |

**Module:** `artifacts/api-server/src/lib/leave-cutover-flags.ts`  
**Frontend mirror:** `artifacts/ops-platform/src/lib/leave-cutover-flags.ts`

**P18-D3:** Flags exist; routes **not** wired to 410 yet.

---

## 9. Rollback switch

| Action | Steps |
|--------|-------|
| Disable freeze | `LEGACY_LEAVE_FREEZE=false` + redeploy |
| Re-enable legacy submit | `CANONICAL_LEAVE_SUBMIT=false` if canonical unstable |
| Data | Do **not** delete `leave_requests` on rollback; legacy table unchanged |

**Rollback SLA target:** < 15 minutes via env flip (no schema change).

---

**Confirmation:** Freeze strategy documented only. Not enforced in P18-D3.
