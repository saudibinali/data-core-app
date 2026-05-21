# P20-A — Attendance Event Normalization

**Phase:** P20-A (design only)  
**Date:** 2026-05-19

---

## 1. Purpose

Convert heterogeneous **raw events** into canonical **`attendance_events`** and derived **`attendance_daily_summaries`**, applying business rules consistently across all sources.

---

## 2. Pipeline stages

```
raw_event (received)
    → validate schema & employee
    → map to canonical event_type
    → dedupe by idempotency_key
    → store attendance_events
    → trigger day aggregation (employee_id + local_date)
    → apply policy rules
    → write attendance_daily_summaries
    → dual-write hr_attendance (transition)
```

---

## 3. Canonical event types

| Type | Description |
|------|-------------|
| `clock_in` | Start of work |
| `clock_out` | End of work |
| `break_start` / `break_end` | Unpaid/paid breaks |
| `absence_declared` | System or HR marks absence |
| `leave_overlay` | From approved leave (no punch) |
| `holiday_overlay` | From calendar holiday |
| `adjustment` | HR correction reference |

---

## 4. Normalization rules (v1)

### 4.1 Timestamp handling

- Store `occurred_at` as `timestamptz` (UTC)  
- Compute `local_date` using employee/workspace timezone (`hr_work_calendars.timezone` or policy default)  
- **Night shifts:** If shift crosses midnight, assign events to shift start date per policy  

### 4.2 Duplicate detection

| Scope | Rule |
|-------|------|
| Same source | Reject duplicate `external_id` |
| Cross-source | Same `employee_id + occurred_at ± 2 min + event_type` → keep higher priority source |
| Replay | Idempotency key prevents double insert |

### 4.3 Source priority (default)

```
manual_adjustment > manual_entry > biometric > mobile_gps > web > excel > api_poll
```

Configurable in `attendance_policies.policy_json`.

---

## 5. Missing punch handling

| Situation | Default behavior |
|-----------|------------------|
| clock_in without clock_out | Day status `incomplete`; flag for HR review |
| clock_out without clock_in | Flag anomaly; optional auto infer if policy allows |
| No events on workday | If not leave/holiday → `absent` candidate |
| Leave approved | Overlay `on_leave`; suppress absent flag |

**Auto infer** (optional policy): close open clock_in at shift end + grace.

---

## 6. Late / early rules

Inputs:

- Matched `hr_shifts` (or employee assignment when added)  
- `grace_minutes`, `start_time`, `end_time`  

Calculations:

```
scheduled_start = date + shift.start_time
if first_clock_in > scheduled_start + grace:
    late_minutes = diff minutes
if last_clock_out < scheduled_end - grace:
    early_leave_minutes = diff minutes
```

**Today:** These fields are manual on `hr_attendance`; normalization **computes** them into summaries.

---

## 7. Overtime (normalization vs OT module)

- Normalization may set `overtime_minutes` candidate on daily summary  
- `hr_overtime_records` remains approval workflow (existing)  
- Policy links: daily OT cap, minimum block, day type multipliers (existing `hr_overtime_policies`)  

---

## 8. Shift matching

Priority order:

1. Explicit shift on event payload  
2. Employee default shift (future assignment table)  
3. Schedule pattern by day of week  
4. Workspace default shift  
5. null (flex — use policy for flex handling)  

---

## 9. Conflict resolution

| Conflict | Resolution |
|----------|------------|
| Two clock_ins | Earliest wins; second flagged |
| Manual summary vs biometric | Manual adjustment row wins |
| Import overwrites day | Tag `source=excel`; lower priority than live biometric unless configured |
| Leave vs present punch | Punch preserved; status notes exception; HR review queue |

---

## 10. Timezone edge cases

- Employee travels: use workspace calendar timezone unless employee override set  
- DST: use IANA zone rules in library (e.g. `Asia/Riyadh` no DST; document for EU/US tenants)  
- Display: UI shows local time; storage UTC  

---

## 11. Rebuild capability

Admin action: **Recalculate day** / **Recalculate range**

- Deletes derived summary for range (not raw events)  
- Re-runs aggregation from events + policies  
- Required after policy retroactive change  

---

## 12. Outputs mapping to legacy

| `attendance_daily_summaries` | `hr_attendance` |
|----------------------------|-----------------|
| `first_in` | `check_in` (HH:MM text during transition) |
| `last_out` | `check_out` |
| `status` | `status` |
| `late_minutes` | `late_minutes` |
| `overtime_minutes` | `overtime_minutes` |
| `source_snapshot_json` | `source_type` (dominant source code) |

---

## 13. Testing strategy (future)

- Golden files per source type  
- Property tests for duplicate/idempotency  
- Timezone boundary cases  
- Leave overlay scenarios  

**P20-A:** No tests — specification only.
