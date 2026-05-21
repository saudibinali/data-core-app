# P21-A — Canonical Payroll Models (Design Only)

**Status:** Specification — **no migrations in P21-A**  
**Principle:** Workspace-scoped, auditable, immutable payslip snapshots, accounting-ready exports

---

## Model map (target state)

```
payroll_cycles
  └── payroll_periods
        └── payroll_runs
              └── payroll_run_employees
                    └── payroll_component_values
                          └── payroll_payslips (1:1 or embedded)
compensation_packages (employee-effective)
  └── compensation_adjustments
payroll_components (catalog)
payroll_policies (workspace rules)
payroll_locks (period close)
```

Legacy mapping:

| Canonical | Legacy (today) |
|-----------|----------------|
| `payroll_components` | `hr_salary_components` |
| `compensation_packages` | `hr_employee_compensations` + structure |
| `payroll_runs` | `hr_payroll_runs` |
| `payroll_payslips` | `hr_payslips` + `hr_payslip_lines` |
| `payroll_component_values` | `hr_payslip_lines` (normalized) |

---

## 1. `payroll_cycles`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Defines how often payroll is operated (monthly, semi-monthly, weekly). |
| **Key fields** | `id`, `workspace_id`, `code`, `name`, `frequency` (monthly \| semi_monthly \| weekly \| custom), `anchor_day`, `timezone`, `is_active` |
| **Relationships** | 1:N → `payroll_periods` |
| **Workspace isolation** | `workspace_id` NOT NULL, cascade delete |
| **Audit** | `created_by`, `created_at`, `updated_at` |
| **Accounting** | Cycle code exported as batch dimension |
| **Reporting** | Filter runs by cycle |

**Gap vs legacy:** `hr_payroll_runs` embeds month/year only—no cycle entity.

---

## 2. `payroll_periods`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Bounded date range for time aggregation (attendance, leave, OT). |
| **Key fields** | `id`, `workspace_id`, `cycle_id`, `period_start`, `period_end`, `period_label`, `status` (open \| closed \| locked), `cutoff_at` |
| **Relationships** | N:1 cycle; 1:N runs; links to `payroll_locks` |
| **Workspace isolation** | Enforced on all queries |
| **Audit** | `closed_by`, `closed_at`, `locked_at` |
| **Accounting** | Period label on journal lines |
| **Reporting** | Join key for attendance summaries (`date` BETWEEN start/end) |

---

## 3. `payroll_runs`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | A calculation attempt for a period (may have preview vs final). |
| **Key fields** | `id`, `workspace_id`, `period_id`, `run_number`, `run_type` (preview \| final \| correction), `status` (draft \| calculating \| review \| approved \| locked \| cancelled), totals (numeric decimal), `calculation_version`, `idempotency_key` |
| **Relationships** | 1:N `payroll_run_employees`; optional link to `generated_reports` |
| **Workspace isolation** | Yes |
| **Audit** | `processed_by`, `approved_by`, timestamps |
| **Accounting** | Run ID on export batch |
| **Reporting** | Headline totals dashboard |

**Evolution:** Replace immediate auto-approve in legacy process with `review` state.

---

## 4. `payroll_run_employees`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Per-employee calculation unit within a run (inputs + outputs). |
| **Key fields** | `id`, `workspace_id`, `run_id`, `employee_id`, `compensation_package_id`, `status` (included \| excluded \| error), `input_snapshot_json`, `error_message`, day counts (`scheduled_days`, `paid_days`, `unpaid_absence_days`), totals |
| **Relationships** | 1:N `payroll_component_values`; 1:1 `payroll_payslips` |
| **Workspace isolation** | Yes |
| **Audit** | Input snapshot immutable after lock |
| **Accounting** | Employee cost center from employee/org unit |
| **Reporting** | Row-level reconciliation |

---

## 5. `payroll_components`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Catalog of earnings/deductions (enterprise component model). |
| **Key fields** | `id`, `workspace_id`, `code`, `name`, `component_class` (earning \| deduction \| employer_contribution), `sub_type` (basic \| allowance \| overtime \| tax \| benefit \| custom), `calculation_method`, `gl_account_code`, `is_taxable`, `display_order` |
| **Relationships** | Referenced by packages and values |
| **Workspace isolation** | Unique `(workspace_id, code)` |
| **Audit** | Soft-deactivate, not hard delete if used |
| **Accounting** | **GL mapping foundation** |
| **Reporting** | Pivot by component |

---

## 6. `payroll_component_values`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Atomic calculated or fixed amounts for one employee in one run. |
| **Key fields** | `id`, `run_employee_id`, `component_id`, `source` (compensation \| attendance \| leave \| adjustment \| manual), `quantity`, `rate`, `amount` (decimal), `currency`, `reference_type`, `reference_id` |
| **Relationships** | N:1 run employee, component |
| **Workspace isolation** | Via run |
| **Audit** | Immutable after run lock |
| **Accounting** | Line-level journal export |
| **Reporting** | Payslip line detail |

---

## 7. `compensation_packages`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Effective-dated total reward package for an employee. |
| **Key fields** | `id`, `workspace_id`, `employee_id`, `structure_code`, `base_amount`, `currency`, `effective_from`, `effective_to`, `status`, `package_json` (component defaults) |
| **Relationships** | 1:N adjustments; referenced by run employees |
| **Workspace isolation** | Yes |
| **Audit** | Supersede pattern (no overwrite) |
| **Accounting** | Base for encumbrance reports |
| **Reporting** | Compensation history |

---

## 8. `compensation_adjustments`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | One-time or recurring pay changes outside base package. |
| **Key fields** | `id`, `workspace_id`, `employee_id`, `adjustment_type` (bonus \| deduction \| allowance \| correction), `amount`, `effective_date`, `period_id` (optional scope), `reason`, `approved_by`, `status` |
| **Relationships** | Consumed by calculation engine |
| **Workspace isolation** | Yes |
| **Audit** | Approval required for amounts above threshold |
| **Accounting** | Optional cost center override |
| **Reporting** | Adjustment register |

---

## 9. `payroll_payslips`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Employee-facing immutable pay statement for a run. |
| **Key fields** | `id`, `workspace_id`, `run_employee_id`, `employee_id`, `payslip_number`, `status` (draft \| issued \| void), `gross`, `net`, `ytd_json`, `document_id` (PDF in registry) |
| **Relationships** | Lines via `payroll_component_values` or denormalized snapshot |
| **Workspace isolation** | Yes |
| **Audit** | Void requires correction run |
| **Accounting** | Net pay per employee for bank file |
| **Reporting** | Self-service + HR export |

---

## 10. `payroll_policies`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Workspace rules engine config (JSON + typed keys). |
| **Key fields** | `id`, `workspace_id`, `policy_key`, `policy_json`, `version`, `effective_from` |
| **Relationships** | Read by calculation pipeline |
| **Workspace isolation** | Yes |
| **Audit** | Versioned policy changes |
| **Accounting** | Rounding rules, proration method |
| **Reporting** | Policy compliance exports |

---

## 11. `payroll_locks`

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Prevent retroactive changes to time or pay inputs for closed periods. |
| **Key fields** | `id`, `workspace_id`, `period_id`, `lock_type` (attendance \| payroll \| full), `locked_at`, `locked_by`, `run_id`, `break_glass_reason` |
| **Relationships** | 1:1 or 1:N per period |
| **Workspace isolation** | Yes |
| **Audit** | Mandatory for SOX-style customers |
| **Accounting** | Lock before journal export |
| **Reporting** | Lock status on ops dashboard |

---

## Cross-cutting requirements

| Concern | Rule |
|---------|------|
| **Money** | Use `numeric(19,4)` or integer minor units in P21-B—not text |
| **Idempotency** | `payroll_runs.idempotency_key = hash(workspace, period_id, run_type, version)` |
| **Immutability** | Locked runs: no UPDATE on component values; correction via new run |
| **Multi-tenant** | Every query filters `workspace_id` |
| **Retention** | Payslips ≥ 7 years configurable; align with document registry expiry |

---

## P21-B migration notes (forward reference only)

1. Add new tables alongside `hr_*`; dual-write payslips during transition.  
2. Backfill `payroll_periods` from existing `period_year` / `period_month`.  
3. Do **not** destructive-drop legacy tables until consumers migrated.
