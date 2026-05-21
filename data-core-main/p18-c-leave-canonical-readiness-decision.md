# P18-C — Leave Canonical Readiness Decision

**Date:** 2026-05-19  
**Based on:** P18-B audits + P18-C plans in this phase.

---

## Decision matrix

| Question | Verdict | Notes |
|----------|---------|-------|
| Ready to **write** migration SQL (authoring)? | **GO** | Schema fully defined in `hr.ts`; SQL spec in `p18-c-leave-migration-sql-plan.md` |
| Ready to **apply** migration in production? | **BLOCKED** | No journal entry yet; requires L1 staging cycle |
| Ready to **switch UI**? | **BLOCKED** | API permission bugs (F1, F2); DB tables absent on clean env |
| Ready to **enable** canonical leave in production? | **BLOCKED** | Same as above + legacy write path still active |
| Can **legacy APIs be stopped** now? | **BLOCKED** | All production UI depends on legacy |
| Ready for **data migration** (legacy → canonical)? | **PARTIAL** | Mapping plan complete; run only after L1 + L2 |

---

## Remaining blockers

| # | Blocker | Owner phase |
|---|---------|-------------|
| B1 | `leave_requests` / `leave_approval_steps` not in Drizzle journal / baseline DB | P18-D L1 |
| B2 | Self-service list uses `hr.manage` endpoint | P18-D L2/L3 |
| B3 | Policies fetch requires `hr.view` for employees | P18-D L2/L3 |
| B4 | No HR baseline tests for leave | P18-D (parallel track) |
| B5 | HR-on-behalf canonical API missing | Backlog (post cutover) |
| B6 | Dual balance paths during coexistence | L5 freeze ordering |

---

## Prerequisites before execution (P18-D)

1. **L1:** Generate and apply migration on staging; run SQL verification checklist.
2. **L2:** Smoke `leave.ts` endpoints; add minimal API tests (submit, approve, conflict, balance).
3. **L2b:** Add `GET /hr/leave-requests` employee scope test; fix or add `/hr/me/*` list if needed.
4. **L3:** Frontend flag on staging only.
5. **L4:** Data migration dry-run + reconciliation report sign-off.
6. **L5:** Legacy write freeze in production.
7. **L6:** Legacy read-only.

---

## GO / PARTIAL / BLOCKED summary

| Axis | Status |
|------|--------|
| Migration authoring | **GO** |
| Migration apply (prod) | **BLOCKED** |
| Canonical API (code exists) | **PARTIAL** (needs DB + tests) |
| UI transition | **BLOCKED** |
| Data migration | **PARTIAL** |
| Legacy API retirement | **BLOCKED** |

---

## Recommended immediate next phase

**P18-D — Leave DB Migration & Staging Verification**

**Rationale:** Unblocks everything else; tests can start in parallel once L1 exists on CI DB but **DDL is the critical path**. HR baseline tests without leave tables cannot validate canonical paths.

**Defer:** P18-D HR Baseline Tests as primary only if CI cannot run migrations — not recommended per readiness.

---

**Confirmation:** Decision document only.
