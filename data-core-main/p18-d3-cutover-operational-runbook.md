# P18-D3 — Cutover Operational Runbook

**Audience:** HR platform ops, on-call, support  
**Phase:** Preparation (P18-D3) — procedures for **P18-D4** execution

---

## 1. Deployment order (P18-D4 target)

| Step | Component | Action |
|------|-----------|--------|
| 1 | DB | Confirm migration `0001_leave_canonical` applied |
| 2 | API | Deploy `leave.ts` + `leave-cutover-flags.ts` (no freeze wire yet) |
| 3 | API | Deploy flag wiring for legacy 410 (when approved) |
| 4 | Frontend | Deploy bridge + cutover flags (all OFF) |
| 5 | Staging | Enable flags per workspace pilot |
| 6 | Migration job | Dry-run → batch execute |
| 7 | Production | `CANONICAL_LEAVE_SUBMIT` pilot → expand |
| 8 | Production | `CANONICAL_LEAVE_APPROVE` + `LEGACY_LEAVE_FREEZE` |

---

## 2. Rollback steps

1. Set all leave flags to `false` / unset env vars.
2. Redeploy previous frontend build if needed (< 15 min).
3. Verify legacy `POST /hr/me/leave-requests` returns 201.
4. Do not delete canonical rows unless data team approves.
5. Post incident note with workspace ids affected.

---

## 3. Smoke checks (post-deploy)

```bash
# From artifacts/api-server (DATABASE_URL required)
pnpm test leave-canonical.smoke leave-bridge.smoke leave-cutover.safety leave-cutover-flags
```

| Check | Expected |
|-------|----------|
| Employee list own requests | 200, scoped |
| Legacy POST | 201, no new `leave_requests` row |
| Canonical POST (staging flag on) | 201, `pending_approval` |
| Legacy PATCH wrong id | 404 on canonical id |
| Cross-workspace GET :id | 403 |

---

## 4. Freeze activation steps (P18-D4 — not now)

1. Confirm migration report signed for workspace.
2. Set `LEGACY_LEAVE_FREEZE=true` on API.
3. Set `VITE_LEGACY_LEAVE_FREEZE=true` on frontend.
4. Monitor 410 rate on legacy POST/PATCH.
5. Announce maintenance banner.

---

## 5. Support troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Duplicate leave rows in UI | Legacy + canonical same dates | Expected pre-migration; run dedup query |
| Cannot approve canonical | Flag off / UI not wired | Use API `PATCH .../approve` in staging or wait D4 |
| 409 on submit | Overlap in `leave_requests` | Check existing requests |
| 422 insufficient balance | Pending+used exceeds entitled | HR adjust balance |
| 403 on list | No employee profile | Link user to employee |
| Empty list (ESS) | Was `hr.manage` on wrong endpoint | Fixed D2 — verify `GET /hr/leave-requests` |
| Double pending balance | Legacy + canonical both reserved | Freeze legacy; reconciliation script |

---

## 6. Monitoring points

| Metric | Source |
|--------|--------|
| `leave_requests` insert rate | DB / logs |
| `hr_employee_leaves` insert rate | Should → 0 after freeze |
| 409/422 on `POST /hr/leave-requests` | API logs |
| 410 on legacy routes | API logs after freeze |
| Event bus `leave.requested` count | Idempotency key duplicates |
| Balance pending drift | Scheduled reconciliation query (§7) |

---

## 7. Balance verification query

See `p18-d3-legacy-freeze-strategy.md` §6 SQL.

**Tolerance:** ±0.5 days per employee/policy/year after migration.

---

## 8. Duplicate detection query

```sql
SELECT e.full_name, l1.id AS legacy_id, l2.id AS canonical_id,
       l1.start_date, l1.end_date
FROM hr_employee_leaves l1
JOIN leave_requests l2 ON l2.employee_id = l1.employee_id
  AND l2.workspace_id = l1.workspace_id
  AND l2.start_date <= l1.end_date
  AND l2.end_date >= l1.start_date
  AND l2.status IN ('pending_approval','pending','approved')
  AND l1.status IN ('pending','approved')
WHERE l1.workspace_id = :workspace_id;
```

---

## 9. Emergency rollback

**Triggers:** Widespread 500 on leave, balance corruption, mass duplicate approvals.

1. **Immediate:** `LEGACY_LEAVE_FREEZE=false`, `CANONICAL_LEAVE_SUBMIT=false`, `CANONICAL_LEAVE_APPROVE=false`.
2. Redeploy last known good build.
3. Disable migration job.
4. Preserve DB state for forensics.
5. HR comms: use legacy path until resolved.

---

## 10. Environment reference

| API env | Frontend env |
|---------|--------------|
| `CANONICAL_LEAVE_READ` | `VITE_CANONICAL_LEAVE_READ` |
| `CANONICAL_LEAVE_SUBMIT` | `VITE_CANONICAL_LEAVE_SUBMIT` |
| `CANONICAL_LEAVE_APPROVE` | `VITE_CANONICAL_LEAVE_APPROVE` |
| `LEGACY_LEAVE_FREEZE` | `VITE_LEGACY_LEAVE_FREEZE` |

**Default:** unset / false.

---

**P18-D3 confirmation:** Runbook prepared. No production flag enablement.
