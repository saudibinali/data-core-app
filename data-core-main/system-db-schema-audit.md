# Database & Schema Audit

**Package:** `lib/db` (`@workspace/db`)  
**Migrations:** `lib/db/drizzle/0000`–`0019` (20 SQL files)  
**Schema modules:** 55 files, **~192** `pgTable` definitions  
**Journal:** `_journal.json` idx 0–19; **only `0000_snapshot.json`** in meta (later migrations hand-authored)

---

## 1. Migration timeline

| # | File | Adds / changes |
|---|------|----------------|
| 0000 | sad_midnight | Baseline platform (~72 tables) |
| 0001 | leave_canonical | `leave_requests`, approval steps |
| 0002 | notification_infrastructure | Communication stack |
| 0003 | document_registry | 8 document tables |
| 0004 | reporting_infrastructure | `generated_reports` path |
| 0005 | pdf_scheduled_reports | PDF + schedules |
| 0006 | workforce_attendance_foundation | 5 attendance tables |
| 0007 | attendance_import_center | Import pipeline |
| 0008 | workforce_geofence_self_service | Geofence + policies |
| 0009 | workforce_integration_hub | Connectors |
| 0010 | payroll_canonical_foundation | 10 payroll tables |
| 0011 | payroll_calculation_payslips | Payslip calc |
| 0012 | payroll_operations_export | Ops export |
| 0013 | finance_canonical_foundation | 13 finance tables |
| 0014 | finance_prepare_trial_balance | ALTER batches only |
| 0015 | finance_governance_ops | 2 governance tables |
| 0016 | platform_governance_control_plane | 3 platform tables |
| 0017 | procurement_canonical_foundation | 11 tables |
| 0018 | inventory_canonical_foundation | 15 tables |
| 0019 | inventory_stock_movements | movements + transfer/issue headers |

**Quality:** Additive, phase-tagged; **no destructive migrations** in chain.  
**Risk:** Snapshot/meta lag vs journal — verify `drizzle-kit` state before greenfield deploy.

---

## 2. Schema files (canonical vs legacy)

### Canonical domain schemas (`*-canonical.ts`)

| File | Tables | Domain |
|------|--------|--------|
| `payroll-canonical.ts` | 13 | Payroll |
| `finance-canonical.ts` | 15 | Finance |
| `procurement-canonical.ts` | 11 | Procurement |
| `inventory-canonical.ts` | 18 | Inventory |

### Workforce (canonical-style naming)

| File | Tables |
|------|--------|
| `workforce-attendance.ts` | 5 |
| `attendance-import.ts` | 3 |
| `workforce-integration.ts` | 3 |
| `workforce-geofence.ts` | 2 |

### Legacy monolith

| File | Tables | Issue |
|------|--------|-------|
| `hr.ts` | **42** | payroll, attendance, leave legacy + employees + org |

### Platform core

`users`, `workspaces`, `workflows`, `forms`, `tickets`, `modules`, `commercial-*`, `platform-governance`, etc.

---

## 3. Canonical DB state (tenant data model)

**Isolation:** `workspace_id` on all tenant tables (P18-A confirmed).

**Person:** `employees` canonical; `users` for auth.

**Org:** `hr_org_units` canonical; `departments` legacy.

**Leave:** `leave_requests` canonical; `hr_employee_leaves` legacy.

**Payroll:** `payroll_*` canonical; `hr_payroll_*` legacy (`legacy_payroll_run_id` FK).

**Attendance:** `attendance_*` canonical; `hr_attendance` legacy (`legacy_attendance_id`).

**Finance:** `finance_*` — journals as **prepared** batches, not posted GL.

**Procurement:** `procurement_*` full chain PR→RFQ→PO.

**Inventory:** `inventory_*` + `inventory_stock_movements` ledger.

---

## 4. Partial / orphan / duplicated structures

| Issue | Severity |
|-------|----------|
| Parallel payroll schemas | **High** — bridge required |
| Parallel attendance | **High** |
| Parallel leave | **Medium** |
| `inventory_inventory_policies` table name (double prefix) | **Low** — naming drift |
| Governance/reliability tables (remediation, recovery, compliance chains) | **Low** — platform ops, few tenant UIs |
| Finance module not in `platform_modules` | **Medium** — product drift |
| PO items `inventoryItemId` (0018 additive on procurement) | **OK** — integration point |

**Orphan tables:** None found completely unreferenced; **platform ops tables** are route-backed but not service-layered.

---

## 5. Integrity gaps

1. **Legacy + canonical dual-write risk** if both HR and canonical routes used for same action.
2. **Leave migration** — canonical schema may predate applied DB on older installs (P18-A warning).
3. **Optimistic locking** on stock balances (inventory) — runtime enforced in service, not DB constraint everywhere.
4. **Foreign keys** generally `restrict`/`cascade` on canonical modules — good.
5. **No tenant_id** on operational tables — correct; platform uses workspace as tenant.

---

## 6. Schema maturity by domain

| Domain | Schema | Runtime use |
|--------|--------|-------------|
| Platform | **Mature** | Full |
| Workflows | **Mature** | Full |
| HR employees/org | **Mature** | Full |
| Leave | **Partial** | Dual model |
| Attendance | **Mature** | Partial cutover |
| Payroll | **Mature** | Partial cutover |
| Finance | **Mature** | Prepare-only |
| Procurement | **Mature** | Partial UI |
| Inventory | **Mature** | Partial UI |
| ATS/LMS/Performance | **Absent** | — |

---

## 7. Verdict

**Canonical DB state: PARTIAL (~65%)** — strong additive ERP expansion on HCM base; legacy coexistence is the main integrity risk.  
**Migration quality: GOOD** (additive, numbered).  
**Meta/snapshot discipline: NEEDS ATTENTION** (single snapshot file).
