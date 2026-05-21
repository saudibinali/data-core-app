# P21-B — Canonical Payroll Foundation Implementation

## Scope delivered

Foundation-only payroll platform on top of the existing Workforce Platform (P20). No production payroll execution, bank integrations, accounting posting, government integrations, or destructive migration of legacy `hr_*` payroll tables.

## Canonical database (`0010_payroll_canonical_foundation.sql`)

| Table | Purpose |
|-------|---------|
| `payroll_cycles` | Workspace-scoped pay frequency definitions |
| `payroll_periods` | Period boundaries, status, cutoff/close metadata |
| `payroll_runs` | Run header with idempotency key, totals, legacy bridge FK |
| `payroll_run_employees` | Per-employee preview rows + input snapshots |
| `payroll_components` | Component catalog (numeric amounts) |
| `payroll_component_values` | Posted component lines (P21-C) |
| `compensation_packages` | Canonical packages with supersede lifecycle |
| `compensation_adjustments` | Adjustment audit trail |
| `payroll_policies` | Versioned JSON policies per workspace |
| `payroll_locks` | Attendance/payroll/full period locks |

All money columns use `numeric(19,4)` via Drizzle `money()` helper — no text money, no float columns.

## Decimal money model

- `artifacts/api-server/src/lib/payroll/money.ts` — `Money` class using **BigInt minor units** (scale 4 storage, display scale configurable).
- Helpers: `sumMoney`, `aggregateMoneyStrings`, rounding modes `half_up` | `down` | `up`.
- New canonical payroll code paths use `Money`; legacy `hr.ts` `parseFloat` payroll processing is unchanged (coexistence).

## Services

| Service | Responsibilities |
|---------|------------------|
| `CompensationPackageService` | `resolveActivePackage`, `getPackageSnapshot`, `supersedePackage`, legacy fallback |
| `PayrollPolicyService` | Versioned policies: general, attendance, lock rules; workspace seed on init |
| `PayrollPeriodService` | Create/list/close periods; lock attendance/payroll; unlock (break-glass) |
| `PayrollLockService` | Date lock checks, break-glass audit logging |
| `PayrollAttendanceAdapter` | Reads **only** `attendance_daily_summaries` (paid/unpaid/OT/late/holiday) |
| `PayrollRunService` | Preview runs with SHA-256 idempotency keys (no calculation engine) |
| `LegacyPayrollBridge` | Links canonical run → existing `hr_payroll_runs` when same period exists |

## Lock enforcement

When `payroll.lock.block_ingest_when_locked` is true (default):

- `AttendanceIngestionService.ingestRawEvent` — blocks ingest for locked dates
- `processIngestedEvent` (pipeline) — same check before processing
- `ReplayService.replayRawEvent` / `retryNormalization` — blocks replay
- Workforce Ops replay endpoints accept `{ breakGlass: true, reason: "..." }` for audited override

## APIs (`/hr/payroll/canonical/*`)

- Periods: list, create, close, lock-attendance, lock-payroll, unlock (break-glass)
- Locks: list active
- Runs: list, create preview
- Attendance summary per employee/period
- Active compensation package snapshot (masked without salary permission)
- Report job trigger for `hr.payroll.register` / `hr.payroll.components`

## Security

Permissions (assign via workspace custom roles):

- `hr.payroll.view`, `hr.payroll.calculate`, `hr.payroll.approve`, `hr.payroll.export`, `hr.payroll.admin`
- Middleware: `requirePayrollPermission` — admin/manager/`hr.manage` bypass
- Masked list responses when salary view not granted
- Structured audit via `payroll-audit.ts` + break-glass log entries

## Reporting

Report definitions registered in `report-definition-registry.ts`; JSON generators in `payroll-reports.ts` integrated with `generated_reports` / export job processor.

## Coexistence strategy

- Legacy routes under `/hr/payroll/*` remain authoritative for current UI processing.
- Canonical tables run in parallel; preview runs optionally link `legacy_payroll_run_id`.
- Compensation resolves canonical package first, then falls back to `hr_employee_compensations`.
- No deletion or migration of legacy payroll data.

## Remaining gaps (P21-C+)

- Full calculation engine, component posting, payslip entity, PDF payslips
- Bank export, accounting posting, government filings
- UI migration to canonical APIs
- Proration, tax, benefits, leave-paid integration in calc pipeline
- Automated dual-write on legacy payroll process endpoint

## Recommended next phase

**P21-C — Payroll Calculation Engine & Payslip Generation**
