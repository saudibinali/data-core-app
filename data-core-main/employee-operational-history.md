# Employee Operational History

**Phase:** 4 — Unified history & audit model

---

## 1. Problem

History scattered across:

- `hr_employee_position_history` (journal only, no state update)
- `hr_employee_notes`
- `workflow_execution_steps`
- `leave_requests`
- Activity log in HR routes
- No unified timeline

---

## 2. Unified Timeline Model

**Table:** `workforce_timeline_events`

| Column | Purpose |
|--------|---------|
| workspace_id | |
| employee_id | Subject |
| event_type | enum string |
| occurred_at | |
| actor_user_id | |
| correlation_id | Links to approval_instance, leave_request, etc. |
| summary | Human readable |
| payload | JSONB details |
| visibility | `hr` \| `employee` \| `manager` |

**Sources feed timeline:**
- Lifecycle service
- Approval runtime
- Position runtime
- Document uploads
- Contract changes
- Manual HR notes (optional mirror)

---

## 3. Event Types (initial catalog)

| event_type | Source |
|------------|--------|
| `employee.created` | HR |
| `employee.activated` | Lifecycle |
| `org.assigned` | Org service |
| `position.assigned` | Position runtime |
| `manager.changed` | Org service |
| `transfer.completed` | Lifecycle |
| `leave.approved` | Leave |
| `approval.decided` | Approval runtime |
| `document.uploaded` | Documents |
| `contract.signed` | Contracts |
| `note.added` | Notes (optional) |

---

## 4. UI

Employee file → **History** tab:
- Filter by category
- Export PDF (future)
- Employee self-service sees `visibility in (employee, manager)` subset

---

## 5. Migration

Backfill script (idempotent):
- Import position_history rows as timeline events
- Import leave status changes
- Import existing activity log entries

Do not delete source tables — dual-read during transition.

---

## 6. Retention & Performance

- Index `(employee_id, occurred_at DESC)`
- Partition by year if &gt;1M rows (Phase 5 optional)
- Append-only

---

*End of Employee Operational History.*
