# P18-D4 — Pilot Rollout Report

**Date:** 2026-05-19  
**Phase:** Controlled production cutover (single pilot workspace)

---

## Pilot workspace configuration

| Setting | Env var | Notes |
|---------|---------|-------|
| Pilot workspace ID | `LEAVE_CUTOVER_PILOT_WORKSPACE_ID` | **Must** match target workspace numeric id |
| Canonical submit | `CANONICAL_LEAVE_SUBMIT=true` | Pilot only |
| Canonical approve | `CANONICAL_LEAVE_APPROVE=true` | Pilot only |
| Legacy freeze | `LEGACY_LEAVE_FREEZE=true` | Pilot only — 410 on legacy writes |

**Frontend (ops-platform):**

| `VITE_CANONICAL_LEAVE_SUBMIT` | Build-time mirror (optional) |
| `VITE_CANONICAL_LEAVE_APPROVE` | Build-time mirror (optional) |
| `VITE_LEGACY_LEAVE_FREEZE` | Build-time mirror (optional) |

**Effective UI flags:** `GET /api/hr/leave-cutover/status` (workspace-scoped).

---

## Production activation checklist

1. Set env vars on API + redeploy ops-platform.
2. `DRY_RUN=1 WORKSPACE_ID=<pilot> node scripts/migrate-leave-pilot.cjs`
3. Review dry-run JSON (`inserted` count).
4. `WORKSPACE_ID=<pilot> node scripts/migrate-leave-pilot.cjs`
5. `WORKSPACE_ID=<pilot> node scripts/reconcile-leave-pilot.cjs` → `ok: true`
6. Smoke: employee canonical submit; HR canonical approve; legacy POST → 410.
7. Monitor `GET /api/hr/leave-cutover/metrics` (hr.manage).

---

## Migration execution (pilot)

**Script:** `scripts/migrate-leave-pilot.cjs`

| Property | Value |
|----------|-------|
| Idempotency key | `request_number = LRQ-MIG-{legacyId}` |
| Legacy rows deleted | **No** |
| Dual-write | **No** |

**Dry-run example:**

```bash
DATABASE_URL=... WORKSPACE_ID=123 DRY_RUN=1 node scripts/migrate-leave-pilot.cjs
```

**Actual run:**

```bash
DATABASE_URL=... WORKSPACE_ID=123 node scripts/migrate-leave-pilot.cjs
```

---

## Reconciliation

**Script:** `scripts/reconcile-leave-pilot.cjs`

Checks:

- No duplicate `request_number`
- No `pending_approval` without approval step
- No cross-workspace `LRQ-MIG-%` leakage
- Legacy insert count note (operational)

---

## Flags enabled (when env set)

| Capability | Pilot | Non-pilot |
|------------|-------|-----------|
| `canonicalSubmit` | ON | OFF |
| `canonicalApprove` | ON | OFF |
| `legacyFreeze` | ON | OFF |
| Bridge read (D2) | ON | ON |

---

## Issues encountered (implementation)

| Item | Resolution |
|------|------------|
| Overlap only on `leave_requests` | Fixed: `leave-overlap.ts` checks legacy + canonical |
| Pending without approval step | Fixed: `resolveApproverWithFallback` + mandatory step insert |
| `hr.manage` cannot approve | Fixed: `canActAsLeaveApprover` |
| Global freeze risk | Pilot workspace guard on all flags |

---

## Rollback status

| Action | SLA target |
|--------|------------|
| Unset `LEGACY_LEAVE_FREEZE`, `CANONICAL_LEAVE_*` | < 15 min |
| Redeploy previous frontend | Optional |
| Delete migrated rows | Only with approval: `DELETE FROM leave_requests WHERE workspace_id = ? AND request_number LIKE 'LRQ-MIG-%'` |

**Triggers:** balance drift, mass 409, duplicate approvals.

---

## Remaining risks

- Duplicate UI rows until legacy list hidden post-migration
- Legacy overlap blocks new canonical submit until legacy pending cleared/migrated
- Business day calc in migration script uses Mon–Fri simplification (reconcile balances)
- Multi-workspace rollout not started (P18-E)

---

## Test evidence

```
leave-pilot-production.test.ts   6/6 PASS
leave-overlap.test.ts            2/2 PASS
leave-cutover-flags.test.ts      4/4 PASS
leave-cutover.safety.test.ts     6/6 PASS
(+ P18-D1/D2 smokes when run together)
```

---

**Confirmation:** No legacy table removal. No dual-write. No global freeze.
