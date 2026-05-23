# Canonical Workforce Mapping

**Phase:** 1 — Workforce Canonicalization  
**Purpose:** Authoritative field/table mapping from legacy → canonical runtime

---

## 1. Entity Canonicalization

| Legacy / parallel | Canonical | Relationship | Phase 1 action |
|-------------------|-----------|--------------|----------------|
| `users` (workforce fields) | `employees` | 0..1 via `employees.userId` | Employee is truth; user mirrors for compat |
| `departments` | `hr_org_units` (type=`department` or mapped type) | M:N map table | Map + dual-read |
| `user_departments` | `employees.orgUnitId` (primary unit only initially) | Simplify to single primary | Backfill primary only |
| `users.lineManagerId` | `employees.directManagerId` → manager.`userId` | Denormalized mirror | Sync on link/update |
| `users.position` | `employees.jobTitleId` + `jobTitle.name` | Denormalized mirror | Sync optional |
| `users.employeeNumber` | `employees.employeeNumber` | Must match when linked | Validate uniqueness |
| `departments.managerId` | Future: org unit head role (Phase 2) | Not canonical yet | Log only |

---

## 2. Field-Level Mapping

### 2.1 User → Employee (on link or provision)

| users column | employees column | Sync rule |
|--------------|------------------|-----------|
| `fullName` | `fullName` | Employee wins in `active` mode |
| `email` | `email` | Employee wins |
| `phoneNumber` | `phoneNumber` | Employee wins |
| `employeeNumber` | `employeeNumber` | Must equal if both set |
| `position` | `position` OR `jobTitleId` | Map title by name if match |
| `departmentId` | `orgUnitId` | Via `legacy_department_org_map` |
| `lineManagerId` | `directManagerId` | Reverse: find employee where userId=lineManagerId |
| `employmentStatus` | `status` | Map codes (see §4) |
| — | `userId` | Set on link |

### 2.2 Employee → User (compat mirror, `employee_to_user` sync)

| employees column | users column | When |
|------------------|--------------|------|
| `directManagerId` → manager.userId | `lineManagerId` | On PATCH directManagerId |
| `orgUnitId` → map reverse | `departmentId` + `user_departments` | If map exists |
| `jobTitle.name` | `position` | Display mirror |
| `status` | `employmentStatus` | Code map |

---

## 3. Organizational Mapping

### 3.1 Department → Org Unit

**Table:** `legacy_department_org_map`

| Column | Type |
|--------|------|
| `workspace_id` | FK |
| `department_id` | FK departments |
| `org_unit_id` | FK hr_org_units |
| `mapping_source` | `auto_name` \| `manual` \| `seed` |
| `created_at` | timestamp |

**Auto-match algorithm (idempotent):**
1. Normalize name (trim, lower, collapse spaces)
2. Match `departments.name` → `hr_org_units.name` where type in (`department`, `team`, `unit`)
3. If single match → insert map row
4. Else → insert `workforce_migration_exceptions`

### 3.2 Org unit types (canonical)

| Canonical type | Legacy equivalent | Notes |
|----------------|-------------------|-------|
| `company` | — | Root |
| `branch` | — | Add to Foundation UI Phase 1.1 |
| `division` | — | |
| `department` | `departments` row | Primary mapping target |
| `team` | — | |
| `unit` | — | UI-only today; keep |

---

## 4. Status & Employment Code Maps

### 4.1 Employee status

| employees.status (text) | hr_employee_statuses.code | users.employmentStatus |
|-------------------------|---------------------------|------------------------|
| active | active | active |
| on_leave | on_leave | on_leave |
| suspended | suspended | suspended |
| terminated | terminated | terminated |
| resigned | resigned | resigned |

**Phase 1:** Keep text on employee; validate against lookup catalog in `shadow` mode.  
**Phase 4:** FK or enforced CHECK via application.

### 4.2 Employment type

| employees.employmentType | hr_employment_types.code |
|--------------------------|--------------------------|
| full_time | full_time |
| part_time | part_time |
| contractor | contractor |
| intern | intern |
| temporary | temporary |

Import validation: replace hardcoded set with DB lookup.

---

## 5. Manager Resolution (Canonical Algorithm)

```
resolveApproverUserId(employeeId, workspaceId):
  1. emp = employees[employeeId]
  2. if emp.directManagerId:
       mgr = employees[emp.directManagerId]
       if mgr.status == 'active' && mgr.userId:
         return { userId: mgr.userId, source: 'direct_manager' }
  3. orgHead = resolveOrgUnitHead(emp.orgUnitId)  // Phase 2
  4. fallback = first active admin in workspace
  5. return { userId: fallback, source: 'admin_fallback' }
```

**Workflow adapter (Phase 1):**
```
resolveWorkflowManager(triggerUserId):
  emp = employee by userId
  if emp: return resolveApproverUserId(emp.id)
  else: return users[triggerUserId].lineManagerId  // legacy
```

---

## 6. API Enrichment (non-breaking)

Add optional `_workforce` block to user/employee responses when `?include=workforce`:

```json
{
  "id": 42,
  "fullName": "...",
  "_workforce": {
    "employeeId": 17,
    "orgUnitId": 3,
    "orgUnitPath": ["Acme", "HR", "Recruitment"],
    "directManagerEmployeeId": 8,
    "canonicalMode": "active"
  }
}
```

---

## 7. Data That Stays Legacy (Phase 1)

| Data | Reason |
|------|--------|
| `group_members` | Collaboration, not workforce |
| `approvals.ticket_id` | Ticket domain until Phase 3 |
| `governance_workflow_actions` | Platform ops |
| Ticket assignee fields | ITSM domain |

---

## 8. Orphan Prevention Rules

| Rule | Enforcement |
|------|-------------|
| `directManagerId` ≠ self | PATCH reject |
| Manager same `workspaceId` | PATCH reject |
| `orgUnitId` same workspace | PATCH reject |
| Delete org unit with employees | SET NULL → warn; Phase 4 block |
| Unlink user | Keep employee; clear userId only |

---

## 9. Migration Exception Catalog

`workforce_migration_exceptions.exception_type`:

- `DEPARTMENT_NO_ORG_MATCH`
- `MANAGER_NO_USER_LINK`
- `USER_NO_EMPLOYEE`
- `DUPLICATE_EMPLOYEE_NUMBER`
- `MANAGER_CYCLE_DETECTED`
- `ORG_PARENT_CYCLE`

---

*End of Canonical Workforce Mapping.*
