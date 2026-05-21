# Workflow & Automation Audit

**Engine:** `artifacts/api-server/src/lib/workflows/`  
**Routes:** `routes/workflows.ts`, `routes/governance.ts`, `routes/approvals.ts`

---

## 1. Workflow engine maturity

| Component | Status |
|-----------|--------|
| Definition storage | `workflow_definitions` — **Runtime** |
| Execution storage | `workflow_executions`, `workflow_tasks` — **Runtime** |
| Trigger matching | Event-driven from `workspace_event_logs` / bus bridge — **Runtime** |
| Step types (7) | approval, assignment, condition, delay, notification, status-update, task — **Runtime** |
| Delay scheduler | **Runtime** (P6-A) |
| Simulation / validation | **Runtime** (admin tooling) |
| Tests | 42 test files — **Strong** |

**Verdict:** Engine **GO** (~80% architecture maturity).

---

## 2. Workflow templates & product

| Aspect | Status |
|--------|--------|
| Seed workflows | `seed/workflows.ts` at init |
| Per-workspace definitions | UI at `/workflows` — **Runtime** |
| HR service triggers | **Partial** — depends on configuration |
| Procurement approvals | **Partial** — `procurement-approval-service` + policy gates |
| Payroll run workflow | `payroll-run-workflow.ts` — **Partial** |
| Finance posting workflow | **NOT PRESENT** (finance prepare is service-driven) |
| Inventory approvals | Policy-based transfer approval — **Partial** (not full workflow UI) |

---

## 3. Approval systems (multiple channels)

| Channel | Used by |
|---------|---------|
| Workflow approval steps | Generic, HR services, tickets |
| `approvals` table + API | Legacy/simple queue |
| Procurement approval service | PR/PO policy |
| Leave approval steps | Canonical leave |
| Transfer pending_approval | Inventory service |

**Drift:** Three patterns coexist — workflow-centric vs domain-specific vs legacy approvals.

---

## 4. Automations & triggers

| Trigger source | Maturity |
|----------------|----------|
| Domain EVENT_TYPES (bus) | Growing — ticket, leave, payroll, procurement, inventory, attendance |
| Legacy EVENTS (dispatcher) | Still active for unpromoted events |
| Scheduled (cron) | Scheduled reports only — not general automation |
| Webhooks | Attendance integration webhooks — **Partial** |

**SLA systems:** Not found as first-class product — delay steps only.  
**Escalation:** Governance remediation modules — **experimental**, not tenant SLA product.

---

## 5. Event orchestration

```
appEventBus.emit()
  → activity listener
  → notifications-bus listener
  → bridge → eventDispatcher → workspace_event_logs + WorkflowEngine
```

| Domain | Bus emit | Notification listener |
|--------|----------|----------------------|
| Tickets | Partial | Partial |
| Leave | Partial | Partial |
| Payroll | Partial | Partial |
| Procurement | **Yes** | **Yes** |
| Inventory | **Yes** | **Yes** |
| Finance | **No** | **No** |
| Attendance | **Yes** | Partial |

---

## 6. Background automation

| Job | Purpose |
|-----|---------|
| Workflow engine loop | Process executions |
| Governance scheduler | Snapshots / prune |
| Notification processor | Deliver notifications |
| Export processor | Report jobs |
| Scheduled report scheduler | Cron schedules |
| Attendance sync worker | Integration polling |

---

## 7. Classification

| Type | Examples |
|------|----------|
| **Real runtime workflows** | Ticket flows, configured HR automations, workflow-triggered notifications |
| **Partial workflows** | Procurement PO approve (event + optional workflow), payroll run states |
| **Hardcoded / service workflows** | Inventory transfer submit/approve in service, not visual workflow designer |
| **Missing orchestration** | Finance period close, inventory reservation auto-expiry job, cross-module ERP close |

---

## 8. Verdict

| Area | Rating |
|------|--------|
| Workflow engine | **GO** |
| Tenant workflow product | **PARTIAL** |
| Cross-domain orchestration | **PARTIAL** |
| SLA / escalation product | **BLOCKED** |
| Unified approval model | **PARTIAL** |

**Workflow & automation overall: PARTIAL (~62%)**
