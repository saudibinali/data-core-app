# P18-B — Refactor Readiness Decision

**Date:** 2026-05-19  
**Inputs:** All `p18-b-*.md` audits + P18-A architecture docs.

---

## Decision matrix

| Axis | Verdict | Rationale |
|------|---------|-----------|
| Split / decompose `hr.ts` | **PARTIAL** | Boundaries are clear (~4,159 lines, ~45 sections), but **zero HR tests** and inconsistent guards make split **risky** without baseline tests |
| Enable canonical `leave_requests` | **BLOCKED** | Tables **not in baseline migration**; UI + `POST /hr/me/leave-requests` still on legacy; API path conflict |
| HR granular permissions | **BLOCKED** | Coarse `hr.manage`; `self_service.view` registry gap; payroll uses `requireWorkspaceAdmin`; redesign explicitly deferred |
| Add new ERP domains (Finance, recruitment, LMS, etc.) | **BLOCKED** | Migration drift, dual leave model, no test baseline, permission gaps — would compound debt |

**Legend:** **GO** = safe to start now · **PARTIAL** = start only with named prerequisites · **BLOCKED** = do not start until prerequisites met

---

## Production blockers (must fix before production canonical leave)

1. **D1:** `leave_requests` + `leave_approval_steps` absent from `0000_sad_midnight.sql` / Drizzle journal
2. **API/UI:** Self-service uses legacy endpoints; misleading `POST /hr/me/leave-requests`
3. **Environment runbook:** P16 tables may require `apply-p16-tables.cjs` — drift on fresh installs

**Not HR-specific but affects workspace app:**

4. **users** table platform columns missing from baseline migration (platform auth)

---

## Fix first (ordered)

| Priority | Item | Phase |
|----------|------|-------|
| 1 | Migration plan + SQL for `leave_requests` / `leave_approval_steps` | P18-C Leave plan |
| 2 | Bridge strategy: UI → canonical APIs; deprecate legacy paths | P18-C Leave plan |
| 3 | Minimal HR API test baseline (~35–45 tests) | P18-C Tests **or** parallel after L1 |
| 4 | Document environment apply scripts (P16/P17) | Ops runbook |
| 5 | Register `self_service.view` + document ESS auth-only API | Future permission phase |
| 6 | Split `hr.ts` | After tests + leave bridge stable |
| 7 | Granular HR permissions | After split + registry design |
| 8 | Catalog enforcement (status/contract types) | Data quality phase |

---

## Defer (explicitly)

- `hr.ts` file split implementation
- Permissions redesign / role matrix expansion
- Finance / recruitment / LMS / performance modules
- Dropping `hr_employee_leaves` table
- Fixing catalog semantic drift (unless blocking leave migration)
- Workflow schema version migration (unless HR services blocked)

---

## Per-axis detail

### A. `hr.ts` decomposition — **PARTIAL**

**GO signals:** Section markers, domain boundaries documented in `p18-b-hr-route-complexity-audit.md`.  
**BLOCK signals:** 0% route test coverage; 27 DELETE endpoints; no transactions on payroll process.  
**Prerequisite:** P18-C baseline tests at minimum (employees + payroll smoke + one foundation test).

### B. Canonical leave — **BLOCKED**

**Prerequisite:** DB migration + UI/API bridge (see `p18-b-leave-migration-readiness.md`).  
**Do not** enable `leave.ts` in production on journal-only DB.

### C. Granular permissions — **BLOCKED**

**Prerequisite:** Registry completeness, split routes, product decision on payroll/ESS.  
P18-A explicitly deferred permission redesign.

### D. New ERP domains — **BLOCKED**

**Prerequisite:** Stable workspace HR baseline, single leave model, test harness, subscription model clarity.

---

## Recommended sequencing (post P18-B)

```
P18-C (one of) → leave DB + bridge OR tests baseline
       ↓
P18-D (future) → hr.ts split
       ↓
P18-E (future) → granular permissions
       ↓
P19+           → new ERP domains
```

---

## Single next phase recommendation

**Primary:** **P18-C — Leave Canonical Migration Plan**  
**Reason:** Critical migration drift (D1) is a **production blocker** for canonical leave; `leave.ts` already exists; UI/API conflict is user-visible; tests alone do not unblock leave.

**Secondary (can follow immediately after L1 migration):** P18-C — HR Baseline Tests Implementation.

---

**Confirmation:** No refactor performed. Decision document only.
