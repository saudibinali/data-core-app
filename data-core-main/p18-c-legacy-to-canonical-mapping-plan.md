# P18-C — Legacy → Canonical Mapping Plan

**Date:** 2026-05-19  
**Type:** Planning only — no data migration scripts executed.

**Source:** `hr_employee_leaves` → `leave_requests` + optional `leave_approval_steps`

---

## 1. Row eligibility

| Rule | Action |
|------|--------|
| `employee_id` exists in `employees` same `workspace_id` | **Migrate** |
| Employee deleted (FK would fail) | **Orphan** — skip or attach to archive employee (manual) |
| Duplicate legacy rows same dates/status | **Flag** — migrate all with distinct `request_number`; post-migration HR review |
| Row already migrated (re-run) | Skip if `request_number` like `LRQ-MIG-{id}` exists (idempotent key) |

---

## 2. Field mapping table

| Legacy (`hr_employee_leaves`) | Canonical (`leave_requests`) | Transformation | Nullable / default |
|-------------------------------|------------------------------|----------------|---------------------|
| `id` | — | Store in external map or optional future `legacy_hr_employee_leave_id` | N/A |
| `workspace_id` | `workspace_id` | Direct copy | NOT NULL |
| `employee_id` | `employee_id` | Direct copy | NOT NULL |
| `created_by` | `requested_by_user_id` | Use `created_by` if not null; else resolve `employees.user_id`; else workspace admin service account | NOT NULL — **block row** if no user resolvable |
| — | `leave_policy_id` | Match `hr_leave_policies` where `workspace_id` + `leave_type` = legacy.`leave_type` and `is_active`; if multiple, pick lowest `display_order`; if none, **null** | YES |
| `leave_type` | `leave_type` | Direct copy; validate against policy types | NOT NULL |
| `start_date` | `start_date` | Direct copy | NOT NULL |
| `end_date` | `end_date` | Direct copy | NOT NULL |
| `days_count` | `days_requested` | If null: `inclusive_calendar_days(start, end)` | NOT NULL |
| — | `business_days_count` | **Run `calcBusinessDays(workspace, start, end)`** at migration time; if 0, use `days_requested` min 1 | NOT NULL |
| `status` | `status` | See §3 | NOT NULL |
| `reason` | `employee_note` | Copy `reason`; append `notes` to `manager_note` if present | YES |
| `notes` | `manager_note` | If HR notes on approve, map here | YES |
| `approved_by` | `approved_by_user_id` | Direct when status approved | YES |
| `approved_at` | `approved_at` | Direct | YES |
| — | `rejected_by_user_id` | Set from `approved_by` if status rejected and approved_by used as rejector | YES |
| — | `rejected_at` | `updated_at` or `approved_at` when rejected | YES |
| — | `cancelled_at` | `updated_at` when status cancelled | YES |
| — | `current_approver_id` | null for terminal states; for pending use resolved approver | YES |
| — | `request_number` | See §4 | NOT NULL |
| — | `attachment_urls` | null | YES |
| `created_at` | `created_at` | Preserve | NOT NULL |
| `updated_at` | `updated_at` | Preserve | NOT NULL |

---

## 3. Status mapping

| Legacy `status` | Canonical `status` | Notes |
|-----------------|-------------------|-------|
| `pending` | `pending_approval` | Assume approval was expected |
| `approved` | `approved` | Balance must reflect **used**, not pending |
| `rejected` | `rejected` | Release any legacy pending balance manually in reconciliation |
| `cancelled` | `cancelled` | Distinct from employee withdraw |

**Canonical-only states** (`withdrawn`, `pending`) — not produced from legacy unless inferred.

**Inconsistent legacy status** (unknown string): map to `pending_approval` + flag `needs_review=true` in migration report.

---

## 4. `request_number` generation

| Strategy | Format | Pros |
|----------|--------|------|
| **Recommended** | `LRQ-MIG-{legacyId}` | Deterministic, idempotent, auditable |
| Alternative | `LRQ-{YYYYMM}-{seq}` per workspace | Human-friendly; requires counter |

Collision handling: unique index on `(workspace_id, request_number)` — MIG prefix guarantees uniqueness per legacy id.

---

## 5. `business_days_count` calculation

1. Call same algorithm as `calcBusinessDays` (default calendar Mon–Fri + holidays).
2. If result `<= 0`, set to `max(1, days_requested)`.
3. **Do not** trust client `days_count` alone for balance reconciliation — use `business_days_count` for balance math during reconciliation pass.

---

## 6. Historical approvals → `leave_approval_steps`

| Legacy state | Step action |
|--------------|-------------|
| `approved` + `approved_by` | Insert step 1: `status=approved`, `approver_user_id=approved_by`, `decided_at=approved_at`, `approver_role=manager` (or `admin` if unknown) |
| `rejected` + `approved_by` | Insert step 1: `status=rejected`, same approver fields |
| `pending` | Insert step 1: `status=pending`, resolve approver via `findApproverForEmployee` logic or null step if no approver |
| `cancelled` | No step or `status=skipped` | Document only |

**Multi-approver history:** Not in legacy — single step only.

---

## 7. Balance reconciliation (post row insert)

Legacy path may have adjusted `hr_leave_balances.pending` without matching canonical rules.

| Legacy status | Balance action after migrate |
|---------------|------------------------------|
| `pending` | Ensure `pending` includes `business_days_count` once; **dedupe** if legacy already incremented |
| `approved` | Ensure `used` includes days; **clear** duplicate `pending` if legacy approve moved pending→used |
| `rejected` / `cancelled` | Ensure no stranded `pending` from that row |

**Run per workspace/employee/year/policy** in maintenance script (future P18-D+), not in DDL migration.

---

## 8. Orphan & edge cases

| Case | Handling |
|------|----------|
| `created_by` null and employee has no `user_id` | Use first workspace admin `users.id` or quarantine row |
| `days_count` > calendar span | Cap `days_requested` to calendar span; log warning |
| Overlapping legacy rows | Migrate all; canonical conflict rules apply only to **new** submits |
| `leave_type` not in any policy | `leave_policy_id = null`; balance reconciliation manual |
| Employee `status = terminated` | Still migrate for history |

---

## 9. Deleted employees

- FK `employee_id` **ON DELETE CASCADE** on canonical — do not delete employees before migration.
- If employee already deleted but legacy row remains (should not happen with FK): **orphan report** — manual fix or skip.

---

## 10. Idempotency

- Primary key: `request_number = LRQ-MIG-{legacyId}`.
- Re-run migration: `INSERT ... ON CONFLICT DO NOTHING` on unique `(workspace_id, request_number)`.

---

## 11. Validation report (required output of future migration job)

- Count legacy vs migrated
- Unresolvable `requested_by_user_id`
- Status unmapped
- Balance deltas per employee
- Overlapping canonical rows after migrate

---

**Confirmation:** Mapping plan only. No data migrated.
