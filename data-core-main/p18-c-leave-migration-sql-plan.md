# P18-C — Leave Migration SQL Plan

**Date:** 2026-05-19  
**Type:** Design / specification only — **no executable migration files**, no `db push`, no apply.

**Source of truth for column definitions:** `lib/db/src/schema/hr.ts` (`leaveRequestsTable`, `leaveApprovalStepsTable`).

---

## 1. Missing tables to add (future migration)

### 1.1 `leave_requests`

| Column | Type | Nullable | FK / notes |
|--------|------|----------|------------|
| `id` | serial PK | NO | |
| `workspace_id` | integer | NO | → `workspaces.id` **ON DELETE CASCADE** |
| `employee_id` | integer | NO | → `employees.id` **ON DELETE CASCADE** |
| `requested_by_user_id` | integer | NO | → `users.id` **ON DELETE RESTRICT** |
| `leave_policy_id` | integer | YES | → `hr_leave_policies.id` **ON DELETE SET NULL** |
| `leave_type` | text | NO | |
| `start_date` | date | NO | |
| `end_date` | date | NO | |
| `days_requested` | integer | NO | calendar inclusive |
| `business_days_count` | integer | NO | server-computed |
| `status` | text | NO | default `pending` |
| `employee_note` | text | YES | |
| `manager_note` | text | YES | |
| `attachment_urls` | jsonb | YES | string array |
| `current_approver_id` | integer | YES | → `users.id` **ON DELETE SET NULL** |
| `approved_by_user_id` | integer | YES | → `users.id` **ON DELETE SET NULL** |
| `approved_at` | timestamptz | YES | |
| `rejected_by_user_id` | integer | YES | → `users.id` **ON DELETE SET NULL** |
| `rejected_at` | timestamptz | YES | |
| `cancelled_at` | timestamptz | YES | |
| `request_number` | text | NO | |
| `source_form_id` | integer | YES | no FK in schema (document as optional future FK) |
| `source_submission_id` | integer | YES | same |
| `created_at` | timestamptz | NO | default now() |
| `updated_at` | timestamptz | NO | default now() |

**Indexes (required):**

- `idx_leave_requests_workspace` (`workspace_id`)
- `idx_leave_requests_employee` (`employee_id`)
- `idx_leave_requests_status` (`status`)
- `idx_leave_requests_dates` (`start_date`, `end_date`)
- **`uq_leave_request_number` UNIQUE** (`workspace_id`, `request_number`)

**Nullable decisions:**

- `leave_policy_id` nullable — requests without policy skip strict balance enforcement in code.
- Approver/actor fields nullable until state transition.
- `source_*` nullable — direct UI submissions.

### 1.2 `leave_approval_steps`

| Column | Type | Nullable | FK / notes |
|--------|------|----------|------------|
| `id` | serial PK | NO | |
| `leave_request_id` | integer | NO | → `leave_requests.id` **ON DELETE CASCADE** |
| `step_order` | integer | NO | |
| `approver_user_id` | integer | NO | → `users.id` **ON DELETE RESTRICT** |
| `approver_role` | text | NO | `manager` \| `hr` \| `admin` |
| `status` | text | NO | default `pending` |
| `comment` | text | YES | |
| `decided_at` | timestamptz | YES | |
| `notified_at` | timestamptz | YES | |
| `timeout_at` | timestamptz | YES | |
| `created_at` | timestamptz | NO | default now() |

**Indexes / constraints:**

- **`uq_leave_approval_step` UNIQUE** (`leave_request_id`, `step_order`)
- `idx_leave_approval_steps_request` (`leave_request_id`)
- `idx_leave_approval_steps_approver` (`approver_user_id`)
- `idx_leave_approval_steps_status` (`status`)

**Cascade behavior:**

- Deleting workspace → cascades employees → leave requests → steps (via request FK).
- Deleting `leave_requests` → **cascade** delete steps.

---

## 2. Transaction safety (application layer — post-migration)

| Operation | Requirement |
|-----------|-------------|
| Submit | Conflict check + balance `FOR UPDATE` + insert request + insert step + balance update — **single transaction** (already in `leave.ts`) |
| Approve/reject/withdraw | Request update + step update + balance — **single transaction** |
| Legacy paths during bridge | Must not double-adjust balances |

**SQL migration itself** is DDL-only; balance integrity is enforced at runtime after cutover.

---

## 3. Migration ordering

| Order | Step | Depends on |
|-------|------|------------|
| 1 | Verify `hr_leave_balances`, `hr_leave_policies`, `hr_work_calendars`, `hr_calendar_holidays` exist | Baseline `0000` (already present) |
| 2 | `CREATE TABLE leave_requests` + indexes + unique | workspaces, employees, users |
| 3 | `CREATE TABLE leave_approval_steps` + indexes + unique | leave_requests, users |
| 4 | (Optional future) Add `legacy_hr_employee_leave_id` on `leave_requests` for traceability | Data migration phase — **not in current schema**; document as optional additive migration |
| 5 | Staging smoke: `POST /hr/leave-requests` | App deploy compatible with new tables |

**Do not** drop or alter `hr_employee_leaves` in this migration.

---

## 4. Rollback strategy

| Scenario | Action |
|----------|--------|
| Pre-data-migration, tables empty | `DROP TABLE leave_approval_steps; DROP TABLE leave_requests;` (reverse order) |
| After data copied to canonical | **Do not drop** without export; rollback = disable canonical writes, revert UI to legacy |
| Production partial failure | Leave tables in place; feature-flag canonical API off |

**Journal:** New Drizzle entry (e.g. `0001_leave_domain.sql`) — rollback = new down migration or manual DROP only if **zero** canonical rows.

---

## 5. Staging verification checklist

- [ ] `\d leave_requests` / `information_schema` confirms all columns
- [ ] Unique constraint on `(workspace_id, request_number)` works
- [ ] FK cascade: delete test employee in sandbox removes requests/steps
- [ ] `POST /hr/leave-requests` returns 201 with `requestNumber`
- [ ] Balance `pending` increases on submit with policy
- [ ] Approve moves `pending` → `used`
- [ ] Reject releases `pending`
- [ ] Conflict: overlapping dates → 409
- [ ] Insufficient balance → 422
- [ ] Notification fired once for `leave.requested` (check idempotency)
- [ ] Legacy `hr_employee_leaves` unchanged and still readable

---

## 6. Production rollout checklist

- [ ] Maintenance window communicated (DDL only — low risk if tables empty)
- [ ] Backup / snapshot before migration
- [ ] Apply migration on staging → smoke tests → production
- [ ] Deploy API build that includes `leave.ts` (already present)
- [ ] **Do not** switch UI until L3 bridge tested
- [ ] Monitor error rate on `/hr/leave-requests`
- [ ] Confirm no code path auto-runs data backfill on deploy
- [ ] Runbook: if canonical POST fails, legacy UI still works until L5 freeze

---

## 7. Out of scope for SQL plan (explicit)

- Modifying `hr_employee_leaves`
- Dropping tables
- Seeding data
- Changing `hr_leave_balances` schema
- Platform `users` column drift (separate track)

---

**Confirmation:** Specification only. No migration files created or applied.
