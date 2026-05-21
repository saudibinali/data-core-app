# HCM Integrated Platform — Product Specification

**Version:** 1.0  
**Date:** 2026-05-20  
**Positioning:** Enterprise **integrated Human Capital Management** — not ERP.

---

## 1. Product definition

| Principle | Rule |
|-----------|------|
| **Scope** | End-to-end employee & workforce lifecycle inside one platform |
| **Finance boundary** | **Payroll-scoped only** — salaries, allowances, deductions, payslips, statutory/bank export. No GL, AP, AR, procurement, inventory |
| **Integration** | Every HCM pillar shares the same employee record, org structure, permissions, workflows, documents, notifications, and reports |
| **Completeness** | No intentional gaps inside HCM — delivery is **phased**, architecture is **whole** |

**Out of scope permanently:** ERP domains removed in strategic refactor (see `hcm-strategic-refactor-audit.md`).

---

## 2. HCM pillars (integrated architecture)

```
Pillar 1  Identity & Access          → auth, roles, sessions
Pillar 2  Organization & Employee    → org units, employees, lifecycle
Pillar 3  Time & Absence             → attendance, leave, calendars
Pillar 4  Payroll (financial core)   → runs, components, payslips, export
Pillar 5  Service Delivery           → ESS / MSS, HR services, forms
Pillar 6  Process & Compliance       → workflows, approvals, audit
Pillar 7  Documents & Evidence       → contracts, IDs, confidential HR docs
Pillar 8  Workforce Intelligence     → dashboards, report center, exports
Pillar 9  Platform & Tenancy         → modules, entitlements, governance
```

Pillars **1–8** must reference the same `workspaceId` + `employeeId` — no shadow directories.

---

## 3. Delivery waves (global HCM practice)

| Wave | Focus | Modules (catalog keys) |
|------|--------|-------------------------|
| **W1 — Nucleus** (now) | Stable integrated core | `hr`, `payroll`, `attendance`, `self-service`, `workflows`, `report-center`, `approvals` |
| **W2 — Talent acquisition** | Hire → onboard | `recruiting` (future), onboarding checklists |
| **W3 — Develop** | Performance + learning | `performance`, `learning` (future) |
| **W4 — Succession & analytics** | Pipeline + advanced workforce AI | `succession`, advanced analytics (future) |

W1 criteria (ISO 30414 / SHRM-aligned minimum):

- [ ] Single employee golden record
- [ ] Manager + employee self-service for leave, attendance, payslips
- [ ] Payroll run → approve → payslip → export (external accounting)
- [ ] HR workflow templates (onboard, leave, payroll review)
- [ ] Workforce reports: roster, attendance, leave, payroll register
- [ ] HCM go-live gate (leave + payroll migration clean)

---

## 4. Module catalog (W1)

| Key | Name | Depends on | Path |
|-----|------|------------|------|
| `hr` | Human Resources | — | `/hr` |
| `payroll` | Payroll | `hr` | `/admin/hr/payroll` |
| `attendance` | Time & Attendance | `hr` | `/admin/hr/attendance` |
| `self-service` | Employee Self-Service | `hr` | `/self-service` |
| `report-center` | HR Report Center | `hr` | `/hr/reports` |
| `workflows` | Workflows | — | `/workflows` |
| `approvals` | Approvals | — | (queue) |

Platform modules (`messages`, `calendar`, `tickets`, …) remain **optional collaboration**, not HCM core.

---

## 5. Payroll-scoped finance (allowed)

- Salary structures, components, deductions, allowances  
- Payroll periods, runs, approvals, locks  
- Payslip generation & employee download  
- **Export readiness:** bank file / GL journal lines for **external** ERP — no in-platform posting  

**Forbidden:** `finance_*` tables, COA, trial balance, vendor payments, cost center operational accounting.

---

## 6. Governance

- `MODULE_DEPENDENCIES` — HCM-only graph (`lib/platform/module-governance-service.ts`)  
- `HCM_MODULE_KEYS` / `ERP_MODULE_KEYS_REMOVED` — `lib/platform/hcm-product-constants.ts`  
- Workspace go-live: `hcmGoLiveReady` — HR + leave + payroll cutover only  

---

## 7. References

- Cleanup log: `hcm-strategic-refactor-cleanup-log.md`  
- W1 execution checklist: `hcm-wave1-execution.md`  
