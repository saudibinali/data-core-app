# P21-A — Payroll Security & Compliance

---

## 1. Salary confidentiality

| Control | Requirement |
|---------|-------------|
| Least privilege | Separate permissions from generic `hr.manage` |
| Field masking | Mask amounts in list APIs for non-payroll roles |
| Logging | Never log net pay in debug traces |
| Encryption at rest | DB + document storage (platform default) |
| Encryption in transit | TLS |

### Proposed permissions (P21-B)

| Permission | Capability |
|------------|------------|
| `hr.payroll.view` | Read runs and payslips |
| `hr.payroll.calculate` | Preview runs |
| `hr.payroll.approve` | Finalize runs |
| `hr.payroll.export` | GL/bank exports |
| `hr.payroll.admin` | Policies, components |

Employee self-service: **own payslips only**.

---

## 2. Payroll permissions (current vs target)

| Action | Today | Target |
|--------|-------|--------|
| View components | `hr.manage` | `hr.payroll.view` |
| Process run | workspace admin | `hr.payroll.approve` |
| View own payslip | authenticated | same + audit |
| Export | not available | `hr.payroll.export` |

---

## 3. Audit requirements

| Event | Storage |
|-------|---------|
| Run created / calculated | bus + structured log |
| Approved / locked | `payroll_runs` timestamps + user IDs |
| Adjustment created | `compensation_adjustments` |
| Export downloaded | `report_access_logs` |
| Break-glass unlock | dedicated audit row |

**Gap:** No `payroll_access_logs` table—use P19 `report_access_logs` + workforce log until dedicated table in P21-B.

---

## 4. Lock enforcement

| Layer | Enforcement |
|-------|-------------|
| API | Middleware rejects writes to locked period dates |
| Ingestion | `AttendanceIngestionService` checks lock |
| Replay (P20-F) | Ops replay blocked when locked |
| Calculation | Final run requires lock flag |

Break-glass: super_admin role + mandatory `reason` field; notify HR admins.

---

## 5. Workspace isolation

- All payroll tables include `workspace_id`.  
- FK cascades on workspace delete (policy: soft-delete workspace instead).  
- Cross-workspace payslip access **404**, not 403, to avoid enumeration.

---

## 6. Payroll retention

| Artifact | Retention |
|----------|-----------|
| Payslip PDF | 7+ years (configurable `retention_years` in policy) |
| Run data | Same as payslips |
| Preview runs | 90 days then purge |
| Export files | Per `generated_reports.expiresAt` |

Legal hold flag (future): `legal_hold` on run prevents purge.

---

## 7. Export security

| Risk | Mitigation |
|------|------------|
| Bank file leak | `hr.payroll.export` only; encrypted download |
| Email payslip | Opt-in; password-protected PDF (future) |
| Bulk export | Rate limit + job queue |

---

## 8. Compliance alignment (high level)

| Topic | P21-A stance |
|-------|--------------|
| SOX-style controls | Lock + approve + audit trail design |
| GDPR / PDPL | Employee access + retention + minimize fields |
| WPS (KSA) | Bank file readiness only; no filing |
| Tax reporting | Out of scope |

---

## 9. Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Unauthorized payslip view | employee_id check |
| Salary tampering after lock | DB constraints + API |
| Admin process without review | Replace auto-approve |
| Float rounding fraud | Decimal types |
| Retro ingest after pay | attendance lock |

---

## 10. P20 workforce platform alignment

| P20 control | Payroll benefit |
|-------------|-----------------|
| Source trust levels | Weight evidence in disputes only |
| Integration secrets | N/A to payroll |
| Ops replay audit | Correlates to pay corrections |

---

## 11. P21-B security deliverables

1. Permission split  
2. `payroll_access_logs` table  
3. Lock middleware on workforce routes  
4. Masked list DTOs  
