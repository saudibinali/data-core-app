# P21-A — Payroll Policy Strategy

---

## 1. Policy storage model

| Approach | Detail |
|----------|--------|
| Table | `payroll_policies` (canonical) |
| Shape | `policy_key` + versioned `policy_json` |
| Scope | Workspace-wide; optional org-unit overrides (future) |
| Cache | Loaded once per calculation run |

**Initial policy keys:**

| Key | Contents |
|-----|----------|
| `payroll.general` | Rounding, currency scale, proration method |
| `payroll.attendance` | Lateness, absence, half-day rules |
| `payroll.overtime` | Default OT component, caps |
| `payroll.leave` | Paid/unpaid leave type map |
| `payroll.approval` | Thresholds, required approvers |
| `payroll.lock` | Auto-lock rules, break-glass |

---

## 2. Workspace payroll policies (general)

```json
{
  "rounding": { "mode": "half_up", "scale": 2 },
  "proration": { "method": "calendar_days", "exclude_weekends": true },
  "default_currency": "SAR",
  "scheduled_hours_per_day": 8,
  "require_compensation_package": true
}
```

| Setting | Options |
|---------|---------|
| `proration.method` | `calendar_days` \| `working_days` \| `30_day` (legacy, discouraged) |
| `rounding.mode` | `half_up` \| `bankers` |

---

## 3. Grace rules (attendance)

Align with P20-D `attendance_policies`:

| Parameter | Payroll interaction |
|-----------|----------------------|
| `grace_minutes` | Minutes below threshold → no deduction |
| `geofence_mode` | `warning_first` — no pay impact unless policy escalates |

Escalation policy example:

```json
{
  "late_deduction": {
    "enabled": false,
    "after_occurrences_per_month": 5,
    "deduction_component_code": "late_penalty"
  }
}
```

---

## 4. Overtime policies

Bridge `hr_overtime_policies` → `payroll_policies.overtime`:

| Rule | Source |
|------|--------|
| Day type rates | weekday / weekend / holiday |
| Approval required | `requires_approval` |
| Auto-calculate | `auto_calculate` from summary minutes |
| Component mapping | `salary_component_id` |

**Conflict resolution:** Employee-specific policy > workspace default.

---

## 5. Deduction rules

| Deduction | Trigger | Cap |
|-----------|---------|-----|
| Unpaid absence | summary `absent` | 100% of daily rate |
| Unpaid leave | leave type unpaid | days |
| Voluntary | adjustment | policy max % of gross |
| Statutory | (future) | regulation table |

**Order:** statutory pre-tax → voluntary → post-tax (jurisdiction-specific, future).

---

## 6. Lock periods

| Rule | Behavior |
|------|----------|
| Auto attendance lock | N days after `period_end` |
| Manual payroll lock | HR action required |
| Final pay block | Cannot approve run without attendance lock |

```json
{
  "auto_lock_attendance_days_after_period": 3,
  "allow_break_glass_roles": ["super_admin"],
  "block_ingest_when_locked": true
}
```

---

## 7. Approval requirements

| Action | Default approver |
|--------|------------------|
| Preview run | `hr.manage` |
| Final approve | `hr.payroll.approve` (new permission) |
| Adjustment > X | workspace admin |
| Break-glass unlock | super_admin + reason |

**Legacy gap:** `POST /process` approves immediately—replace with staged workflow.

---

## 8. Retro adjustments

| Type | Policy |
|------|--------|
| Salary retro | Effective date in past period → **correction run** only |
| OT retro | Allowed if attendance lock reopened (break-glass) |
| Leave retro | Recompute summaries then correction run |

Max retro lookback: `max_retro_periods` (default 3).

---

## 9. Relationship to `hr_workspace_settings`

| Today | Future |
|-------|--------|
| Employee numbering only | Keep separate |
| — | Payroll policies in `payroll_policies` table, not mixed |

---

## 10. Policy versioning

- `policy_version` incremented on save.  
- Runs store `calculation_version` = policy version at start.  
- Re-run preview picks up new version; locked runs immutable.

---

## 11. P21-B implementation order

1. `payroll.general` + `payroll.lock`  
2. `payroll.attendance` (read-only adapters)  
3. `payroll.approval` workflow  
4. OT + leave maps  
