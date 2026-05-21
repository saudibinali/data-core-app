# P19-F — Report Center UI & Enterprise Document Experience

## Overview

Unified workspace UI for generated reports, export jobs, scheduled reports, workspace branding, and entity-scoped attachments. Built on P19-D/E reporting APIs and P19-C document registry without changing notification infrastructure or legacy HR export routes.

## UI routes

| Route | Page | Module key | Access |
|-------|------|------------|--------|
| `/hr/reports` | `report-center.tsx` | `report-center` | `hr.manage` or `reports.view` (page gate) |

Sidebar entry: **Report Center** / **مركز التقارير** (seeded in `modules.ts`).

HR dashboard quick link: `/hr/reports`.

## Components

| File | Role |
|------|------|
| `pages/report-center.tsx` | Main tabbed Report Center |
| `hooks/use-report-center.ts` | TanStack Query + secure download mutations |
| `lib/report-center-config.ts` | Permissions, labels, status badges |
| `components/reports/report-status-badge.tsx` | Status & format badges |
| `components/documents/entity-documents-panel.tsx` | Entity attachment list/download/archive |

### Tabs

1. **Reports** — `GET /api/reports/generated` with search/filters
2. **Export jobs** — `GET /api/reports/export-jobs` (auto-refresh while active)
3. **Create** — `POST /api/reports/export-jobs` (hr.manage)
4. **Schedules** — list/create/toggle via `/api/reports/schedules`
5. **Branding** — `GET/PUT /api/reports/branding`
6. **Documents** — `GET /api/attachments?entityType=&entityId=`
7. **Definitions** — `GET /api/reports/definitions`

## API usage

- **Create report:** `POST /reports/export-jobs` with `reportDefinitionKey`, `format`, `parameters`
- **Poll status:** export jobs list refetch (5s when pending/processing)
- **Download report:** `GET /reports/generated/:id/download` → token → `downloadWithAuth(/reports/generated/download/stream?token=...)`
- **Download attachment:** `GET /attachments/:id/download` → reject raw `downloadUrl` → token stream only
- **Retry failed job:** new export job with same definition/format (no backend retry endpoint)
- **Schedules:** `POST /reports/schedules`, `PATCH /reports/schedules/:id` with `{ enabled }`

## Permissions

| Action | Permission |
|--------|------------|
| View Report Center | `hr.manage`, `reports.view`, or `admin` |
| Create export / schedules / branding / archive | `hr.manage` or `admin` |
| Confidential documents | Backend `documentAccessService` on download |

Route uses `moduleKey="report-center"` (no single `requiredPermission` on gate); page enforces `canViewReportCenter` / `canManageReportCenter`.

## Download security

- No direct object storage URLs in UI
- `useDownloadAttachment` throws if API returns a public `http` `downloadUrl`
- Reports always use JWT token + authenticated stream endpoint
- Legacy `/api/hr/employees/export` unchanged (still on HR pages)

## Notification UX

`notifications.tsx` maps `export_completed` and `export_failed` to `/hr/reports` (no infrastructure changes).

## Known gaps

- No delete/archive for generated reports (backend not exposed)
- No visual cron builder (plain cron text field)
- `reports.view` users see UI via direct URL but not sidebar (module `hr.manage`)
- Document panel requires manual entity type/id (no entity picker)
- No embedded BI / dashboards

## Tests

`artifacts/ops-platform/src/lib/__tests__/report-center-page.test.ts` — static wiring (route, permissions, token downloads, forbidden terms).

Run: `pnpm --filter @workspace/ops-platform test report-center-page`

## Backend addition (non-breaking)

- `GET /api/reports/export-jobs` — workspace-scoped job list for UI
- Attachments list includes `currentVersionId` for version display
