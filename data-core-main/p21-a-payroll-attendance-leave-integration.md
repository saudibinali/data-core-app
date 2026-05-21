# P21-A — Payroll / Attendance / Leave Integration

**Builds on:** P20-B summaries, P20-C adjustments, P20-D policies, canonical leave (`leave_requests`)

---

## 1. Integration principles

1. **Payroll reads; workforce writes** — Calculation never mutates `attendance_events` or summaries.  
2. **Daily summary is the payroll fact table** — Not raw events, not legacy `hr_attendance` (transition).  
3. **Leave is overlaid on time** — Approved leave must appear on summary `status` before payroll counts days.  
4. **Locks precede final pay** — Attendance lock before payroll finalization.

---

## 2. Attendance summaries (`attendance_daily_summaries`)

| Field (current) | Payroll use (target) |
|-----------------|----------------------|
| `date` | Period filter |
| `employee_id` | Join key |
| `worked_minutes` | Verify presence; optional hourly roles |
| `late_minutes` | Policy deduction (optional) |
| `early_leave_minutes` | Policy deduction (optional) |
| `overtime_minutes` | Cross-check vs approved OT records |
| `status` | present \| absent \| on_leave \| holiday \| half_day |
| `dominant_source_code` | Audit only |
| `legacy_attendance_id` | Transition reporting only |

### Planned extensions (P21-B design, not migrated in P21-A)

| Field | Purpose |
|-------|---------|
| `scheduled_minutes` | Expected work for day |
| `paid_minutes` | Minutes counted as paid |
| `unpaid_minutes` | Deduction basis |
| `leave_request_id` | Link to canonical leave |
| `holiday_id` | Link to `hr_calendar_holidays` |

---

## 3. Overtime integration

```
attendance_daily_summaries.overtime_minutes
        ↓ (detection)
hr_overtime_records (approval)
        ↓ (approved only)
payroll_component_values (component linked via salary_component_id)
```

| Rule | Detail |
|------|--------|
| Minimum threshold | `hr_overtime_policies.min_threshold_minutes` |
| Rate | multiplier × hourly rate derived from basic / scheduled hours |
| Cap | `max_hours_per_month` on policy |
| Paid flag | Set `hr_overtime_records.payroll_run_id` when included |

**Gap today:** Summary OT minutes not used in legacy process.

---

## 4. Lateness & early leave

| Policy mode | Payroll effect |
|-------------|----------------|
| `ignore` | No deduction |
| `warning_only` | Ops only (P20-D default) |
| `deduct_minutes` | Convert to fractional day deduction |
| `deduct_fixed` | Flat component per occurrence |

Configured in `payroll_policies.attendance` JSON (new).

---

## 5. Unpaid absences

| Summary status | Leave approved? | Payroll |
|----------------|-----------------|---------|
| `absent` | No | Unpaid day |
| `absent` | Yes (unpaid type) | Unpaid day |
| `present` | — | Paid |

Daily rate:

```
daily_rate = monthly_basic / scheduled_working_days_in_period
deduction = daily_rate * unpaid_days
```

---

## 6. Approved leave

| Step | System | Status |
|------|--------|--------|
| Employee requests | `leave_requests` | GO |
| Approval | leave bus + balances | GO |
| Overlay on attendance | `leave_overlay` event → summary | **NOT IMPLEMENTED** |
| Payroll reads summary | `on_leave` status | **BLOCKED** until overlay |

**Half-day leave:** `status=half_day`; `paid_days += 0.5`.

---

## 7. Holidays

| Source | `hr_calendar_holidays` via employee calendar assignment |
|--------|--------------------------------------------------------|
| Summary status | `holiday` |
| Payroll | Typically **paid** non-working day (`paid_days += 1`) |

**Gap:** Calendar assignment to employee not fully automated.

---

## 8. Shift policies

| Input | Use |
|-------|-----|
| `hr_shifts` | Expected start/end, break |
| `attendance_policies` (P20-D) | Grace, geofence warnings |
| Scheduled minutes | Compute lateness baseline |

Night shift differential: variable component via policy on shift code.

---

## 9. Import & adjustments

| Source | Payroll path |
|--------|--------------|
| Excel import (P20-C) | Summaries → same as clock |
| `attendance_adjustments` | Override summary fields before lock |
| Manual HR edit legacy `hr_attendance` | **Discouraged** — dual-write may desync |

Payroll must read **summaries post-adjustment**, not raw import rows.

---

## 10. Payroll cutoffs

| Concept | Definition |
|---------|------------|
| **Period end** | Last calendar day in `payroll_periods` |
| **Time cutoff** | Inclusive of punches until `cutoff_at` datetime |
| **Grace ingest** | Vendor events after cutoff → next period |

Cutoff stored on period; enforced at lock.

---

## 11. Workforce ops interaction (P20-F)

| Ops action | Payroll impact if unlocked | If locked |
|------------|---------------------------|-----------|
| Replay raw event | Recalc summary → affects preview | **Blocked** |
| Ignore raw event | No change | N/A |
| Integration sync | New summaries | Blocked after attendance lock |

Ops dashboard should show **period lock banner** (P21-B UI).

---

## 12. Reporting alignment

| Report | Data source | Payroll consistency |
|--------|-------------|---------------------|
| `hr.attendance.period` | Summaries/legacy | Must match payroll inputs |
| Future `hr.payroll.register` | Component values | Official pay register |

Single source of truth: **locked summary snapshot** referenced in `input_snapshot_json`.

---

## 13. Migration path

| Phase | Deliverable |
|-------|-------------|
| P21-B | `PayrollAttendanceAdapter.readPeriodDays(employee, period)` |
| P21-C | Leave overlay → summary status |
| P21-D | Full calculation engine with preview |
