# System Runtime Readiness Matrix

**Audit date:** 2026-05-20  
**Scoring method:** Strict — foundation/schema/API-only does not score as GO. Percentages are engineering judgment from code + phase reports, not customer UAT.

**Legend:** GO | PARTIAL | BLOCKED | FOUNDATION ONLY

---

## Domain matrix

| Domain | Status | Runtime % | Architecture % | Governance % | Operational % | Notes |
|--------|--------|-----------|----------------|--------------|---------------|-------|
| **Authentication & Identity** | **GO** | 80 | 75 | 65 | 75 | JWT auth, setup, platform activate |
| **User Management** | **PARTIAL** | 65 | 60 | 60 | 60 | `/users` + HR employees split |
| **Permissions & Security** | **PARTIAL** | 60 | 70 | 58 | 55 | RBAC solid; SoD/IAM gaps |
| **ATS** | **BLOCKED** | 0 | 5 | — | 0 | No domain |
| **Onboarding** | **FOUNDATION ONLY** | 15 | 25 | 20 | 10 | Forms/services only |
| **Attendance** | **PARTIAL** | 55 | 70 | 50 | 50 | Canonical + import + ops; legacy bridge |
| **Payroll** | **PARTIAL** | 50 | 65 | 55 | 45 | Calc engine + ops; legacy UI path |
| **Performance** | **BLOCKED** | 0 | 0 | — | 0 | No domain |
| **LMS** | **BLOCKED** | 0 | 0 | — | 0 | No domain |
| **Succession** | **BLOCKED** | 0 | 0 | — | 0 | No domain |
| **Workflow Engine** | **GO** | 75 | 85 | 60 | 65 | Engine + tests strong |
| **Notifications** | **PARTIAL** | 55 | 65 | 50 | 50 | Queue + SSE; uneven domain coverage |
| **Documents** | **PARTIAL** | 50 | 60 | 55 | 45 | Registry + attach; not full DMS |
| **Analytics** | **BLOCKED** | 5 | 10 | — | 5 | Governance analytics only |
| **AI & Automation** | **FOUNDATION ONLY** | 10 | 30 | 15 | 5 | Workflow intelligence; no AI product |
| **Multi-Tenant** | **PARTIAL** | 70 | 75 | 65 | 60 | Workspace + subscriptions |
| **Platform Core** | **PARTIAL** | 65 | 70 | 55 | 60 | Modules, entitlements, commercial |
| **Admin Console** | **PARTIAL** | 60 | 65 | 50 | 55 | Super-admin + platform ops |
| **Finance** | **FOUNDATION ONLY** | 35 | 60 | 45 | 25 | Prepare/reconcile; no post; minimal UI |
| **Procurement** | **PARTIAL** | 50 | 65 | 55 | 45 | APIs + UI; no AP/payments |
| **Inventory** | **PARTIAL** | 45 | 65 | 50 | 40 | Movement GO; UI gaps; module off by default |

---

## Additional platform domains (not in requested list)

| Domain | Status | Runtime % | Notes |
|--------|--------|-----------|-------|
| Tickets | **GO** | 75 | Mature collaboration |
| Messages / Calendar | **PARTIAL** | 60 | Standard features |
| Forms / Self-service | **PARTIAL** | 50 | Redirects, HR forms |
| Leave (HCM) | **FOUNDATION ONLY** | 35 | Canonical schema; dual API |
| HR Employees | **PARTIAL** | 65 | Core directory |
| Reporting infra | **PARTIAL** | 60 | Jobs + JSON exports |
| Commercial / Billing | **PARTIAL** | 45 | Platform tenant billing |

---

## Roll-up (strict)

| Layer | Weighted verdict | Approx % |
|-------|------------------|----------|
| **HCM suite** (excl. blocked talent modules) | **PARTIAL** | **42** |
| **ERP modules** (finance, procurement, inventory) | **PARTIAL** | **43** |
| **Platform & automation** | **PARTIAL** | **62** |
| **Whole product** | **PARTIAL** | **~50** |

---

## GO criteria not met (why whole product is not GO)

1. No end-to-end talent acquisition or learning.
2. Leave not single canonical runtime.
3. Finance cannot post journals to GL.
4. ERP UIs lack full operational wizards (receipt lines, transfer create, etc.).
5. Legacy HR tables still reachable.
6. Finance not a first-class workspace module.

---

## BLOCKED vs FOUNDATION

- **BLOCKED:** No schema, no routes, no UI (ATS, LMS, performance, succession, analytics).
- **FOUNDATION ONLY:** Schema + services exist; tenant cannot run full business process without gaps (finance prepare, leave canonical, onboarding).

---

## Evidence anchors

- P25-C inventory UI: stock ops **PARTIAL**
- P24-C procurement UI: **PARTIAL** (no AP)
- P22-B finance: **prepare only**
- P21-D payroll ops: **PARTIAL**
- P20-F workforce ops: **PARTIAL**
- P23-A platform governance: **PARTIAL**
- P18-A: architecture decisions **not fully implemented**
