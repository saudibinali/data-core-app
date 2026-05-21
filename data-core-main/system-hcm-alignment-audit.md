# HCM Alignment Audit

**Reference architecture:** P18-A Workspace HR Architecture Decisions + `workspace-current-architecture-report.md`  
**Stated direction:** HCM-first platform with controlled ERP expansion (P18–P25 phase docs)

---

## 1. Canonical platform architecture (intended)

| Principle | Documented | Actual |
|-----------|------------|--------|
| `workspace_id` sole tenant boundary | P18-A | **Aligned** |
| `employees` = HR person SoT | P18-A | **Aligned** (UI/API active) |
| `users` = auth only | P18-A | **Mostly aligned** — overlap in /users UI |
| `hr_org_units` = HR org | P18-A | **Partial** — departments still active |
| `leave_requests` canonical | P18-A | **Partial** — legacy leave coexists |
| No new ERP without workspace boundary | P18-A | **Aligned** for finance/procurement/inventory |
| Finance/procurement reuse workspace | P18-A | **Aligned** |

---

## 2. HCM domain alignment matrix

| HCM domain | Planned (typical suite) | Codebase state | Alignment |
|------------|-------------------------|----------------|-----------|
| Core HR / employees | Yes | Runtime Partial | **Aligned** |
| Org structure | Yes | hr_org_units + legacy departments | **Drift** |
| Leave | Yes | Dual models | **Drift** |
| Attendance | Yes | Canonical + legacy bridge | **Aligned path, partial cutover** |
| Payroll | Yes | Canonical + legacy + ops | **Aligned path, partial cutover** |
| Onboarding | Yes | HR services/forms only | **Gap** |
| ATS / recruiting | Optional | Absent | **N/A — not started** |
| Performance | Optional | Absent | **Gap** |
| LMS | Optional | Absent | **Gap** |
| Succession | Optional | Absent | **Gap** |
| Benefits | Optional | Limited in payroll components | **Gap** |

---

## 3. ERP expansion vs HCM focus

| Module | Phase | HCM relationship | Expansion assessment |
|--------|-------|------------------|---------------------|
| Finance | P22 | Payroll export readiness; cost centers | **Moderate ERP** — prepare-only, no GL |
| Procurement | P24 | HR dependency; employee cost centers | **ERP add-on** — no AP/payments |
| Inventory | P24-D/P25 | Procurement PO linkage | **ERP add-on** — no manufacturing |

**Verdict:** Expansion is **documented and bounded** (no GL, no AP, no MRP). However **engineering velocity on ERP modules (24–25) exceeds closure of HCM gaps** (leave cutover, org deprecation, ATS).

---

## 4. What matches HCM architecture

- Workspace-scoped HR Foundation (employees, statuses, org units, documents)
- Self-service + HR services catalog
- Event-driven workflow hooks for HR processes
- Canonical attendance & payroll **schemas** with explicit legacy bridges
- Person/tenant decisions respected in new modules

---

## 5. What deviated

1. **departments** still first-class in UI/RBAC — P18 said do not extend for HR.
2. **hr.ts monolith** — predates service-layer pattern used in payroll/attendance.
3. **Finance UI** hidden under HR admin — module catalog inconsistency.
4. **Inventory default off, procurement on** — ERP surface area in nav without full ops maturity.
5. **129 phase reports** — process weight on ERP tracks vs single leave cutover phase completion.

---

## 6. What is missing (HCM)

- ATS, onboarding pipeline, performance cycles, LMS, succession
- Unified leave production path
- Employee–user provisioning flow (explicitly deferred P18)
- Workforce planning / scheduling (beyond attendance)
- Benefits administration

---

## 7. ERP-over-HCM risk areas

| Risk | Severity |
|------|----------|
| Team focuses on inventory/procurement while leave dual-model persists | Medium |
| Finance prepare without payroll posting closure | Medium |
| Permission complexity (HR + finance + ERP) | Medium |
| Table count growth without HCM feature parity | Low-Medium |

---

## 8. Strategic alignment score

| Dimension | % |
|-----------|---|
| Architectural principles (P18) | 70 |
| HCM feature completeness | 40 |
| ERP expansion discipline | 75 |
| Data model consistency | 55 |

**HCM alignment: PARTIAL (~60%)** — principles mostly held; product completeness lags; ERP modules ahead of talent modules.
