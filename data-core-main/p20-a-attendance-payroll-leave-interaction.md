# P20-A — Attendance / Payroll / Leave Interaction

**Phase:** P20-A (documentation only — **no payroll redesign**)  
**Date:** 2026-05-19

---

## 1. Current coupling (as-is)

| Path | Exists? | Notes |
|------|---------|-------|
| Attendance → payslip days | **No** | `hr_payslips.working_days` / `absent_days` unused in process |
| Attendance → OT pay | **Partial** | `hr_overtime_calculate` reads `overtime_minutes`; amounts partial |
| Leave approval → attendance | **No** | Canonical leave does not write `on_leave` rows |
| Holiday calendar → attendance | **No** | Holidays used in leave business days only |
| Attendance lock before payroll | **No** | |

---

## 2. Target interaction model

```
leave_requests (approved) ──► leave_overlay events ──► daily summary.status = on_leave
hr_calendar_holidays ──────► holiday_overlay ───────► status = holiday
attendance_events ─────────► minutes worked ────────► working_days, absent_days
attendance_adjustments ────► overrides ─────────────► payroll inputs
attendance_period_lock ────► blocks changes ────────► payroll run safety
hr_payroll_run.process ────► READ summaries (future) ─► payslip lines
```

**Principle:** Payroll **reads** derived summaries; does not mutate attendance during process.

---

## 3. Absence & lateness

| Concept | Payroll treatment (planned) |
|---------|----------------------------|
| Unexcused absent day | Reduce `actual_days` or unpaid deduction component |
| Late arrival | Policy: ignore / warning / deduct per minute block |
| Early leave | Same as late — configurable |
| Half day | 0.5 day credit |

**P20-A:** Define fields on `attendance_daily_summaries.paid_minutes` and `unpaid_minutes`; payroll formulas in later phase.

---

## 4. Approved leave

| Event | Attendance behavior |
|-------|---------------------|
| Leave approved (canonical) | System generates `leave_overlay` for each business day in range |
| Leave cancelled before start | Remove overlays; recompute day |
| Half-day leave | `half_day` status + optional punch validation |

**Balance:** Leave module continues to own `hr_leave_balances`; attendance only reflects **time accounting**.

---

## 5. Public holidays

- Source: `hr_calendar_holidays` via employee’s assigned calendar (future assignment)  
- Overlay: `holiday` status on summary  
- Payroll: typically paid non-working day (country/policy specific)  

---

## 6. Overtime

| Stage | Owner |
|-------|-------|
| Detection | Normalization → `overtime_minutes` on summary |
| Approval | Existing `hr_overtime_records` workflow |
| Payroll inclusion | Future: approved OT records → payslip lines via `salary_component_id` |

Do not double-count OT in both base hours and OT lines.

---

## 7. Unpaid absence

- Mark via status `absent` without approved leave  
- Policy may map to unpaid deduction component  
- Requires alignment with compensation structure (out of scope P20-A)  

---

## 8. Attendance locks

Proposed `attendance_period_locks` (or field on workspace settings):

| Field | Purpose |
|-------|---------|
| `period_end_date` | Last date included in closed payroll |
| `locked_at` | Timestamp |
| `locked_by` | User |
| `payroll_run_id` | Optional FK |

**Effect:** Block event ingest and adjustments for dates ≤ lock (except super-admin break-glass).

---

## 9. Reporting interaction

- P19 `hr.attendance.period` reads summaries/legacy table  
- Payroll reports (future) should use same summaries for consistency  

---

## 10. Risks if left unchanged

1. Payslip days manually entered or wrong  
2. OT paid without attendance evidence  
3. Leave paid twice (balance + present day)  
4. Post-payroll attendance edits corrupt compliance  

---

## 11. Recommended payroll integration phase

**P21-x or P20-G** (explicitly after P20-B/C event foundation):

- Read-only adapter in payroll process  
- Feature flag per workspace  
- Parallel run report comparing old vs new day counts  

**No payroll redesign in P20-A/B.**

---

**Related:** `p20-a-current-attendance-audit.md` §6
