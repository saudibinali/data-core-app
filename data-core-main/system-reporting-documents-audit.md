# Reporting & Documents Audit

---

## 1. Reporting engine

| Component | File / table | Status |
|-----------|--------------|--------|
| Definitions registry | `report-definition-registry.ts` | **~45 keys** |
| Generators | `report-generators.ts`, domain `*-reports.ts` | **Runtime** |
| Export jobs | `report_export_jobs`, processor 10s poll | **Runtime** |
| Generated output | `generated_reports` | **Runtime** |
| Scheduled reports | `scheduled_reports` + cron | **Runtime** |
| Async threshold | env `REPORT_ASYNC_ROW_THRESHOLD` | **Runtime** |

**Formats:**
- **JSON:** dominant (finance, payroll, procurement, inventory)
- **XLSX/CSV:** HR roster, attendance period
- **PDF:** payslip, some HR exports

---

## 2. Report domains

| Module | Keys (approx) | Generator maturity |
|--------|---------------|-------------------|
| hr | 8 | Mixed |
| hr.payroll | 10 | Mostly JSON metadata |
| finance | 14 | JSON prepare/reconcile |
| procurement | 5 | JSON |
| inventory | 10 | JSON |

**UI:** report-center, procurement-reports, inventory-reports — export job creation only (not interactive analytics).

---

## 3. Export authorization

`export-authorization.ts`:
- Checks permission per definition
- Finance fallbacks to `hr.manage` in some paths — **governance concern**
- Platform reports separate path (P23)

---

## 4. PDF systems

- Payslip PDF template — **Runtime**
- Scheduled PDF reports (0005 migration) — **Partial**
- Broader PDF catalog — **limited**

---

## 5. Excel systems

- XLSX via report pipeline — **Partial** (few definitions)
- No dedicated Excel template engine beyond export job output

---

## 6. Document registry (P19-C)

| Table / feature | Status |
|-----------------|--------|
| documents, versions, folders | **Runtime** |
| access grants | **Runtime** |
| workspace scoping | **Runtime** |
| procurement attach | **Runtime** |
| inventory GRN attach | **Runtime** |
| HR employee documents | **Partial** (HR routes) |

**document-bridge.ts** — integration helper for cross-domain attach.

---

## 7. Document permissions & lifecycle

| Capability | Status |
|------------|--------|
| Classification / confidential | **Runtime** (procurement, inventory flags) |
| Expiry on vendor docs | **Runtime** (procurement ops metrics) |
| Legal hold / retention policies | **Design / partial** |
| Full text search | **NOT EVIDENCED** |
| Version branching | **Basic versions** |

---

## 8. Missing enterprise capabilities

- Interactive BI / dashboards (analytics module absent)
- Regulatory filing packs
- Multi-currency consolidated reporting
- Signed PDF / digital signature workflow
- Report row-level security beyond workspace
- Real-time report streaming (batch only)

---

## 9. Maturity

| Area | % | Verdict |
|------|---|---------|
| Export job infrastructure | 75 | **GO** foundation |
| Domain report content | 50 | **PARTIAL** — many JSON stubs |
| PDF | 40 | **PARTIAL** |
| Excel | 35 | **PARTIAL** |
| Document registry | 60 | **PARTIAL** |
| Enterprise DMS | 25 | **FOUNDATION** |

**Reporting: PARTIAL (~55%)**  
**Documents: PARTIAL (~58%)**
