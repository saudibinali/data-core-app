# P18-D3 — Data Migration Execution Plan

**Date:** 2026-05-19  
**Source mapping:** `p18-c-legacy-to-canonical-mapping-plan.md`  
**Status:** Plan only — **no migration executed** in P18-D3.

---

## 1. Principles

- Workspace-scoped batches (low blast radius).
- Idempotent inserts (`LRQ-MIG-{legacyId}`).
- Dry-run → staging rehearsal → production window.
- Reconciliation before legacy freeze.
- No destructive SQL on legacy table.

---

## 2. Migration batches

| Batch | Scope | Criteria | Max rows (guideline) |
|-------|-------|----------|----------------------|
| B0 | Internal / sandbox | `workspace.slug LIKE '%-sandbox%'` | 500 |
| B1 | Pilot tenants | Named list in runbook | 2,000 |
| B2 | Small workspaces | `< 500 legacy rows` | 5,000/workspace |
| B3 | Medium | 500–5,000 | Off-hours |
| B4 | Large | > 5,000 | Dedicated window + read replica lag check |

**Order within workspace:** `created_at ASC` (stable).

---

## 3. Workspace batching procedure

1. Export workspace id list with legacy row counts.
2. Sort ascending by count.
3. Assign batch label (B1–B4).
4. For each workspace:
   - Pre-check: employees FK valid, no active DDL.
   - Run job with `WORKSPACE_ID` filter.
   - Post-check: verification queries (§5).
   - Sign-off row in migration log table (future) or spreadsheet.

---

## 4. Row transformation (per mapping plan)

| Step | Action |
|------|--------|
| 1 | Select eligible `hr_employee_leaves` for workspace |
| 2 | Resolve `requested_by_user_id` |
| 3 | Map status → canonical |
| 4 | Compute `business_days_count` via `calcBusinessDays` |
| 5 | Set `request_number = LRQ-MIG-{legacyId}` |
| 6 | `INSERT ... ON CONFLICT (workspace_id, request_number) DO NOTHING` |
| 7 | Synthesize `leave_approval_steps` for terminal states |
| 8 | Log warnings (orphan, unknown status, null days) |

---

## 5. Verification queries

### 5.1 Count parity

```sql
SELECT workspace_id,
       (SELECT COUNT(*) FROM hr_employee_leaves l WHERE l.workspace_id = w.id) AS legacy_cnt,
       (SELECT COUNT(*) FROM leave_requests r
        WHERE r.workspace_id = w.id AND r.request_number LIKE 'LRQ-MIG-%') AS migrated_cnt
FROM workspaces w
WHERE w.id = :workspace_id;
```

### 5.2 Orphans

```sql
SELECT l.id FROM hr_employee_leaves l
LEFT JOIN employees e ON e.id = l.employee_id AND e.workspace_id = l.workspace_id
WHERE l.workspace_id = :workspace_id AND e.id IS NULL;
```

### 5.3 Unmapped statuses

```sql
SELECT DISTINCT status FROM hr_employee_leaves
WHERE workspace_id = :workspace_id
  AND status NOT IN ('pending','approved','rejected','cancelled');
```

### 5.4 Duplicate request numbers

```sql
SELECT request_number, COUNT(*) FROM leave_requests
WHERE workspace_id = :workspace_id
GROUP BY request_number HAVING COUNT(*) > 1;
```

### 5.5 Balance reconciliation sample

Per employee/policy/year: compare `hr_leave_balances.pending|used` vs sum of open/approved canonical + known legacy adjustments (scripted in job §7).

---

## 6. Orphan handling

| Case | Action |
|------|--------|
| Missing employee | Skip; report `orphan_legacy_leave_id` |
| Missing `requested_by_user_id` | Use workspace admin service account or skip per mapping §8 |
| Unknown status | Map to `pending_approval` + `needs_review` flag in report |

**No automatic delete** of legacy rows.

---

## 7. Retry strategy

| Failure | Retry |
|---------|-------|
| Unique violation on `request_number` | Skip (idempotent) |
| FK violation | Fix data; rerun workspace batch |
| Connection timeout | Retry batch with exponential backoff (max 3) |
| Balance reconciliation mismatch | Pause batch; manual HR review |

**Job design:** Checkpoint per 100 rows; resume from last legacy id.

---

## 8. Idempotency

- Key: `(workspace_id, request_number)` where `request_number = LRQ-MIG-{legacyId}`.
- Re-run safe: `ON CONFLICT DO NOTHING`.
- Steps table: delete/recreate only in dry-run; production uses `ON CONFLICT` on `(leave_request_id, step_order)` if added.

---

## 9. Balance reconciliation (post-insert)

Run **after** all rows for workspace inserted:

1. For each `pending` legacy migrated: ensure canonical `pending_approval` reflected in balance **once**.
2. For `approved`: ensure `used` includes `business_days_count`; clear stranded `pending`.
3. Emit report CSV: `employee_id, policy_id, year, delta_pending, delta_used`.

**Do not** auto-fix deltas > 1 day without HR sign-off.

---

## 10. Approval step synthesis

| Legacy status | Step |
|---------------|------|
| approved | 1 step `approved`, `approver_user_id = approved_by` |
| rejected | 1 step `rejected` |
| pending | 1 step `pending`, approver from `findApproverForEmployee` or null |
| cancelled | none or `skipped` |

---

## 11. Dry-run process

1. Clone staging DB snapshot.
2. Run job with `DRY_RUN=1` (no INSERT; log would-be rows).
3. Compare counts and sample 50 rows manually.
4. Review balance delta report (simulated).

---

## 12. Staging rehearsal

1. Apply migration 0001 if missing.
2. Seed legacy + canonical mixed data.
3. Execute B0 batch full pipeline.
4. Run P18-D1/D2/D3 smoke + cutover safety tests.
5. Sign staging checklist (attach to `p18-d1-staging-verification-checklist.md` appendix).

---

## 13. Production rollout window

| Item | Recommendation |
|------|----------------|
| Window | Weekend off-hours, tenant-local low traffic |
| Freeze | Legacy writes frozen **before** batch OR immediately after batch per workspace |
| Duration | 30 min per small workspace; scale with row count |
| Rollback | Stop job; no DELETE canonical; legacy unchanged |

---

## 14. Rollback expectations

| Situation | Action |
|-----------|--------|
| Job fails mid-batch | Stop; fix; resume idempotent |
| Wrong data migrated | Delete `leave_requests WHERE request_number LIKE 'LRQ-MIG-%' AND workspace_id = ?` **only with approval** |
| Balance corrupted | Restore `hr_leave_balances` row from pre-migration snapshot |

**Never** drop `hr_employee_leaves` in rollback.

---

**Confirmation:** Execution plan only. No data migration run in P18-D3.
