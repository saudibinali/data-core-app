# P18-C — Leave Data Integrity & Risk Audit

**Date:** 2026-05-19  
**Type:** Risk analysis + mitigations only (no fixes).

---

## 1. Risk register

| ID | Risk | Level | Description |
|----|------|-------|-------------|
| R1 | Duplicate leave rows | **Critical** | Legacy + canonical both accept overlapping date ranges; user could have rows in both tables |
| R2 | Double approval | **High** | Approve legacy row while canonical pending for same dates |
| R3 | Double balance deduction | **Critical** | Legacy `POST /hr/me/leave-requests` bumps `pending`; canonical submit also reserves `pending` for same policy/year |
| R4 | Race on balance | **High** | Legacy updates without `FOR UPDATE`; canonical uses row lock in transaction |
| R5 | Partial failure (legacy) | **High** | Insert leave then balance update — not transactional in `hr.ts` |
| R6 | Rollback after migrate | **Medium** | Dropping canonical tables loses migrated history if legacy was frozen |
| R7 | Stale balances | **Critical** | Legacy approve/reject math uses `days_count` not `business_days_count`; migration reconciliation errors |
| R8 | Notification duplication | **Medium** | If both paths emitted events (legacy does not today); dual-write would duplicate |
| R9 | Workflow duplication | **Low** | Form `hr.form.submitted` + canonical `leave.requested` if form wired twice |
| R10 | Cross-workspace leakage | **Critical** | IDOR if `:id` routes omit `workspace_id` — canonical routes include workspace filter (verified static) |
| R11 | request_number collision | **Low** | Random 4-digit; DB unique constraint + retry on submit |
| R12 | Self-service 403 | **High** | UI calls admin list API — operational “no data” not integrity but masks real rows |
| R13 | HR-on-behalf gap | **Medium** | HR keeps using legacy POST while employees use canonical → split brain |
| R14 | Withdraw without UI | **Medium** | Pending canonical requests stuck if only legacy UI |

---

## 2. Detailed analysis

### R1 — Duplicate leave rows

**Scenario:** Employee submits via legacy; later via canonical for overlapping dates.

**Mitigation:**

- L5 write freeze on legacy before broad canonical UI rollout.
- Canonical conflict check only scans `leave_requests` — **add** legacy overlap check in bridge period OR migrate legacy first.
- Data migration: report overlapping legacy rows pre-migrate.

### R2 — Double approval

**Scenario:** Manager approves in Attendance (legacy) and another approves canonical request.

**Mitigation:**

- L3 switch manager UI to canonical only.
- L5 disable `PATCH /hr/attendance/leaves/:id`.

### R3 — Double balance deduction

**Scenario:** Same employee, same policy — legacy pending + canonical pending.

**Mitigation:**

- **Never** dual-write.
- Reconciliation script: sum pending/used per policy/year vs sum of open requests.
- L5 freeze legacy writes before enabling canonical submit in prod.

### R4 — Race conditions

**Scenario:** Two canonical submits concurrently.

**Mitigation:** Already mitigated in `leave.ts` via `for("update")` on balance row — **keep** single canonical write path.

### R5 — Partial failures (legacy)

**Scenario:** Leave row created; balance update fails — inconsistent.

**Mitigation:** Freeze legacy; canonical-only writes use transaction.

### R6 — Rollback risks

**Mitigation:** Backup before L1; do not drop legacy table; feature-flag canonical.

### R7 — Stale balances

**Scenario:** `days_count` null on legacy; client sent wrong days; business days differ.

**Mitigation:** Migration uses `calcBusinessDays`; post-migrate reconciliation job per employee.

### R8 — Notification duplication

**Current:** Legacy does not emit `leave.requested`.

**Mitigation:** Do not add bus events to legacy handlers; canonical only.

### R9 — Workflow duplication

**Mitigation:** Forms stay on `hr.form.submitted` until form submission creates canonical row via dedicated integration.

### R10 — Cross-workspace leakage

**Mitigation:**

- Staging tests: cross-workspace ID access on `GET /hr/leave-requests/:id` → 404.
- Code review: every query includes `workspace_id`.

### R11 — request_number collision

**Mitigation:** Retry on unique violation; migration uses deterministic `LRQ-MIG-*`.

### R12 — Self-service list API

**Mitigation:** L3 prerequisite API fix before UI (employee-scoped list).

### R13 — HR-on-behalf

**Mitigation:** Until canonical HR submit exists, keep employee detail on legacy **read-only** after employee self-service cutover.

### R14 — Withdraw

**Mitigation:** Add withdraw action in L3 UI or document HR manual reject.

---

## 3. Transaction safety comparison

| Path | Transaction | Balance lock |
|------|-------------|--------------|
| `leave.ts` submit/approve/reject/withdraw | Yes | `for("update")` on balance |
| `hr.ts` POST `/hr/me/leave-requests` | No | No |
| `hr.ts` PATCH `/hr/attendance/leaves/:id` | No | No |

---

## 4. Mitigation summary (execution order)

1. L1 — DDL only, no UI.
2. L2 — API verification + automated tests.
3. L5 — Legacy write freeze **before** L3 production UI flag.
4. L4 — Data migration + balance reconciliation.
5. L6 — Legacy read-only.

---

**Confirmation:** Mitigations documented only; no code changes.
