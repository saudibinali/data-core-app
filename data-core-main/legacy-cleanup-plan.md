# Legacy Cleanup Plan

**Phase:** 5 — Safe removal after replacement verified  
**Rule:** Nothing deleted until read replacement + runtime verification + production validation

---

## 1. Cleanup Inventory

| Legacy artifact | Replacement | Removal phase |
|-----------------|-------------|---------------|
| `departments` table | `hr_org_units` + map | 5.2 |
| `user_departments` | `employees.orgUnitId` (+ matrix table) | 5.2 |
| `users.departmentId` mirror | orgUnit via employee | 5.3 column deprecate |
| `users.lineManagerId` mirror | canonical resolver | 5.3 |
| `users.position` text | jobTitleId | 5.3 |
| `approvals` (ticket) | `approval_instances` | 5.4 |
| `workflow_approvals` | `approval_steps` | 5.4 |
| `leave_approval_steps` | `approval_steps` | 5.4 |
| `hr_employee_leaves` | `leave_requests` | 5.5 (after canonical mode all tenants) |
| Tenant workflow builder UI | process templates | 5.1 UI |
| `employees.leave_balances` jsonb | `hr_leave_balances` | 5.6 |
| `legacy_department_org_map` | native org only | 5.7 (keep read-only archive) |

---

## 2. Pre-Removal Checklist (per item)

- [ ] 0 production traffic on legacy read path (30 days metrics)
- [ ] Integrity script passes
- [ ] No API consumer in OpenAPI without `_deprecated` header period
- [ ] Rollback script documented
- [ ] DB backup snapshot taken
- [ ] Legal/compliance sign-off for audit tables

---

## 3. Column Deprecation Strategy

**Phase 5.3:** Stop writing mirror columns  
**Phase 5.3b:** API stops returning deprecated fields (major version)  
**Phase 5.3c:** DROP COLUMN in migration with explicit ops window

Never DROP in same release as stop-write without verification gap.

---

## 4. Table Removal Order

1. `user_departments` (after user dept writes stop)
2. `departments` (after map archived)
3. `approvals` (ticket legacy)
4. Dual-write staging tables if any
5. `hr_employee_leaves` (last — highest risk)

---

## 5. Reversible Cleanup

Before DROP:
- Export table to `archive_*` schema or S3 dump
- Migration `DOWN` script recreates table from archive (structure + data)

---

## 6. Code Removal

| Area | Action |
|------|--------|
| `routes/departments.ts` | Proxy to org API → remove |
| `departments.tsx` | Redirect to org console |
| Compat adapters | Remove after mirrors gone |
| Workflow tenant builder | Remove from ops-platform nav |
| Simulation-only onTimeout | Remove if SLA worker live |

---

## 7. Feature Flag Retirement

Remove `workforceCanonicalMode`, `approvalRuntimeMode` when only unified path remains — single code path simplifies hardening.

---

*See: runtime-integrity-validation.md, migration-safety-verification.md*
