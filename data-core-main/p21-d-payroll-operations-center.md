# P21-D — Payroll Operations Center & Financial Export Readiness

## Scope

Phase P21-D adds operational governance, observability, exception handling, financial export **readiness** (no posting), policy versioning UI/APIs, audit views, and monitoring on top of the P21-B/C canonical payroll platform.

**Explicitly out of scope:** bank integrations, accounting posting, government integrations, salary disbursement automation, destructive migrations, ERP finance redesign, full tax engine, Redis redesign.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Ops Platform — /admin/hr/payroll-ops                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST /api/hr/payroll/ops/*
┌───────────────────────────▼─────────────────────────────────┐
│  payroll-operations.ts routes                               │
│  ├── PayrollOperationsService (overview, review, metrics)   │
│  ├── PayrollExceptionService (scan, acknowledge, resolve)   │
│  ├── FinancialExportService (GL journal, cost center, bank)  │
│  ├── PayrollPolicyOpsService (versioning)                   │
│  ├── PayrollAuditQueryService (DB audit logs)               │
│  └── PayrollComponentCatalog (GL mapping fields)            │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Canonical tables: payroll_runs, payroll_exceptions,        │
│  payroll_audit_logs, payroll_components (+ GL columns),       │
│  export_jobs, generated_reports, payroll_payslips           │
└─────────────────────────────────────────────────────────────┘
```

## Payroll operations workflows

| Workflow | Entry | Actions |
|----------|-------|---------|
| Run monitoring | `GET /hr/payroll/ops/overview` | Status counts, review queue, alerts |
| Review queue | `GET /hr/payroll/ops/review-queue` | Warning/excluded counts per run |
| Review detail | `GET /hr/payroll/ops/runs/:id/review` | Auto exception scan, employee warnings |
| Bulk approve/reject | `POST /hr/payroll/ops/review/bulk` | Approve runs in `review` (or submit then approve) |
| Exception scan | Auto after `calculateRun`; manual `POST .../exceptions/scan` | Persist open exceptions, notify on critical |
| Payslip ops | `POST .../payslips/:id/void`, `reissue-metadata` | Draft void, reissue metadata (no email) |

Run lifecycle remains: `draft` → `calculating` → `review` → `approved` → `locked` (P21-C).

## Exception lifecycle

1. **Detect** — `PayrollExceptionService.scanRun` checks excluded employees, review warnings, negative net, duplicate adjustments, missing attendance, approval blockers.
2. **Persist** — Rows in `payroll_exceptions` (status `open`).
3. **Notify** — Critical findings dispatch in-app notification via `dispatchUserNotification` (email disabled).
4. **Acknowledge / resolve** — Ops APIs update status; audit logged.

Codes: `MISSING_PACKAGE`, `MISSING_ATTENDANCE`, `NEGATIVE_NET`, `DUPLICATE_ADJUSTMENT`, `MISSING_APPROVAL`, `POLICY_VIOLATION`, `CALCULATION_ERROR`.

## Export readiness model

`FinancialExportService` prepares data only:

| Export | API | Content |
|--------|-----|---------|
| GL journal lines | `GET .../export/gl-journal` | Debit/credit per component, cost center, export code |
| Cost center summary | `GET .../export/cost-centers` | Aggregated debits/credits by cost center |
| Bank metadata | `GET .../export/bank-metadata` | Beneficiary, amount, reference — `bankReady: false`, no IBAN integration |
| Signed download | `POST .../export/signed-download` + `GET .../export/download?token=` | JWT-scoped JSON artifact |

`getExportReadiness` reports GL mapping completeness and locked run counts. No ERP posting.

## GL mapping foundation

Migration `0012_payroll_operations_export.sql` extends `payroll_components`:

- `debit_account_code`, `credit_account_code`, `cost_center_code`, `export_code`
- Legacy `gl_account_code` still used as fallback

Admin APIs: `GET/PATCH /hr/payroll/ops/components` and `.../components/:id/gl`.

## Policy governance

`PayrollPolicyOpsService` manages versioned rows in `payroll_policies`:

- Keys: `payroll.general`, `payroll.attendance`, `payroll.lock`, `payroll.deduction`, `payroll.overtime`, `payroll.correction`, `payroll.approval`
- `GET /hr/payroll/ops/policies` — grouped versions with effective dates
- `GET /hr/payroll/ops/policies/:policyKey/versions` — rollback visibility
- `POST /hr/payroll/ops/policies` — create new version (monotonic `version`)

## Payroll audit model

`payroll_audit_logs` stores operational events (access, exports, exceptions, payslip PDF access, policy changes). Query APIs:

- `GET /hr/payroll/ops/audit/logs`
- `GET /hr/payroll/ops/audit/break-glass`
- `GET /hr/payroll/ops/audit/corrections`
- `GET /hr/payroll/ops/audit/exports`
- `GET /hr/payroll/ops/audit/payslips`

Logger mirror retained for observability pipelines.

## Operational reporting

Registered in `report-definition-registry` and generated via `payroll-ops-reports.ts`:

- `hr.payroll.variance`
- `hr.payroll.correction.activity`
- `hr.payroll.warnings`
- `hr.payroll.component.summary` (requires `payrollRunId`)
- `hr.payroll.locked.period.audit`
- `hr.payroll.exceptions`

Trigger: `POST /hr/payroll/ops/reports/generate` → `export_jobs` / `generated_reports`.

## Security & governance

- Permissions: `hr.payroll.view|calculate|approve|export|admin` (+ `hr.manage` override)
- Salary masking via `maskPayrollListRow` / `canViewSalaryAmounts`
- Export authorization on `hr.payroll.export`
- Signed export and payslip download tokens (JWT, workspace + user bound)
- Workspace isolation on all queries (`workspace_id` filter)

## UI

**Payroll Operations Center** — `/admin/hr/payroll-ops` (linked from HR dashboard).

Tabs: Overview, Runs, Exceptions, Export readiness, Audit logs, Payslip ops.

## Remaining gaps (post P21-D)

| Gap | Notes |
|-----|-------|
| Bank file generation | Metadata only; no SFTP/API |
| GL posting | Journal JSON only |
| Email payslip distribution | Reissue metadata only |
| Full tax engine | Out of phase scope |
| Enterprise SSO field policies | Use workspace RBAC |
| Real-time metrics dashboard | Polling-based ops UI |

## Recommended next phase

**P22-A — Finance & Accounting Canonical Architecture Foundation** (not started in this delivery).
