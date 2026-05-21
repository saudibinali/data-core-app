# Backend Runtime Audit (api-server)

**Root:** `artifacts/api-server/src`  
**Routers mounted:** 67 modules via `routes/index.ts` under `/api`  
**Lib:** 384 TS files, **74** `*-service.ts` files

---

## 1. Service layer by domain

| Domain folder | Services | Route file(s) | Maturity |
|---------------|----------|---------------|----------|
| **inventory** | 14 | `inventory.ts` | **Runtime Partial** — full movement engine P25-B, list APIs P25-C |
| **finance** | 15 | `finance-canonical.ts`, `finance-operations.ts`, `finance-governance.ts` | **Foundation + Partial** — prepare, no GL post |
| **payroll** | 10 | `payroll-canonical.ts`, `payroll-operations.ts` | **Runtime Partial** + `legacy-payroll-bridge.ts` |
| **procurement** | 8 | `procurement.ts` | **Runtime Partial** |
| **workforce-attendance** | 9 | `workforce-attendance.ts`, import, integrations | **Runtime Partial** |
| **workforce-integration** | 3 | `attendance-integrations.ts` | **Runtime Partial** |
| **workforce-ops** | 2 | `workforce-operations.ts` | **Runtime Partial** |
| **documents** | 3 | via attach routes | **Runtime Partial** |
| **reports** | 3 | `reports.ts` | **Runtime Partial** |
| **platform** | 6 | `platform-governance.ts`, tenants, modules | **Runtime Partial** |
| **workflows** | 0 `*-service` | `workflows.ts` (~3500 lines) | **Runtime** engine in `lib/workflows/` |
| **hr** | 0 in lib | `hr.ts` (~155 handlers) | **Runtime Partial** — monolith |
| **leave** | 0 | `leave.ts` | **Foundation** |
| **notifications** | processor | `notifications.ts` | **Runtime Partial** |
| **commercial** | helpers only | `commercial*.ts` | **Runtime Partial** |

---

## 2. API surface (prefix families)

| Prefix | Purpose |
|--------|---------|
| `/auth`, `/setup`, `/healthz` | Identity & bootstrap |
| `/workspaces`, `/invitations`, `/users` | Tenancy & directory |
| `/platform/*`, `/platform/tenants/:tenantId/*` | Platform + commercial |
| `/modules` | Module enablement |
| `/workspace-roles`, `/permissions` | RBAC |
| `/workflows`, `/governance`, `/events` | Automation |
| `/hr/*` | Legacy + employee HR monolith |
| `/hr/workforce/*` | Canonical attendance |
| `/hr/payroll/canonical/*`, `/hr/payroll/ops/*` | Canonical payroll |
| `/finance/*`, `/finance/ops/*` | Finance |
| `/procurement/*` | Procurement |
| `/inventory/*` | Inventory |
| `/hr/leave-requests/*` | Canonical leave |
| `/reports/*` | Export jobs & definitions |
| `/notifications/*`, `/stream` | Comms |
| `/tickets`, `/messages`, `/calendar`, `/forms` | Collaboration |

---

## 3. Event systems

| Component | Role |
|-----------|------|
| `appEventBus` | Canonical emit path |
| `notifications-bus.ts` | Listeners: procurement (5), inventory (5), leave, payroll partial, tickets, etc. |
| `activity.ts` | Activity log writes |
| `bridge.ts` | Wildcard → legacy `eventDispatcher` → WorkflowEngine |
| `@workspace/core-events` | EVENT_TYPES catalog |

**Gaps:** Not all domain actions emit bus events; some only `workspace_event_logs` via dispatcher. Finance events largely absent from EVENT_TYPES.

---

## 4. Background processors (`init-sequence.ts`)

| Processor | Interval | Backing |
|-----------|----------|---------|
| Workflow engine | continuous | DB |
| Governance scheduler | 5 min | DB |
| Notification queue | poll | DB |
| Export jobs | ~10s | DB |
| Scheduled reports | cron-parser | DB |
| Attendance sync worker | poll | DB |

**No Redis** for these jobs (by design in comments).

---

## 5. Workflow runtime

- **Engine:** `lib/workflows/engine.ts` — trigger matching, executions
- **Executor:** `lib/workflows/executor.ts` — 7 step types
- **Tests:** 42 files under `workflows/__tests__/`
- **Product:** Definitions per workspace; used for approvals, HR services, cross-domain triggers

**Maturity:** Engine **GO**; domain adoption **PARTIAL**.

---

## 6. Governance services

| Layer | Files |
|-------|-------|
| Workspace governance | `routes/governance.ts`, workflow governance modules |
| Platform governance | P23-A `platform-governance-*`, audit logs |
| Finance governance | `finance-posting-governance-service`, ops routes |
| Module governance | `module-governance-service.ts` |

---

## 7. Reporting services

- `report-definition-registry.ts` — **~45** definitions (hr, payroll, finance, procurement, inventory)
- `report-generators.ts` — domain switches
- `export-job-processor.ts`, `scheduled-report-scheduler.ts`
- PDF: payslip + limited templates

---

## 8. Dead / duplicate / incomplete signals

| Signal | Detail |
|--------|--------|
| **Duplicate payroll paths** | `hr.ts` legacy payroll + canonical services |
| **Duplicate attendance** | `hr_attendance` + `attendance_*` + bridges |
| **Duplicate approval** | `procurement-approval-service` vs workflow approval steps |
| **HR monolith** | Business logic in routes vs services for newer domains |
| **Incomplete emitters** | Leave lifecycle EVENT_TYPES without all emitters (documented in constants.ts) |
| **Finance posting** | Explicitly out of scope — prepare only |
| **Route-only domains** | Tickets, messages — no `lib/` service layer (acceptable pattern) |

---

## 9. Smoke test coverage (evidence of runtime)

| Test file | Domain |
|-----------|--------|
| p25a/p25b inventory | inventory |
| p24c procurement events/UI | procurement |
| p23a governance | platform |
| p21/p20 smoke tests | payroll, attendance |
| workflows/__tests__ (42) | workflow |

Full CI coverage not verified in this audit session.

---

## 10. Backend maturity (strict)

| Layer | % | Notes |
|-------|---|-------|
| Platform/auth/modules | 75 | Solid |
| Workflow engine | 80 | Strong |
| HCM APIs | 55 | Bridges + monolith |
| Payroll runtime | 50 | Calc + ops; legacy coexistence |
| Finance runtime | 40 | Prepare/reconcile; no post |
| Procurement runtime | 55 | APIs > AP/payments |
| Inventory runtime | 50 | Movement GO; UI/API gaps |
| Notifications/reports | 60 | Infra GO; domain coverage partial |

**Overall backend: Runtime Partial (~58%)** — strong platform/automation core, uneven domain completeness.
