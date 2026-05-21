# P18-C — Leave Execution Phases (Future)

**Date:** 2026-05-19  
**Type:** Roadmap for implementation teams — **not started in P18-C**.

---

## L1 — DB migration

| Item | Detail |
|------|--------|
| **Goal** | Create `leave_requests` + `leave_approval_steps` per SQL plan |
| **Risks** | Wrong FK order; prod DDL timeout |
| **Rollback** | DROP tables if empty; restore snapshot if failed mid-way |
| **Success criteria** | Staging checklist 100%; `POST /hr/leave-requests` returns 201 |

**Deliverables:** Drizzle migration file, journal entry, staging sign-off doc.

---

## L2 — Canonical API verification

| Item | Detail |
|------|--------|
| **Goal** | Prove `leave.ts` invariants on real DB |
| **Risks** | Undiscovered edge cases in approver resolution |
| **Rollback** | N/A (no schema change) |
| **Success criteria** | Automated tests: submit, conflict 409, balance 422, approve, reject, withdraw; notifications fire once |

**Includes:** Employee-scoped list endpoint or permission fix for self-service reads.

---

## L3 — Frontend bridge

| Item | Detail |
|------|--------|
| **Goal** | Switch `hr-me-leave.tsx` + `hr-attendance.tsx` leaves tab to canonical APIs |
| **Risks** | F1/F2 permission errors; status label gaps; user confusion during flag |
| **Rollback** | Feature flag off → legacy APIs |
| **Success criteria** | E2E: employee submit → manager approve → balance updates; no legacy POST in network tab |

---

## L4 — Data migration

| Item | Detail |
|------|--------|
| **Goal** | Copy `hr_employee_leaves` → `leave_requests` per mapping plan |
| **Risks** | R3 double balance; R7 stale balances |
| **Rollback** | Delete canonical rows with `request_number LIKE 'LRQ-MIG-%'`; restore balances from snapshot |
| **Success criteria** | Migration report: 100% eligible rows; reconciliation deltas within tolerance |

**Run:** Off-hours; workspace-by-workspace optional.

---

## L5 — Legacy freeze

| Item | Detail |
|------|--------|
| **Goal** | Stop new legacy writes (`410` on POST legacy paths) |
| **Risks** | Integrations still calling legacy |
| **Rollback** | Re-enable writes temporarily (emergency) |
| **Success criteria** | Zero new rows in `hr_employee_leaves` for 7 days |

---

## L6 — Read-only legacy

| Item | Detail |
|------|--------|
| **Goal** | Legacy PATCH disabled; GET allowed for history |
| **Risks** | HR workflows still patching legacy |
| **Rollback** | Re-open PATCH for emergency |
| **Success criteria** | All approvals via canonical; employee detail shows canonical list |

---

## L7 — Cleanup / deprecation

| Item | Detail |
|------|--------|
| **Goal** | Remove legacy handlers from `hr.ts` (future refactor phase); archive table |
| **Risks** | Audit/legal retention requirements |
| **Rollback** | Keep table indefinitely read-only |
| **Success criteria** | Code paths documented; optional `legacy_*` column removed or retained per compliance |

**Note:** Table drop **not** recommended without legal sign-off (P18-A).

---

## Phase dependency graph

```
L1 → L2 → L3
      ↓
      L4 (after L1, parallel with late L2)
L3 → L5 → L6 → L7
```

---

**Confirmation:** Execution not started.
