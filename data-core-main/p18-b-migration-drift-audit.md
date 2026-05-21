# P18-B — Migration Drift Audit

**Date:** 2026-05-19  
**Method:** Static comparison of `lib/db/src/schema/*`, `lib/db/drizzle/0000_sad_midnight.sql`, `lib/db/drizzle/meta/0000_snapshot.json`, and manual apply scripts under `scripts/apply-*.cjs`.  
**No DB connection executed.** No migrations applied.

---

## 1. Migration inventory

| Source | Role |
|--------|------|
| `lib/db/drizzle/0000_sad_midnight.sql` | Sole checked-in Drizzle migration (baseline) |
| `lib/db/drizzle/meta/_journal.json` | Single entry: `0000_sad_midnight` |
| `scripts/apply-p16-tables.cjs` | Optional manual SQL for P16 workspace subscription tables |
| `scripts/apply-p17*.cjs` | Optional manual SQL for platform user tables (out of HR scope) |

**Implication:** Environments that only run `drizzle-kit migrate` from the journal get **baseline only**. P16/P17 and several schema-only tables require **additional** apply scripts or a **new** migration not present in the journal.

---

## 2. HR tables — schema vs `0000_sad_midnight.sql`

### 2.1 Present in both (aligned for HR core)

All HR Foundation and operations tables below appear in Drizzle schema (`hr.ts`) **and** `CREATE TABLE` in `0000_sad_midnight.sql`:

| Table | In migration | Notes |
|-------|--------------|-------|
| `employees` | Yes | |
| `hr_org_units` | Yes | |
| `hr_job_grades`, `hr_job_titles` | Yes | |
| `hr_work_locations`, `hr_positions` | Yes | |
| `hr_custom_field_defs`, `hr_custom_field_values` | Yes | |
| `hr_employee_contracts`, `hr_employee_documents` | Yes | |
| `hr_employee_leaves` | Yes | Legacy leave |
| `hr_employee_position_history`, `hr_employee_notes`, `hr_employee_activity` | Yes | |
| `hr_employee_statuses`, `hr_employment_types`, `hr_contract_types` | Yes | |
| `hr_document_types`, `hr_leave_policies`, `hr_probation_policies` | Yes | |
| `hr_leave_balances` | **Yes** (line ~719 in migration) | Confirmed present |
| Payroll family | Yes | components, structures, bands, compensations, runs, payslips, lines |
| Attendance family | Yes | shifts, calendars, holidays, attendance, overtime |
| `hr_services`, `hr_service_categories` | Yes | |
| `hr_workspace_settings`, `hr_workspace_counters` | Yes | |
| Workspace shell (HR-related) | Yes | `workspaces`, `workspace_module_settings`, `departments`, etc. |

**`hr_org_units`:** Schema and migration columns match at table level (type, parent_id, workspace_id, indexes). **No enum/check constraints** in PostgreSQL — types are `text` in both.

### 2.2 Schema only — NOT in baseline migration (CRITICAL for HR leave)

| Table | Drizzle schema | `0000_sad_midnight.sql` | Severity | Production |
|-------|----------------|-------------------------|----------|------------|
| `leave_requests` | Yes (`hr.ts`) | **No** | **Critical** | **Blocker** for `routes/leave.ts` |
| `leave_approval_steps` | Yes | **No** | **Critical** | **Blocker** (FK to leave_requests) |

**Evidence:** `grep leave_request` on `lib/db/drizzle/` → no matches. `leave.ts` performs INSERT/UPDATE/SELECT on these tables.

**Classification:** **production blocker** on any DB created solely from `0000_sad_midnight.sql`.

### 2.3 Workspace P16 tables — schema + manual script only

| Table | In `0000` migration | In `apply-p16-tables.cjs` |
|-------|---------------------|---------------------------|
| `workspace_subscriptions` | No | Yes (IF NOT EXISTS) |
| `workspace_entitlements` | No | Yes |
| `workspace_quota_limits` | No | Yes |
| `workspace_subscription_policies` | No | Yes |
| `workspace_access_enforcement` | No | Yes |

**Severity:** Medium for HR domain (subscription enforcement), **Critical** if P16 APIs run without script.  
**Safe:** Document which environments ran `apply-p16-tables.cjs`.  
**Risky:** Assuming schema === production DB without verification.

---

## 3. Non-HR schema drift (context for workspace operators)

These affect workspace viability but are outside P18-A HR decisions; listed because they share the same drift pattern:

| Area | Schema | Baseline migration | Severity |
|------|--------|-------------------|----------|
| `users` platform columns | `platform_role_code`, `is_root_owner`, `is_protected`, P17-A lifecycle fields, etc. | **Missing** — migration `users` stops at `must_reset_password` | **Critical** for platform auth |
| `tenant_subscriptions`, `tenant_entitlement_overrides` | Yes | **No** | Medium–Critical (commercial) |
| `commercial_*` tables | Yes | **No** | Medium (commercial phase) |
| `governance_*`, `reliability_*`, `remediation_*`, etc. | Yes | **No** | Low for HR |
| `workflow_definition_versions`, `workflow_approvals` | Yes | **No** (older workflow tables only) | Medium (HR services use workflows) |
| `platform_user_*` (P17) | Yes | **No** (use `apply-p17*.cjs`) | N/A (platform) |

---

## 4. Migration without schema / reverse drift

**Finding:** All `CREATE TABLE` names in `0000_sad_midnight.sql` have corresponding Drizzle definitions in `lib/db/src/schema/` (including older workflow shape). **No orphan migration-only HR tables** identified.

**Workflow column drift (medium):** `workflow_definitions` exists in migration; schema adds versioned model (`workflow_definition_versions`, etc.) that may not exist in DB until a future migration — affects HR service automation, not core employee tables.

---

## 5. Enums / check constraints

| Item | State |
|------|--------|
| PostgreSQL ENUM types | **Not used** for HR — all lifecycle values are `text` |
| Check constraints | **Not found** in baseline SQL for `employees.status`, `contract_type`, etc. |
| Drizzle schema comments | Document intended values (e.g. `active \| on_leave`) but DB does not enforce |

**Drift type:** **Semantic** (application vs catalog), not migration enum mismatch.

---

## 6. Specific verification checklist (requested)

| Check | Result |
|-------|--------|
| `leave_requests` in DB via migration? | **No** — schema only |
| `leave_approval_steps` in DB via migration? | **No** |
| `hr_leave_balances` in migration? | **Yes** |
| `hr_org_units` aligned? | **Yes** at table/column level |
| `employees.status` vs `hr_employee_statuses` catalog? | **Not aligned** — see §7 |
| Contract types vs catalog? | **Not aligned** — see §7 |
| Nullable/FK/index drift (HR) | **Low** within tables present in both; leave FKs N/A until tables exist |
| Duplicate migration logic | **Yes** — baseline + optional `apply-p16-tables.cjs` for overlapping concern (subscriptions) with separate `tenant_subscriptions` in schema |

---

## 7. Semantic / catalog drift (not migration file drift)

| Field | Catalog table | Runtime validation | Severity | Production |
|-------|---------------|-------------------|----------|------------|
| `employees.status` | `hr_employee_statuses` | Hardcoded set in import preview only: `active`, `on_leave`, `suspended`, `terminated`, `resigned` — **not** loaded from catalog on create/update | **Medium** | **Risky** — inconsistent statuses in data |
| `hr_employee_contracts.contract_type` | `hr_contract_types` | Body defaults to `"permanent"` string; no FK to catalog | **Medium** | **Risky** |
| `employees.employment_type` | `hr_employment_types` | Default `full_time`; import validates fixed set | **Medium** | **Risky** |

These do not require a migration fix to **exist**, but require a **data model decision** before enforcement.

---

## 8. Drift summary matrix

| ID | Drift | Level | Safe / Risky / Blocker |
|----|-------|-------|-------------------------|
| D1 | `leave_requests` + `leave_approval_steps` missing from baseline migration | Critical | **Production blocker** |
| D2 | P16 workspace tables only in manual script | Medium | Risky without runbook |
| D3 | `users` platform columns missing from baseline | Critical (platform) | Blocker for full app on clean migrate |
| D4 | Employee status text vs catalog | Medium | Risky |
| D5 | Contract type text vs catalog | Medium | Risky |
| D6 | Single migration journal entry vs large schema surface | Medium | Risky for new environments |
| D7 | `employees.leave_balances` jsonb + `hr_leave_balances` table | Low | Safe (document dual storage) |

---

## 9. Recommendations (audit only — no action taken)

1. **Before enabling `leave.ts`:** Add formal migration(s) for `leave_requests` and `leave_approval_steps` to Drizzle journal; verify on staging with `information_schema`.
2. **Environment runbook:** Document required scripts: baseline `0000` + `apply-p16-tables.cjs` (+ P17 if platform) vs schema-only code deploy.
3. **Do not assume** `hr_leave_balances` missing — it **is** in baseline; prior discovery note about “leave tables” referred to **canonical** leave, not balances.
4. **Catalog alignment** tracked as data-quality phase, not migration drift phase.

---

**Confirmation:** No migrations applied. No schema files modified. Audit/documentation only.
