# P20-A — Current Attendance Audit

**Phase:** P20-A (discovery & architecture only)  
**Date:** 2026-05-19  
**Scope:** As-is state of attendance in data-core; no code changes.

---

## 1. Executive summary

Attendance today is a **workspace-scoped daily record model** centered on `hr_attendance`, with supporting shifts, work calendars, holidays, leave balances, legacy leave rows, and overtime tables. Operations are **CRUD + Excel import/export** via a monolithic `hr.ts` router and a single admin UI page (`hr-attendance.tsx`). There is **no event bus**, **no multi-source ingest pipeline**, **no vendor connectors**, and **weak coupling** to canonical leave approval and payroll processing.

P20-A treats this stack as **legacy-compatible foundation** to extend—not replace destructively.

---

## 2. Database tables

### 2.1 Core attendance

| Table | Purpose | Key constraints |
|-------|---------|-----------------|
| `hr_attendance` | One row per employee per calendar day | `UNIQUE (employee_id, date)` |
| `hr_shifts` | Shift templates (start/end, grace, break) | `UNIQUE (workspace_id, code)` |
| `hr_work_calendars` | Work week + timezone | `work_days` jsonb, `is_default` |
| `hr_calendar_holidays` | Calendar exceptions | FK → calendar |

**`hr_attendance` columns (material):**

- Identity: `workspace_id`, `employee_id`, `date`
- Times: `check_in`, `check_out` (text `HH:MM`, not timestamptz)
- Classification: `status` (`present`, `absent`, `late`, `half_day`, `on_leave`, `holiday`, `remote`)
- Provenance: `source_type` (`manual`, `biometric`, `mobile`, `system`) — **enum only, no ingest**
- Metrics: `late_minutes`, `early_leave_minutes`, `overtime_minutes` — **manually set or import; not auto-calculated**
- Audit: `approved_by`, `created_by`, timestamps
- Optional: `shift_id`, `notes`

### 2.2 Related HR

| Table | Attendance relevance |
|-------|---------------------|
| `hr_leave_balances` | Used by leave domain; `manual_adjustment` on balances, not attendance rows |
| `hr_employee_leaves` | Legacy leave; shown in attendance UI tab; **not synced to `hr_attendance`** |
| `leave_requests` | Canonical leave; **no write-back to attendance** |
| `hr_overtime_policies` / `hr_overtime_records` | OT linked to `attendance_id`; auto-calc reads `overtime_minutes` from attendance |
| `hr_payslips` | Has `working_days`, `actual_days`, `absent_days` — **not populated from attendance in payroll process** |
| `import_jobs` | Exists (P19-C) — **attendance import does not use it** |
| `hr_workspace_settings` | Numbering only — **no attendance policy settings** |

### 2.3 Gaps in schema

- No raw event store, device registry, integration credentials, geofences, or sync jobs
- No employee default `shift_id` / `calendar_id` on `employees`
- No attendance period lock / payroll freeze flag per workspace
- No immutable audit log table for attendance mutations (only row-level `created_by` / `approved_by`)

---

## 3. API routes

**Location:** `artifacts/api-server/src/routes/hr.ts` (~L3005–4046). No dedicated attendance router.

### 3.1 Configuration

| Method | Path | Permission |
|--------|------|------------|
| GET/POST/PATCH/DELETE | `/hr/attendance/shifts` | manage / admin |
| GET/POST/PATCH/DELETE | `/hr/attendance/calendars` | manage / admin |
| GET/POST/DELETE | `/hr/attendance/calendars/:id/holidays` | manage / admin |

### 3.2 Daily records

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/hr/attendance` | List; filters: `employeeId`, `dateFrom`, `dateTo`, `status` |
| POST | `/hr/attendance` | Upsert on `(employeeId, date)` |
| PATCH | `/hr/attendance/:id` | Partial update; sets `approved_by` for certain statuses |
| DELETE | `/hr/attendance/:id` | Admin only |
| GET | `/hr/me/attendance` | Self-service read (employee linked to user) |
| POST | `/hr/attendance/bulk` | Bulk status/notes by IDs |

### 3.3 Import / export

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/hr/attendance/import-template` | Multi-sheet XLSX template |
| POST | `/hr/attendance/import/preview` | Row validation, duplicate detection |
| POST | `/hr/attendance/import/confirm` | Insert/update; forces `sourceType: "manual"` |
| GET | `/hr/attendance/export` | Legacy → `hr.attendance.period` report (P19-D/E) |

**Import gap:** Preview resolves shift and warnings; confirm omits `shift_id`, `late_minutes`, `early_leave_minutes` from payload.

### 3.4 Leave overlap (same UI area)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/hr/attendance/leaves` | Legacy `hr_employee_leaves` |
| PATCH | `/hr/attendance/leaves/:id` | Legacy approve/reject |
| GET/PATCH | `/hr/leave-balances` | Balance admin |
| — | `/hr/leave-requests/*` | Canonical leave in `leave.ts` |

### 3.5 Overtime

| Method | Path | Notes |
|--------|------|-------|
| CRUD | `/hr/overtime/policies`, `/hr/overtime/records` | |
| POST | `/hr/overtime/calculate` | Scans attendance `overtime_minutes` ≥ threshold |

---

## 4. Frontend

| Asset | Path | Notes |
|-------|------|-------|
| Admin page | `artifacts/ops-platform/src/pages/hr-attendance.tsx` | Route `/admin/hr/attendance`; `hr.manage` |
| Dashboard link | `hr-dashboard.tsx` | Quick nav to attendance |
| Self-service | — | **No UI** for `GET /hr/me/attendance` |

**Tabs:** Attendance, Leaves (bridge), Balances, Overtime, Shifts, Calendars.

**UI gaps:**

- No edit/delete dialog for single attendance row (API supports PATCH/DELETE)
- No holiday management UI (API exists)
- No clock-in/out web flow for employees
- No map/geofence UI
- Import is client-side XLSX parse + preview/confirm

---

## 5. Approval flows

| Domain | Flow |
|--------|------|
| Attendance row | Optional `approved_by` on PATCH when status is `present` (or similar); **not a multi-step workflow** |
| Legacy leave | `PATCH /hr/attendance/leaves/:id` |
| Canonical leave | `leave_approval_steps` in `leave.ts` — **no attendance side effects** |
| Overtime records | Status machine `draft` → … → `paid`; separate from attendance approval |

---

## 6. Payroll dependencies

| Link | Status |
|------|--------|
| Payroll run process | Does **not** read `hr_attendance` |
| Payslip absent/working days | Columns exist; **unset** |
| OT → payslip | `payroll_run_id` / `payslip_id` on OT records — **no completion route** |
| OT policies → salary components | FK exists; not used in payroll calculation |

**Risk:** Payroll and attendance can diverge silently.

---

## 7. Reports & exports

- Report key: `hr.attendance.period` (xlsx, csv, pdf via P19-D/E)
- Filters: `dateFrom`, `dateTo`, `status`
- Async threshold ~500 rows
- Scheduled reports possible via P19-E (same definition key)

---

## 8. Manual adjustments

- Direct POST/PATCH/bulk on `hr_attendance`
- Leave balance `manual_adjustment` on `hr_leave_balances` (separate domain)
- Import overwrites/inserts with `source_type = manual` on confirm (discards preview source types)

---

## 9. Leave / holiday interactions

| Interaction | Current behavior |
|-------------|------------------|
| Approved canonical leave | Does **not** auto-set `hr_attendance.status = on_leave` |
| Work calendar + holidays | Used in **leave** `calcBusinessDays`; not attendance validation |
| Status `holiday` / `on_leave` | Manual or import only |
| Legacy + canonical leave | Dual paths in UI via `leave-bridge.ts` |

---

## 10. Infrastructure touchpoints

| System | Relevance |
|--------|-----------|
| `import_jobs` | Not wired to attendance import |
| `export_jobs` / `generated_reports` | Attendance period export |
| `notification_jobs` | Leave events only; **no attendance events** |
| `documents` / attachments | Not used for attendance import files |
| `appEventBus` | Leave types only |

---

## 11. Risks & technical debt

1. **Single-source illusion** — `source_type` suggests multi-source; only manual/import implemented  
2. **Dual leave models** in attendance UI increase confusion and inconsistent balances  
3. **No normalization engine** — late/OT/shift rules not enforced server-side  
4. **Import confirm drift** from preview  
5. **Payroll disconnect** — compliance and pay accuracy risk  
6. **Monolithic `hr.ts`** — hard to add connectors without further coupling  
7. **Time stored as text** — complicates timezone/DST and event-level precision  
8. **No tamper-evident audit** for GPS/biometric claims  

---

## 12. Alignment with P18 canonical map

Per `p18-a-canonical-model-map.md`: **extend** `hr_attendance`, shifts, calendars, overtime; unify leave UI on `leave_requests` over time. P20-A adds an **event layer** above daily summaries without dropping `hr_attendance` during transition.

---

**Next:** `p20-a-workforce-event-platform-architecture.md`
