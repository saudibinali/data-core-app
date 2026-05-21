# P21-A — Payslip & Reporting Strategy

---

## 1. Payslip generation

| Stage | Output |
|-------|--------|
| Calculate | `payroll_component_values` + totals on `payroll_run_employees` |
| Draft payslip | `payroll_payslips.status = draft` |
| Issue | `status = issued`, assign `payslip_number` |
| PDF | Store in Document Registry |

### PDF content blocks

1. Employer header (workspace branding)  
2. Employee identity (name, number, department)  
3. Period label + pay date  
4. Earnings table (component lines)  
5. Deductions table  
6. Gross / net summary  
7. YTD totals (`ytd_json`)  
8. Localized labels (AR/EN)

**Generator:** Reuse P19 `pdf-report-generator` pattern with template `hr.payroll.payslip.pdf` (P21-C).

---

## 2. PDF readiness

| Requirement | Approach |
|-------------|----------|
| Template engine | HTML → PDF (existing report stack) |
| Storage | `documents` + `generated_reports` link |
| Versioning | `document.version` on re-issue |
| Void payslip | PDF marked VOID watermark |

---

## 3. Secure download

| Actor | Path |
|-------|------|
| Employee | `GET /hr/me/payslips/:id/download` → signed URL |
| HR | `GET /hr/payroll/payslips/:id/download` → `hr.manage` |
| Audit | `report_access_logs` + workforce access log |

| Control | Detail |
|---------|--------|
| Auth | Session + workspace |
| Authorization | Employee can only own `employee_id` |
| Expiry | Short-lived download token (15 min) |
| Watermark | Employee name + date on PDF |

---

## 4. Employee self-service

| Feature | Status |
|---------|--------|
| List payslips | **GO** (`/hr/me/payslips`) |
| Detail + lines | **GO** |
| PDF download | **NOT IMPLEMENTED** |
| Push notification on issue | **NOT IMPLEMENTED** |

**P21-B:** Add notification `payroll.payslip.issued` on bus.

---

## 5. Payroll exports (HR)

| Export | Format | Report key (proposed) |
|--------|--------|------------------------|
| Payroll register | xlsx/csv | `hr.payroll.register` |
| Component breakdown | xlsx | `hr.payroll.components` |
| Bank payment file | csv | `hr.payroll.bank.csv` (readiness only) |
| Payslip batch ZIP | zip | `hr.payroll.payslips.zip` |

Registered in `report-definition-registry`; generated via `export_jobs` (no Redis).

---

## 6. Audit exports

| Export | Content |
|--------|---------|
| Run audit trail | Run metadata, approvers, policy version |
| Input snapshot | Per-employee `input_snapshot_json` |
| Comparison | Preview vs final delta |

Format: JSON (`generated_reports`) for compliance archives.

---

## 7. `generated_reports` integration

```text
POST /api/reports/export
  reportDefinitionKey: hr.payroll.register
  parameters: { payrollRunId, format: xlsx }
    → export_jobs → artifact → generated_reports
```

| Field | Value |
|-------|-------|
| `reportDefinitionKey` | `hr.payroll.*` |
| `parametersJson` | `{ "payrollRunId": 123 }` |
| `expiresAt` | 30–90 days per sensitivity |
| `permission` | `hr.payroll.export` |

---

## 8. Coexistence with legacy payslip tables

| Phase | Strategy |
|-------|----------|
| P21-B | Dual-write `hr_payslips` + `payroll_payslips` |
| P21-C | UI reads canonical |
| P21-D | Deprecate legacy write |

Line items: migrate `hr_payslip_lines` → `payroll_component_values`.

---

## 9. Reporting impact on P20

| P20 report | Change |
|------------|--------|
| `hr.attendance.period` | Add footnote: payroll uses same summaries when locked |
| Workforce ops | Show period lock status |

---

## 10. Gaps (P21-A)

- No payslip PDF template  
- No payroll report definitions registered  
- No `payroll.*` events on bus  
- YTD not calculated  
