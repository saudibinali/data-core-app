# P21-C — Payroll Calculation Engine & Payslip Generation

## Scope

Implements the real calculation engine, component posting, preview/final/correction runs, payslip lifecycle, PDF generation, review workflow, events, and export foundations on top of P21-B canonical payroll tables.

**Not in scope:** bank files, accounting posting, government filings, full tax engine, salary disbursement automation, destructive legacy migration.

## Calculation lifecycle

```mermaid
flowchart LR
  A[Gather inputs] --> B[Calculate per employee]
  B --> C[Post component values]
  C --> D[Review]
  D --> E[Approve]
  E --> F[Lock + issue payslips]
```

| Status | Meaning |
|--------|---------|
| `draft` | Run created |
| `calculating` | Engine running |
| `review` | HR review (warnings/exclusions visible) |
| `approved` | Approved; draft payslips for final/correction |
| `locked` | Immutable; payslips issued on lock (final/correction) |

## PayrollCalculationEngine

Location: `artifacts/api-server/src/lib/payroll/payroll-calculation-engine.ts`

**Inputs (read-only):**

- `PayrollAttendanceAdapter` → `attendance_daily_summaries`
- `CompensationPackageService` → canonical packages + legacy fallback
- `compensation_adjustments` (approved, in period)
- `hr_overtime_records` (approved, unpaid by legacy run)
- `leave_requests` (approved overlap → warnings)

**Outputs:**

- `payroll_run_employees` with snapshots, warnings, totals
- `payroll_component_values` (BASIC, ALLOWANCE, OVERTIME, UNPAID_ABS, ADJ_EARN, ADJ_DED, CORR_DELTA)

**Run types:**

| Type | Behavior |
|------|----------|
| `preview` | Editable; recalculatable; no payslip issue |
| `final` | Review → approve → lock → payslips |
| `correction` | Linked via `corrects_run_id`; delta lines only |

## Preview vs final

- **Preview:** `POST /hr/payroll/canonical/runs/preview` — idempotent per period/version
- **Final:** `POST /hr/payroll/canonical/runs/final` — same engine, stricter approve rules
- **Recalculate:** `POST .../runs/:id/calculate` or per-employee via engine
- **No auto-approve** — explicit `submit-review` → `approve` → `lock`

## Correction strategy

- New run with `corrects_run_id` pointing to prior locked/final run
- Engine recomputes net and posts `CORR_DELTA` component for difference
- Prior run rows are never overwritten
- Correction payslips link via `corrects_payslip_id` (schema ready)

## Payslip lifecycle

Table: `payroll_payslips` (migration `0011`)

| Status | Description |
|--------|-------------|
| `draft` | Created on approve for final/correction |
| `issued` | Number assigned; notification event fired |

**YTD:** `ytd_json` on payslip aggregates issued payslips in calendar year (foundation).

## PDF generation

- Report key: `hr.payroll.payslip.pdf`
- Template: `templates/payslip-pdf-template.ts` (AR/EN/bilingual, watermark for draft)
- Storage: `report-artifacts` local path + `pdf_storage_key` on payslip
- Download: `POST .../payslips/:id/pdf` → JWT token → `GET .../payslips/download?token=`

## Lock enforcement

- Final run cannot recalculate after `locked`
- `PayrollRunWorkflow.lockRun` creates payroll lock + sets run status
- Attendance locks from P21-B still apply to ingest/replay

## Events & notifications

| Event | When |
|-------|------|
| `payroll.run.created` | Run inserted |
| `payroll.run.review` | Submitted for review |
| `payroll.run.approved` | Approved |
| `payroll.payslip.issued` | Payslip issued (in-app notification, no email) |

## Exports (foundation)

| Key | Format |
|-----|--------|
| `hr.payroll.register` | JSON |
| `hr.payroll.components` | JSON |
| `hr.payroll.payslip.pdf` | PDF |
| `hr.payroll.payslips.batch` | JSON metadata |

## Legacy coexistence

- `/hr/payroll/runs/:id/process` (legacy) unchanged — transitional
- Canonical APIs are primary for new integrations
- `legacy_payroll_run_id` still populated for final runs via bridge

## Remaining gaps (P21-D+)

- Bank payment file / accounting export
- Full tax & statutory rules
- Employee self-service PDF download route
- Document Registry automatic registration on PDF store
- UI migration to canonical payroll screens
- OT `payrollRunId` linkage to canonical runs

## Recommended next phase

**P21-D — Payroll Operations Center & Financial Export Readiness**
