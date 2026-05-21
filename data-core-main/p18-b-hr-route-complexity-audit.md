# P18-B — HR Route Complexity Audit

**Date:** 2026-05-19  
**Target:** `artifacts/api-server/src/routes/hr.ts` + `artifacts/api-server/src/routes/leave.ts`  
**No refactor performed.**

---

## 1. Quantitative metrics

| Metric | `hr.ts` | `leave.ts` |
|--------|---------|------------|
| Lines (approx) | **~4,159** | **~1,007** |
| `router.get/post/patch/delete` handlers | **~155** | **~6** (+ patch variants) |
| `router.delete` | **27** | **0** |
| `db.transaction(` | **0** | **4** |
| Section markers (`// ──`) | **~45** domains | Documented phases |

**Combined HR HTTP surface:** **~161 handlers** across two files.

---

## 2. Domain groups inside `hr.ts` (by section comments)

| Domain | Approx line range | Endpoints (est.) | Concerns |
|--------|-------------------|------------------|----------|
| Helpers + settings | 64–185 | 2 | Mixed |
| Dashboard | 186–272 | 1 | Aggregations |
| Employees CRUD + import/export | 273–1207 | **~12** | Giant import preview/confirm |
| Org units | 1208–1261 | 5 | Foundation |
| Job grades / titles | 1262–1368 | 10 | Foundation |
| Custom fields | 1369–1460 | 8 | Foundation |
| Contracts / documents / leaves (nested) | 1461–1590 | 12 | **Legacy leave** mixed with employee |
| Position history / notes / activity | 1591–1664 | 9 | Employee sub-resources |
| HR services + categories | 1665–1969 | 15 | Workflow + forms |
| Self-service services list | 1741+ | 1 | **Auth only** |
| Seed defaults | 1897+ | 1 | Side-effect heavy |
| Catalogs (statuses, types, locations, positions, doc types, policies) | 1970–2373 | **~35** | Foundation |
| Salary components / structures / bands | 2374–2623 | 18 | Payroll prep |
| Employee compensation | 2624–2720 | 6 | Payroll |
| Payroll runs + process | 2721–2957 | 12 | **Giant `process` handler** |
| Payslips | 2958–3077 | 6 | Payroll |
| Shifts / calendars | 3078–3228 | 10 | Attendance |
| Attendance records + import/export | 3229–3865 | **~18** | Import mirrors employee import |
| Leave balances | 3348–3561 | 8 | Overlaps leave domain |
| Overtime | 3866–4159 | 12 | Attendance |

**Mixed concerns:** Employee file, legacy leave, payroll, and attendance share one router with duplicated import/export patterns.

---

## 3. Duplicated patterns

| Pattern | Occurrences | Notes |
|---------|-------------|-------|
| Excel import preview → confirm | Employees, Attendance | ~200+ lines each, near-copy structure |
| `parseId(req.params.id)` + workspace `and(eq(...workspaceId))` | Throughout | Consistent but verbose |
| Catalog CRUD (statuses, types, policies) | 8+ entities | Same GET/POST/PATCH/DELETE shape |
| `requireAuth` + `requireWorkspaceAdmin` | Admin mutations | Payroll process uses admin not `hr.manage` |
| `requirePermission("hr.manage")` | Many HR routes | Not universal — see permission audit |

---

## 4. Giant handlers (refactor hotspots — documentation only)

| Handler | Approx lines | Risk |
|---------|--------------|------|
| `POST /hr/payroll/runs/:id/process` | **~150+** | Financial computation loop, no transaction |
| `POST /hr/employees/import/preview` | **~180** | Validation matrix |
| `POST /hr/employees/import/confirm` | **~120** | Bulk writes |
| `POST /hr/attendance/import/preview` | **~100** | Duplicate logic |
| Employee export | **~80** | PII |

---

## 5. Transaction hotspots

| File | Transactions | Comment |
|------|--------------|---------|
| `hr.ts` | **None** | Multi-step payroll process and imports are **not** wrapped — partial failure possible |
| `leave.ts` | **4** | Submit, approve, reject, withdraw — correct pattern for canonical leave |

---

## 6. Unsafe delete endpoints (`router.delete` in hr.ts — 27 total)

Examples (all require review before refactor):

- `/hr/employees/:id`
- `/hr/org-units/:id`, job grades, titles, custom field defs
- `/hr/employees/:id/contracts/:id`, documents, leaves, notes
- Catalog deletes (statuses, types, policies, salary components, structures, bands)
- `/hr/payroll/runs/:id`, payslips, shifts, calendar holidays
- `/hr/attendance/records/:id`, overtime records
- Service categories / services

**Common pattern:** `requireWorkspaceAdmin` or `requirePermission("hr.manage")` — inconsistent between domains.

---

## 7. Permission check repetition

- `requirePermission("hr.manage")` — repeated on many routes
- `requireWorkspaceAdmin` — payroll process, some destructive ops
- `requireAuth` only — self-service, categories, some `/hr/me/*` (gap)
- No centralized `requireHrManage` middleware wrapper

---

## 8. Proposed split boundaries (plan only — per P18-A / user request)

| New file | Routes to move (logical) |
|----------|--------------------------|
| `hr-foundation.routes.ts` | Settings, org units, job grades/titles, custom fields, all `/hr/foundation/*` catalogs, seed defaults, work locations, positions, document types, leave/probation policies |
| `hr-employees.routes.ts` | Dashboard, employees CRUD, import/export, contracts, documents, position history, notes, activity, compensation |
| `hr-leave.routes.ts` | Legacy `/hr/employees/:id/leaves`, `/hr/me/leave-requests`, `/hr/attendance/leaves`, leave balances in hr.ts — **eventually** delegate to `leave.ts` |
| `hr-payroll.routes.ts` | Salary components/structures/bands, payroll runs, process, payslips, `/hr/me/payslips` |
| `hr-attendance.routes.ts` | Shifts, calendars, records, import/export, overtime |
| `hr-services.routes.ts` | Service categories, services, self-service services list, workflow-linked service config |

**Keep separate:** `leave.ts` remains canonical leave lifecycle (do not merge into hr-leave until bridge complete).

**Mount order:** `index.ts` — foundation → employees → leave (legacy) → leave.ts (canonical) → payroll → attendance → services.

---

## 9. Complexity verdict

| Question | Answer |
|----------|--------|
| File too large for safe change? | **Yes** |
| Clear domain boundaries? | **Yes** (section comments already map to split) |
| Safe to split without tests? | **No** |
| leave.ts ready to own domain? | **Code yes, DB no** |

---

**Confirmation:** `hr.ts` not modified. Split is proposal only.
