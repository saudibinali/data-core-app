# P20-A — Attendance Readiness Decision

**Phase:** P20-A (architecture gate)  
**Date:** 2026-05-19  
**Decision authority:** Engineering architecture review (pre-implementation)

---

## Summary matrix

| Area | Verdict | Rationale |
|------|---------|-----------|
| **Canonical attendance DB** | **PARTIAL** | Legacy tables production-ready; new event model designed but **not migrated** |
| **Integration connectors** | **BLOCKED** | No connector runtime, webhook endpoints, or credential vault for attendance |
| **GPS / geofence** | **BLOCKED** | Strategy only; no schema migration, API, or mobile client |
| **Excel import** | **PARTIAL** | Legacy inline import works; not on `import_jobs` / Document Registry / revert |
| **Payroll interaction** | **BLOCKED** | No read path from attendance to payroll; OT linkage incomplete |
| **Reporting readiness** | **GO** | P19 `hr.attendance.period` export (xlsx/csv/pdf) + Report Center UI |
| **UI readiness** | **PARTIAL** | Admin CRUD/import exists; no workforce center, self clock, geofence, integration admin |

---

## 1. Canonical attendance DB — PARTIAL

**Ready**

- `hr_attendance`, `hr_shifts`, `hr_work_calendars`, `hr_calendar_holidays` in production use  
- Unique constraint `(employee_id, date)`  
- Overtime tables linked  

**Not ready**

- `attendance_raw_events`, `attendance_events`, `attendance_daily_summaries` not created  
- No dual-write or rebuild pipeline  
- Text `check_in`/`check_out` limits event precision  

**Gate to GO:** P20-B migrations + minimal ingestion writing to new tables.

---

## 2. Integration connectors — BLOCKED

**Blockers**

- No `AttendanceConnector` implementation  
- No `attendance_integrations` table  
- No webhook route or sync worker  
- `source_type` values `biometric` / `mobile` are placeholders  

**Gate to GO:** P20-B generic webhook + P20-E first vendor adapter.

---

## 3. GPS / geofence — BLOCKED

**Blockers**

- No `attendance_geofences` table  
- No clock API with location validation  
- Privacy policy UX not built  
- No mobile app  

**Gate to PARTIAL:** P20-D schema + web geolocation clock with flag-only mode.  
**Gate to GO:** Mobile app + production geofence enforcement.

---

## 4. Excel import — PARTIAL

**Ready**

- Template, preview, confirm, export in `hr.ts`  
- Admin UI import flow  

**Gaps**

- Not using `import_jobs`  
- Confirm drops shift/late/early from preview  
- No rollback; client-side parse  
- `source_type` forced to `manual` on confirm  

**Gate to GO:** P20-C import worker + batch tables + Document Registry file.

---

## 5. Payroll interaction — BLOCKED

**Blockers**

- Payroll process ignores attendance  
- Payslip day fields unused  
- Leave does not overlay attendance  
- No period lock  

**Gate to PARTIAL:** Read-only summary adapter + leave overlay job (P20-C/D).  
**Gate to GO:** Signed-off payroll formulas using summaries (later phase).

---

## 6. Reporting readiness — GO

- Report definition `hr.attendance.period` registered  
- PDF/xlsx/csv + scheduled reports (P19-E)  
- Report Center UI (P19-F)  
- Async export for large row counts  

**Caveat:** Reports read legacy table until summaries backfill.

---

## 7. UI readiness — PARTIAL

**Ready**

- `/admin/hr/attendance` multi-tab admin  
- Legacy export bridge  
- Report Center for exports  

**Not ready**

- Self-service attendance (`GET /hr/me/attendance` only)  
- Workforce event viewer  
- Integration admin  
- Geofence map  
- Single-row edit/delete in UI  

**Gate to GO:** P20-F workforce UI after P20-B event API.

---

## Overall platform readiness

| Dimension | Verdict |
|-----------|---------|
| **Discovery / architecture** | **GO** (P20-A complete) |
| **Implementation start** | **GO** for P20-B (DB + ingestion foundation) |
| **Production multi-source attendance** | **BLOCKED** until P20-C–E |
| **Enterprise compliance-ready** | **PARTIAL** |

---

## Recommended phase sequence

1. **P20-B** — Canonical DB + raw/event ingestion + dual-write (unblocks PARTIAL → GO on DB)  
2. **P20-C** — Excel import on `import_jobs` + normalization v1  
3. **P20-D** — Web clock + geofence schema (GPS PARTIAL)  
4. **P20-E** — Vendor connectors (integration PARTIAL)  
5. **P20-F** — Workforce UI + self-service  
6. **P21+** — Payroll read adapter (explicitly separate)  

---

## Sign-off criteria for leaving P20-A

- [x] Current state audited  
- [x] Target architecture documented  
- [x] Canonical models specified (no migrations)  
- [x] Integration, GPS, import, normalization, payroll, security documented  
- [x] Readiness verdicts assigned  
- [ ] Product/legal review for GPS privacy (before P20-D production)  

---

**P20-A status: COMPLETE (documentation only).**
