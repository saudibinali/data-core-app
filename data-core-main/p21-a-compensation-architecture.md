# P21-A — Compensation Architecture

**Scope:** Design for salary structures, variable pay, and payroll inputs—**no calculation engine implementation in P21-A**.

---

## 1. Layered model

```
┌─────────────────────────────────────────────────────────────┐
│  compensation_packages (employee-effective, versioned)       │
├─────────────────────────────────────────────────────────────┤
│  payroll_components (catalog) + structure templates          │
├─────────────────────────────────────────────────────────────┤
│  compensation_adjustments (one-time / recurring / retro)     │
├─────────────────────────────────────────────────────────────┤
│  workforce inputs (attendance, leave, OT) → derived amounts    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Salary structures

| Concept | Description | Legacy |
|---------|-------------|--------|
| **Structure template** | Reusable bundle of components with defaults | `hr_salary_structures` + `hr_salary_structure_components` |
| **Grade band** | Min/mid/max guardrails for offers | `hr_salary_bands` |
| **Employee package** | Effective-dated assignment | `hr_employee_compensations` |

**Rules:**

- One **active** package per employee per date (query by `effective_from` / `effective_to`).
- Structure provides **defaults**; employee items override specific components.
- Package changes create **new row** (supersede), never mutate historical packages tied to locked runs.

---

## 3. Fixed compensation

| Element | Source | Calculation method |
|---------|--------|-------------------|
| Basic salary | `compensation_packages.base_amount` | Fixed per period (prorate by paid days) |
| Fixed allowances | Structure components `calculation_type=fixed` | Full or prorated |
| Fixed deductions | Structure (housing loan, etc.) | Fixed monthly |

**Proration formula (canonical):**

```
paid_ratio = paid_days / scheduled_working_days
fixed_component_amount = full_amount * paid_ratio
```

`scheduled_working_days` comes from calendar + shift policy—not hardcoded 30.

---

## 4. Variable compensation

| Type | Trigger | Source module |
|------|---------|---------------|
| Overtime pay | Approved OT minutes × rate | `hr_overtime_records` + `attendance_daily_summaries.overtime_minutes` |
| Commissions | Sales import / manual adjustment | `compensation_adjustments` |
| Performance bonus | HR adjustment | `compensation_adjustments` |
| Shift differential | Policy on night/weekend | `payroll_policies` |

**Rule:** Variable amounts require **reference_id** to source record for audit.

---

## 5. Allowances

| Category | Examples | Tax flag |
|----------|----------|----------|
| Recurring | Transport, housing, mobile | `is_taxable` on component |
| Conditional | Remote work stipend | Policy-gated |
| In-kind | (future) non-cash | Export as memo only |

Mapped to `payroll_components.sub_type = allowance`.

---

## 6. Deductions

| Category | Examples | Timing |
|----------|----------|--------|
| Statutory | Tax, GOSI (future engine) | After gross |
| Voluntary | Loan repayment | Fixed |
| Attendance-based | Unpaid absence | From summary |
| Leave-based | Unpaid leave days | From leave type policy |

**Order of application (canonical):**

1. Earnings (basic + allowances + variable)  
2. Pre-tax deductions  
3. Tax (future)  
4. Post-tax deductions  
5. Net pay  

---

## 7. Overtime

| Stage | Owner | Output |
|-------|-------|--------|
| Detection | P20 normalization | `overtime_minutes` on daily summary |
| Policy match | `hr_overtime_policies` | rate multiplier |
| Approval | `hr_overtime_records` | `approved` status |
| Payroll | Calculation engine | `payroll_component_values` linked to OT record |

**Anti double-count:** If OT line added from records, do not also add structure `component_type=overtime` fixed amount.

---

## 8. Unpaid absence

| Condition | Summary status | Payroll effect |
|-----------|----------------|----------------|
| No punch, no approved leave | `absent` | Unpaid day deduction |
| Approved unpaid leave type | `on_leave` + policy | Deduction or zero pay |
| Holiday | `holiday` | Typically paid (policy) |

Deduction component code: `unpaid_absence` (configurable).

---

## 9. Leave deductions

| Leave type (policy) | Paid? | Payroll |
|---------------------|-------|---------|
| Annual (paid) | Yes | No deduction; may count as paid day |
| Sick (paid) | Yes | Paid day |
| Unpaid leave | No | Deduction = daily rate × days |
| Half-day | Partial | 0.5 day credit |

**Source:** `leave_requests` (approved) + future `leave_overlay` on summaries—not `hr_leave_balances` directly.

---

## 10. Recurring adjustments

| Field | Use |
|-------|-----|
| `recurrence` | monthly \| per_period |
| `start_date` / `end_date` | Active window |
| `component_id` | Maps to catalog |

Stored in `compensation_adjustments` with `adjustment_type=recurring`.

---

## 11. One-time adjustments

| Scenario | Workflow |
|----------|----------|
| Signing bonus | Single `compensation_adjustment`; effective on period |
| Correction | Links to `run_type=correction` |
| Retro pay | Separate adjustment + correction run; see pipeline doc |

Requires approver above threshold in `payroll_policies`.

---

## 12. Currency & multi-pay

- Package currency must match run currency or explicit FX policy (future).
- Employee paid in different currency than workspace default: exception list in policy JSON.

---

## 13. Legacy coexistence

| Keep | Migrate | Deprecate |
|------|---------|-----------|
| Component catalog UI | Package versioning | `employees.salary` text field |
| Structure builder | Decimal types | Float in process |
| Bands (reference) | OT→component mapping | Auto-approve on process |

---

## 14. P21-B deliverables (reference)

- `CompensationPackageService` — effective date resolution  
- `AdjustmentService` — approval + period scoping  
- Read adapters only (no full payroll execution)
