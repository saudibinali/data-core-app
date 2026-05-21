# P21-A — Payroll Accounting & Export Readiness

**Scope:** Readiness design only — **no ERP, GL, or bank integration implementation**

---

## 1. Design goals

1. Every payroll line maps to a **GL account** and **cost center**.  
2. Exports are **idempotent** and **replayable** from locked runs.  
3. Formats are **vendor-neutral** (CSV/JSON); ERP-specific adapters come later.  
4. No automatic journal posting in P21-A/B.

---

## 2. Journal export readiness

### Canonical journal line (logical)

| Field | Source |
|-------|--------|
| `posting_date` | `payroll_runs.approved_at` |
| `period_label` | `payroll_periods.period_label` |
| `run_id` | `payroll_runs.id` |
| `employee_id` | optional on line |
| `gl_account` | `payroll_components.gl_account_code` |
| `cost_center` | `employees.org_unit_id` → mapping table |
| `debit` / `credit` | Derived from component class |
| `amount` | `payroll_component_values.amount` |
| `currency` | run currency |
| `description` | component name + period |

### Entry pattern (simplified accrual)

| Line | Debit | Credit |
|------|-------|--------|
| Salary expense | gross earnings | |
| Employer contributions | employer portion | |
| Payable (net pay) | | net pay |
| Deductions payable | | deductions |

**P21-B:** `hr.payroll.journal.json` export report.

---

## 3. ERP / accounting export strategy

| Tier | Format | Consumer |
|------|--------|----------|
| T0 | JSON lines | Internal data warehouse |
| T1 | CSV (flat) | Generic ERP import |
| T2 | Vendor adapters | SAP, Oracle, QuickBooks (future plugins) |

**Plugin pattern:** Same as P20-E connectors — `AccountingExporter` interface by `erp_key`.

| Method | Responsibility |
|--------|----------------|
| `validateMapping()` | GL codes complete |
| `buildJournal(runId)` | Lines array |
| `format(fileType)` | CSV/XML |

**Not in scope:** Live API posting, OAuth to ERP.

---

## 4. Bank file readiness

### Logical bank payment row

| Field | Source |
|-------|--------|
| `beneficiary_name` | employee.full_name |
| `iban` | employee bank field (future) or HR master |
| `amount` | payslip.net |
| `currency` | payslip.currency |
| `reference` | payslip_number |
| `value_date` | run pay date |

### Formats (future)

| Code | Region |
|------|--------|
| `generic_csv` | Universal |
| `sarie` | KSA (design placeholder) |
| `ach` | US (placeholder) |

**P21-A:** Document schema only; **no file generation**, **no disbursement automation**.

---

## 5. Cost center support

| Level | Field |
|-------|-------|
| Employee | `employees.org_unit_id` |
| Override | `compensation_adjustments.cost_center_code` |
| Default | workspace default in policy |

Mapping table (future): `payroll_gl_mappings (workspace_id, org_unit_id, gl_account, cost_center)`.

---

## 6. GL mapping foundation

Extend `payroll_components`:

| Column | Purpose |
|--------|---------|
| `gl_account_code` | Expense/payable account |
| `gl_account_type` | expense \| liability \| asset |
| `counter_account_code` | Paired account for double-entry |

Validation at run lock: all included components must have GL codes if `payroll.policies.require_gl_mapping = true`.

---

## 7. Export controls

| Control | Rule |
|---------|------|
| Timing | Only `locked` runs |
| Idempotency | `export_batch_id` per run + format |
| Audit | `report_access_logs` |
| Encryption | At-rest via document storage |
| Re-export | Same content hash unless correction run |

---

## 8. Legacy state

| Item | Status |
|------|--------|
| GL on `hr_salary_components` | **Not present** |
| Cost center on employee | `org_unit_id` exists |
| Accounting exports | **None** |
| Bank fields on employee | Check HR schema in P21-B |

---

## 9. Dependencies

| Dependency | Phase |
|------------|-------|
| Decimal money types | P21-B |
| Locked runs | P21-B |
| Component values table | P21-B |
| Report registry keys | P21-C |

---

## 10. Explicit exclusions (P21-A)

- No SAP/Oracle connectors  
- No live bank API  
- No tax filing  
- No automatic payment execution  
