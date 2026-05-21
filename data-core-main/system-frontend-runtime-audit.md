# Frontend Runtime Audit (ops-platform)

**App:** `artifacts/ops-platform` (React + Vite + wouter + TanStack Query + `@workspace/api-client-react`)  
**Audit date:** 2026-05-20

---

## 1. Route inventory (~92 page components)

### Public / auth
| Route | Page | Backend |
|-------|------|---------|
| `/sign-in` | Sign-in | auth API |
| `/platform/activate` | Platform activate | platform invitations |
| `/setup` | Redirect sign-in | — |

### Super-admin (platform)
| Route | Functional level |
|-------|------------------|
| `/super-admin` | **Partial** — overview |
| `/super-admin/workspaces` (+ new, :id) | **Runtime** — lifecycle |
| `/super-admin/tenants` | **Partial** |
| `/super-admin/commercial-risk` | **Partial** |
| `/super-admin/platform-users` | **Runtime** |
| `/super-admin/platform-ops` | **Partial** — P23 ops center |
| `/super-admin/access-review` | **Partial** |
| `/super-admin/activity`, `/events` | **Runtime** |
| `/super-admin/settings` | **Partial** |
| `/super-admin/governance/*` | **Partial** — audit, violations, workflows, analytics, topology, readiness, evidence |

### Workspace (tenant)
| Route | Module key | Functional level |
|-------|------------|------------------|
| `/home` | home | **Runtime** |
| `/dashboard` | dashboard | **Runtime** |
| `/tickets`, `/tickets/new`, `/tickets/:id` | tickets | **Runtime** |
| `/departments` | departments | **Runtime** (legacy org) |
| `/groups` | groups | **Runtime** |
| `/messages` | messages | **Runtime** |
| `/users` | users | **Runtime** |
| `/notifications` | notifications | **Runtime** |
| `/calendar` | calendar | **Runtime** |
| `/roles` | roles | **Runtime** |
| `/workflows`, `/workflows/:id` | workflows | **Runtime Partial** — builder + executions |
| `/governance`, `/governance/history` | admin roles | **Partial** — admin-only |
| `/self-service` | self-service | **Runtime Partial** — HR forms |
| `/self-service/payslips`, `/leave`, `/attendance` | hr | **Runtime Partial** — me endpoints |
| `/billing/invoices` | billing | **Partial** |
| `/subscription/status` | subscription | **Partial** — read-only |
| `/settings` | — | **Runtime** |

### HR / workforce (under `/hr` and `/admin/hr`)
| Route | Functional level | Notes |
|-------|------------------|-------|
| `/hr` | **Runtime** | Dashboard |
| `/hr/employees`, `/new`, `/:id` | **Runtime** | Core HCM UI |
| `/hr/services` | **Partial** | Catalog |
| `/admin/hr/services/*` | **Partial** | Admin catalog |
| `/admin/hr/foundation` | **Foundation** | Config surface |
| `/admin/hr/payroll`, `/runs/:id` | **Partial** | Legacy HR payroll UI path |
| `/admin/hr/attendance` | **Partial** | Admin attendance |
| `/admin/hr/workforce-ops` | **Runtime Partial** | P20-F ops center |
| `/admin/hr/payroll-ops` | **Runtime Partial** | P21-D ops center |
| `/admin/finance/ops` | **Runtime Partial** | P22-D; **no finance module in sidebar** |
| `/hr/reports` | **Runtime Partial** | Report center |

### Procurement (`/procurement/*`) — P24-C
| Route | Functional level |
|-------|------------------|
| `/procurement` | **Runtime** — dashboard + metrics |
| `/procurement/vendors`, `/:id` | **Runtime** — CRUD, docs on detail |
| `/procurement/purchase-requests` | **Runtime Partial** |
| `/procurement/rfqs` | **Runtime Partial** |
| `/procurement/purchase-orders` | **Runtime Partial** |
| `/procurement/ops` | **Runtime** — ops center |
| `/procurement/policies` | **Partial** |
| `/procurement/reports` | **Runtime Partial** — export jobs only |

### Inventory (`/inventory/*`) — P25-C
| Route | Functional level |
|-------|------------------|
| `/inventory` | **Runtime** — dashboard |
| `/inventory/warehouses`, `/:id` | **Runtime Partial** — list/create; detail locations |
| `/inventory/items`, `/:id` | **Runtime Partial** |
| `/inventory/receipts` | **Partial** — list/post; **no line editor** |
| `/inventory/transfers` | **Partial** — list/actions; **no create wizard** |
| `/inventory/issues` | **Partial** — list/reverse only |
| `/inventory/reservations` | **Partial** |
| `/inventory/adjustments`, `/counts` | **Partial** |
| `/inventory/ops` | **Runtime** |
| `/inventory/policies`, `/reports` | **Partial** |

### Forms admin
| Route | Notes |
|-------|-------|
| `/admin/forms/*`, `/admin/hr/forms/*` | **Runtime Partial** — admin only |
| `/forms`, `/forms/:id` | **Disconnected** — redirect to self-service |

### Redirects
- `/approvals` → `/self-service`

---

## 2. Workspace modules vs UI

Navigation driven by `GET /api/modules` + `useListModules()` in `sidebar.tsx`.  
Icons mapped for Warehouse, procurement, HR, etc.

**Gaps:**
- `inventory` defaultEnabled **false** — UI exists but hidden until enabled
- `finance` has **no module entry** — only `/admin/finance/ops`
- `approvals`, `forms` have null `navigationPath`

---

## 3. Dashboards & operations centers

| Surface | Status |
|---------|--------|
| Workspace dashboard | **Runtime** |
| HR dashboard | **Runtime** |
| Procurement ops | **Runtime** |
| Inventory ops | **Runtime** |
| Workforce ops | **Runtime Partial** |
| Payroll ops | **Runtime Partial** |
| Finance ops | **Runtime Partial** |
| Super-admin platform ops | **Partial** |
| Governance dashboards (workspace + super-admin) | **Partial** — intelligence-heavy |

---

## 4. Workflows UI

- List + detail pages wired to `/api/workflows`
- **Functional** for definition management and execution visibility
- **Partial** for non-technical users (complexity, governance overlays)

---

## 5. Reporting UIs

| UI | Backend |
|----|---------|
| `/hr/reports` (report-center) | `/api/reports/*` export jobs |
| `/procurement/reports` | procurement.* definitions |
| `/inventory/reports` | inventory.* definitions |

Most exports are **JSON-first**; PDF/XLSX limited to subset (HR roster, attendance period, payslip PDF).

---

## 6. Classification summary

| Category | Count (approx) | Verdict |
|----------|----------------|---------|
| Fully functional E2E | ~15 route families | Tickets, auth, employees, modules, roles, parts of procurement |
| Partial (API > UI) | ~20 | Inventory stock ops, finance, payroll legacy paths, RFQ/PR |
| Foundation / config only | ~5 | HR foundation, policies pages |
| Redirect / disconnected | 3 | forms, approvals |
| Super-admin experimental | ~8 | governance intelligence |

---

## 7. Frontend disconnected from backend (known)

1. **Finance** — minimal UI vs 20+ finance API routes
2. **Inventory** — create flows for transfer/issue/receipt lines not in UI
3. **Leave canonical** — self-service leave uses API but legacy overlap in HR routes may still exist
4. **Legacy payroll UI** (`/admin/hr/payroll`) vs canonical `/hr/payroll/canonical/*` — parallel surfaces
5. **Datasource routes** — backend exists; no prominent UI in App.tsx grep

---

## 8. Strict frontend maturity

**~55% operational readiness** for a tenant admin (core collaboration + HR directory + procurement lists).  
**~35%** for full HCM (no ATS/LMS/performance UI).  
**~45%** for ERP ops (finance UI weakest).
