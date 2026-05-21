# P19-E — PDF Reporting & Scheduled Enterprise Reports

## Overview

P19-E extends the P19-D reporting engine with PDF output, workspace-branded templates, scheduled report execution, and email delivery via the P19-B notification infrastructure. No Redis, no report center UI, and no external BI tools.

## PDF rendering flow

1. `ExportJobService.processJob` calls `runReportGenerator` with `format: "pdf"`.
2. `generatePdfReport` loads tabular data (`report-data.ts`) and workspace branding (`workspace-branding.ts`).
3. `renderReportPdfHtml` builds an HTML document with RTL/LTR, header/footer, optional watermark, and primary color (`templates/report-pdf-templates.ts`).
4. **Default renderer:** `renderTablePdfToBuffer` (pdf-lib) — reliable in CI without Chromium.
5. **Optional:** set `PDF_RENDERER=puppeteer` to render the HTML template via headless Chrome (`pdf-renderer.ts`).

Template keys (documentation / future registry):

- `hr.employees.roster.pdf`
- `hr.attendance.period.pdf`
- `hr.leave.balances.pdf`

API format remains `pdf` on the canonical definition keys (`hr.employees.roster`, etc.).

## Template structure

| Layer | Location | Purpose |
|-------|----------|---------|
| PDF HTML | `lib/reports/templates/report-pdf-templates.ts` | Branded layout, ar/en direction |
| Report email | `lib/reports/templates/report-email-templates.ts` | Programmatic HTML for custom flows |
| Platform email | `lib/notifications/templates.ts` → `report.ready` | DB-seeded notification template with `{{downloadUrl}}` |

Branding fields merge `workspace_report_branding` overrides with `workspaces.logo_url`, `primary_color`, and `name`.

## Scheduled report lifecycle

1. **Create:** `POST /api/reports/schedules` → `scheduled_report_schedules` row with `schedule_cron`, `schedule_timezone`, `recipient_json`, `next_run_at`.
2. **Tick:** `scheduled-report-scheduler.ts` (60s interval) selects `enabled` rows where `next_run_at <= now()`.
3. **Claim:** atomic update advances `next_run_at` (cron-parser) and sets `last_run_at` — prevents duplicate runs in the same window.
4. **Execute:** creates a normal `export_jobs` + `generated_reports` pair via `ExportJobService`.
5. **Complete:** existing export job processor generates the artifact and triggers notifications.

## Email delivery

On successful export:

- In-app notification (`export_completed`) for creator and `recipient_json` users.
- Email job enqueued with template `report.ready` when `enqueueEmail: true`.
- Payload includes **signed download URL** (`APP_PUBLIC_URL` + JWT token) — no large attachments.
- Rows recorded in `notification_deliveries`.

## Workspace branding

- Table: `workspace_report_branding`
- API: `GET/PUT /api/reports/branding` (HR manage for writes)
- Used in PDF HTML and email subject/body variables

## Security model

- PDF artifacts use the same `export_jobs` → `generated_reports` → `local://` storage path as spreadsheets.
- Downloads require auth + JWT download token (`report-download-token.ts`) with TTL (`REPORT_DOWNLOAD_TTL_SEC`, default 900s).
- `report_access_logs` on token issue; workspace isolation on all queries.
- Scheduled jobs run with creator's user context for permission checks.

## Remaining gaps

- Puppeteer optional; production may want pinned Chromium or a dedicated render service.
- No branding editor UI; API-only configuration.
- Cron limited to standard expressions; no holiday/skip calendars.
- Email recipients must resolve to a workspace user for in-app + queue path.
- HTML PDF fidelity lower than puppeteer for complex layouts.

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `PDF_RENDERER` | builtin (pdf-lib) | Set `puppeteer` for HTML-accurate PDF |
| `APP_PUBLIC_URL` | `http://localhost:5000` | Base URL in report emails |
| `REPORT_DOWNLOAD_TTL_SEC` | `900` | Download token lifetime |
