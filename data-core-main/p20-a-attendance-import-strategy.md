# P20-A — Excel / CSV Attendance Import Strategy

**Phase:** P20-A (design only)  
**Date:** 2026-05-19

---

## 1. Current state vs target

| Aspect | Today (`hr.ts`) | Target (WEP) |
|--------|-----------------|--------------|
| Job tracking | Inline preview/confirm | `import_jobs` + `attendance_import_batches` |
| File storage | Client parses XLSX | Upload to Document Registry → object storage |
| Dry-run | Preview endpoint | `import_jobs.dry_run = true` |
| Rollback | None | Compensating import or adjustment batch |
| Audit | Minimal | Full job + row-level errors in `summary_json` |

**Legacy path remains** until workspace flag enables new importer.

---

## 2. Import flow (target)

```
1. HR uploads file → POST /attachments/upload-request (or report artifact dir)
2. POST /hr/workforce/imports { documentId, mappingProfileId?, dryRun: true }
3. Create import_jobs row (import_type: attendance_period)
4. Create attendance_import_batches linked to job
5. Worker parses file (server-side XLSX/CSV)
6. For each row: validate → staging row → duplicate check
7. dry_run: return summary only
8. confirm: normalize → events → daily summaries → dual-write hr_attendance
9. Complete import_job with summary_json + error report document
10. Notify HR (P19 notification: attendance.import.completed)
```

---

## 3. Column mapping

### 3.1 Default template (backward compatible)

Preserves current template columns:

- `employee_number`, `date`, `check_in`, `check_out`, `status`  
- `shift_code`, `late_minutes`, `early_leave_minutes`, `overtime_minutes`  
- `source_type`, `notes`  

### 3.2 Mapping profile (`mapping_json`)

```json
{
  "version": 1,
  "sheet": "Attendance",
  "headerRow": 1,
  "columns": {
    "employeeNumber": { "header": ["employee_number", "رقم الموظف"] },
    "date": { "header": ["date", "التاريخ"], "format": "YYYY-MM-DD" },
    "checkIn": { "header": ["check_in"] },
    "checkOut": { "header": ["check_out"] }
  }
}
```

Saved per workspace for recurring vendor file formats.

---

## 4. Validation rules

| Rule | Action |
|------|--------|
| Unknown employee | Row error |
| Duplicate (employee, date) in file | Warning + last-wins or skip (configurable) |
| Existing DB row | `update` vs `skip` mode |
| Invalid status | Error or map via lookup table |
| Future date > N days | Warning |
| check_out < check_in | Error unless night shift flag |
| Invalid source_type | Map to `excel` source |

---

## 5. Duplicate detection

| Level | Key |
|-------|-----|
| File-internal | `(employee_number, date)` hash set |
| Database | `attendance_daily_summaries` or `hr_attendance` unique index |
| Idempotent re-import | Same `import_job_id` + row_number cannot be applied twice |

---

## 6. Reconciliation

Post-import report:

- Rows inserted / updated / skipped / failed  
- Per-employee day coverage % for date range  
- Comparison to shift schedule (missing punch report)  

Delivered as:

- `import_jobs.summary_json`  
- Optional XLSX error report via Document Registry  

---

## 7. Rollback / revert

| Strategy | When |
|----------|------|
| **Soft revert** | Create `attendance_adjustments` reversing each inserted day linked to `import_batch_id` |
| **Hard revert** | Only if batch exclusively created rows tagged `created_by_import_batch_id` (no manual edits since) |
| **No revert** | If mixed manual + import edits on same day — HR must manual correct |

**P20-B:** Implement soft revert metadata tagging first.

---

## 8. Link to Document Registry

| Artifact | Usage |
|----------|--------|
| `documents` | Original upload (classification: `attendance_import`) |
| `import_jobs.source_storage_key` | Pointer to stored file |
| `generated_reports` | Optional post-import reconciliation report |

Confidential imports: `is_confidential` on document.

---

## 9. Link to `import_jobs` schema (existing)

Use columns:

- `import_type`: `attendance.period`  
- `dry_run`: boolean  
- `status`: pending → processing → completed / failed  
- `summary_json`: counts + sample errors  
- `error_report_storage_key`: optional error file  
- `created_by_user_id`  

---

## 10. Permissions

- `hr.manage` — run import  
- `hr.attendance.import` (future fine-grained) — optional split  
- Workspace isolation on all queries  

---

## 11. Gaps to close from current importer

1. Confirm must apply `shift_id`, `late_minutes`, `early_leave_minutes` from preview  
2. Preserve `source_type` = `excel` not forced `manual`  
3. Server-side parse (remove client-only trust)  
4. Wire `import_jobs` for audit trail  

---

**Phase:** P20-C implements import worker + batch tables.
