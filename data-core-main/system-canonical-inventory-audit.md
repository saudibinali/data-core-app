# System Canonical Inventory Audit

**Audit date:** 2026-05-20  
**Scope:** Full repository (`data-core-main/`) — discovery only, no code changes  
**Phase reports reviewed:** 129+ `workflow-phase-*.txt` files (P1–P25-C), 110+ `p*-*.md` design/implementation docs

---

## 1. Executive classification model

| Class | Meaning |
|-------|---------|
| **Runtime Production-Ready** | End-to-end flows work: DB + services + APIs + UI (where applicable) + tests/smoke evidence |
| **Runtime Partial** | Core engine or APIs exist; UI incomplete, legacy parallel paths, or missing enterprise ops |
| **Foundation Only** | Schema + services + routes; limited UI or no operational closure |
| **Design Only** | Architecture/strategy docs; no or minimal runtime |
| **Deprecated** | Legacy paths maintained; canonical replacement exists |
| **Experimental** | Smoke tests / governance intelligence; not productized |

---

## 2. Domains present in codebase (actual)

### Platform & tenancy

| Domain | Class | Evidence |
|--------|-------|----------|
| Workspace / multi-tenant | **Runtime Partial** | `workspaces`, JWT `workspaceId`, 67 API routers, module settings |
| Platform admin (super-admin) | **Runtime Partial** | `/super-admin/*`, platform governance P23-A |
| Commercial / billing | **Runtime Partial** | `commercial_*` routes, tenant billing, subscription read UI |
| Module catalog | **Runtime Production-Ready** | `platform_modules` seed (20 modules), `ModuleGovernanceService` |
| Entitlements / quotas | **Foundation Only** | Schema + routes; enforcement varies by route |

### Collaboration & productivity

| Domain | Class | Evidence |
|--------|-------|----------|
| Tickets | **Runtime Production-Ready** | Full UI + routes + events |
| Messages | **Runtime Partial** | UI + API |
| Calendar | **Runtime Partial** | UI + API |
| Forms / self-service | **Runtime Partial** | Forms engine; `/forms` redirects to self-service |
| Dashboard | **Runtime Partial** | Dashboard API + page |
| Departments (legacy org) | **Runtime Partial** | **Deprecated** vs `hr_org_units` (P18-A) |
| Groups / users | **Runtime Partial** | Parallel to HR employee model |

### HCM (Human Capital)

| Domain | Class | Evidence |
|--------|-------|----------|
| Employees / HR foundation | **Runtime Partial** | `hr.ts` (155 route handlers), employees UI |
| HR services catalog | **Runtime Partial** | Services admin + self-service |
| Leave | **Foundation Only** | Canonical `leave_requests` + `routes/leave.ts`; legacy `hr_employee_leaves` |
| Onboarding | **Design Only** | Mentioned in HR module copy; no ATS/onboarding module |
| Attendance | **Runtime Partial** | P20-A–F: canonical `attendance_*`, import, geofence, integration hub, ops center |
| Payroll | **Runtime Partial** | P21-A–D: canonical `payroll_*` + `legacy-payroll-bridge` + ops UI |
| Performance | **Design Only** | No schema/services |
| LMS | **Design Only** | No schema/services |
| Succession | **Design Only** | No schema/services |
| ATS / recruiting | **Design Only** | No schema/services |

### ERP expansion (post-HCM)

| Domain | Class | Evidence |
|--------|-------|----------|
| Finance | **Foundation Only** → **Runtime Partial** | P22-A–D: COA, periods, **prepare** batches (not full GL posting); ops UI at `/admin/finance/ops` only |
| Procurement | **Runtime Partial** | P24-A design, P24-B foundation, P24-C UI + ops |
| Inventory | **Runtime Partial** | P24-D design, P25-A/B runtime, P25-C UI + ops |

### Automation & intelligence

| Domain | Class | Evidence |
|--------|-------|----------|
| Workflow engine | **Runtime Partial** | 47 prod files, 42 tests, executor + 7 step types; product coverage uneven |
| Approvals (generic) | **Runtime Partial** | `approvals` table + workflow steps; redirects to self-service |
| Notifications | **Runtime Partial** | DB queue processor, SSE, bus listeners (procurement, inventory, payroll partial) |
| Documents | **Runtime Partial** | P19-C registry, folders, access, procurement/inventory attach |
| Reporting | **Runtime Partial** | P19-D/E export jobs, ~40+ report keys, mostly JSON generators |
| Analytics | **Design Only** | Governance analytics super-admin; no workspace analytics product |
| AI / automation | **Experimental** | Workflow governance intelligence modules; no LLM product surface |

---

## 3. Workspace modules (seeded — `artifacts/api-server/src/seed/modules.ts`)

| Key | Nav path | defaultEnabled | Class |
|-----|----------|----------------|-------|
| home | /home | true | Runtime |
| dashboard | /dashboard | true | Runtime |
| messages | /messages | true | Runtime |
| calendar | /calendar | true | Runtime |
| tickets | /tickets | true | Runtime |
| approvals | null | true | Partial (no dedicated nav) |
| procurement | /procurement | true | Runtime Partial |
| inventory | /inventory | **false** | Runtime Partial |
| departments | /departments | true | Legacy runtime |
| groups | /groups | true | Runtime |
| users | /users | true | Runtime |
| notifications | /notifications | true | Runtime |
| roles | /roles | true | Runtime |
| workflows | /workflows | true | Runtime Partial |
| forms | null | true | Partial |
| hr | /hr | true | Runtime Partial |
| report-center | /hr/reports | true | Runtime Partial |
| self-service | /self-service | true | Runtime Partial |
| billing | /billing/invoices | true | Runtime Partial |
| subscription | /subscription/status | true | Runtime Partial |

**Not in module catalog:** `finance` (routed under `/admin/finance/ops` with `moduleKey="hr"`).

**Module dependencies** (`MODULE_DEPENDENCIES`): payroll→hr, finance→hr, procurement→hr, inventory→procurement+hr.

---

## 4. Runtime systems inventory

| System | Location | Maturity |
|--------|----------|----------|
| API server (Express) | `artifacts/api-server` | Primary backend |
| Ops platform UI (React) | `artifacts/ops-platform` | Primary workspace UI |
| DB package (Drizzle) | `lib/db` | 192 tables, migrations 0000–0019 |
| Event bus | `lib/events`, `@workspace/core-events` | Dual path: `appEventBus` + legacy `eventDispatcher` bridge |
| Workflow engine | `lib/workflows/` | Mature engine, variable product adoption |
| Report export pipeline | `lib/reports/` | DB-backed jobs, 10s poll, no Redis |
| Notification queue | `lib/notifications/` | DB-backed, 30s poll |
| Document registry | `lib/documents/` | Runtime Partial |
| Workforce integration | `lib/workforce-integration/` | Sync worker, webhooks |
| Platform governance | `lib/platform/` | P23-A control plane |

---

## 5. Foundations vs design-only (by phase family)

| Phase range | Typical deliverable | Runtime? |
|-------------|---------------------|----------|
| P18 | HR architecture **decisions** | Design + constraints |
| P19 | Notifications, documents, reporting **infra** | Foundation → Partial runtime |
| P20 | Attendance canonical + import + ops | Partial runtime |
| P21 | Payroll canonical + calculation + ops | Partial runtime |
| P22 | Finance canonical + prepare (no posting) | Foundation + partial |
| P23 | Platform governance | Partial runtime |
| P24 | Procurement design (A) + foundation (B) + UI (C) | Partial runtime |
| P24-D / P25 | Inventory design + foundation + movement + UI | Partial runtime |

Earlier phases (P1–P17): platform core, workflows, governance dashboards, leave canonical schema, commercial layer — mixed **Runtime Partial**.

---

## 6. Architectural drifts (documented)

1. **Dual HR models:** `hr_*` legacy vs `payroll_*` / `attendance_*` / `leave_requests` canonical with explicit bridges.
2. **Org duplication:** `departments` vs `hr_org_units` (P18-A: do not extend departments for HR).
3. **Person duplication:** `users` vs `employees` (intentional split; UI still overlaps).
4. **Finance outside module catalog:** No `finance` workspace module; ops buried under HR admin path.
5. **ERP scope creep:** Procurement + inventory added without full HCM closure (ATS, performance, LMS absent).
6. **Event dual pipeline:** New code should use `appEventBus`; many legacy events still dispatcher-only.
7. **Migration meta drift:** Drizzle journal has 20 entries; only `0000_snapshot.json` in meta (hand-authored SQL risk).
8. **Route monolith:** `routes/hr.ts` (~155 handlers) vs domain service layers for newer modules.
9. **UI ≠ operations:** Inventory/procurement list UIs exist; several create/edit wizards missing (phase reports acknowledge).
10. **Tables ≠ features:** ~192 tables; many governance/reliability tables are platform ops, not tenant HR product.

---

## 7. Deprecated / legacy areas

- `hr_payroll_*`, `hr_attendance`, `hr_employee_leaves` — bridges to canonical
- `departments` / `user_departments` — RBAC-oriented legacy org
- Legacy `eventDispatcher` path for unpromoted `EVENTS` entries
- Forms path `/forms` → redirect self-service

---

## 8. Experimental areas

- Workflow governance intelligence (`governance-policy-intelligence`, evidence packaging, remediation)
- Super-admin governance topology/readiness/evidence UIs
- Commercial risk engine

---

## 9. Workflow-phase report index (latest by domain)

| Report | Status claimed |
|--------|----------------|
| workflow-phase-25c | Inventory UI COMPLETE |
| workflow-phase-25b | Movement engine COMPLETE |
| workflow-phase-25a | Inventory foundation COMPLETE |
| workflow-phase-24d | Inventory architecture DESIGN |
| workflow-phase-24c | Procurement UI COMPLETE |
| workflow-phase-23a | Platform governance PARTIAL |
| workflow-phase-22d | Finance ops PARTIAL |
| workflow-phase-21d | Payroll ops PARTIAL |
| workflow-phase-20f | Workforce ops PARTIAL |
| workflow-phase-19d/e | Reporting PARTIAL |

*Earlier phase reports (P1–P17) document workflow engine maturation, platform setup, governance, and leave — treat as historical evidence of incremental build.*

---

## 10. Strict overall platform verdict

**The project is a multi-tenant workspace platform with a strong workflow/governance core and partial HCM + emerging ERP modules — not a complete HCM suite and not a complete ERP.**

- **Built for real use today:** tickets, workspace admin, modules, roles, workflows (power users), HR employees foundation, attendance/payroll **pipelines** (with bridges), procurement/inventory **operational APIs + list UIs**.
- **Not production-complete as enterprise HCM:** no ATS, LMS, performance, succession; leave canonical not fully cut over.
- **Not production-complete as finance ERP:** prepare/reconcile readiness; explicit no GL posting in phase constraints.
- **Design debt is intentional and documented** in P18–P25 docs; runtime lags design for several domains.
