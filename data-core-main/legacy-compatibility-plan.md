# Legacy Compatibility Plan

**Phase:** 1 — Workforce Canonicalization  
**Rule:** No legacy deletion; adapters until Phase 5 validation

---

## 1. Compatibility Layer Architecture

```
                    ┌─────────────────────────┐
                    │  WorkforceCanonical     │
                    │  Service (new)          │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
  UserCompatAdapter    DepartmentCompatAdapter   WorkflowCompatAdapter
        │                       │                       │
        ▼                       ▼                       ▼
   users.ts              departments.ts           steps/approval.ts
   admin.ts              user_departments         steps/notification.ts
```

**Location (proposed):** `artifacts/api-server/src/lib/workforce/`

---

## 2. Feature Flag Matrix

| `workforceCanonicalMode` | Reads | Writes |
|--------------------------|-------|--------|
| `legacy` | Legacy fields only | Legacy only |
| `shadow` | Legacy authoritative; canonical computed + logged diff | Legacy only |
| `active` | Canonical authoritative | Canonical + sync legacy mirrors |

**Default:** `legacy` for all existing workspaces (migration column default).

---

## 3. Per-Consumer Compatibility

### 3.1 Users API (`routes/users.ts`, `admin.ts`)

| Operation | Legacy behavior preserved | Adapter behavior (`active`) |
|-----------|---------------------------|----------------------------|
| Create user | Same | Optionally create/link employee if `createEmployee: true` |
| Update departments | Writes `user_departments` | Also PATCH linked employee `orgUnitId` |
| Update lineManagerId | Writes user row | Also PATCH employee `directManagerId` |
| List users | Same shape | Add optional `employeeId`, `orgUnitName` |

**Non-breaking:** All new fields optional; old clients ignore.

### 3.2 Departments API (`routes/departments.ts`)

| Operation | Legacy | Adapter |
|-----------|--------|---------|
| CRUD department | Unchanged | Also upsert mapped `hr_org_units` row if `syncOrgUnits: true` |
| GET list | Unchanged | Include `mappedOrgUnitId` when map exists |

**Do not remove** `/departments` route in Phase 1.

### 3.3 HR Employees API (`routes/hr.ts`)

| Operation | Legacy | Adapter |
|-----------|--------|---------|
| POST/PATCH employee | Unchanged | After write, call `UserMirrorSync.syncFromEmployee(employee)` if linked |
| Link user | Sets userId only today | Also sync manager/org/title mirrors |

### 3.4 Leave (`routes/leave.ts`)

| Step | Change |
|------|--------|
| `findApproverForEmployee` | Delegate to `WorkforceCanonical.resolveApproverUserId` |
| Fallback chain | Unchanged semantics; single implementation |

### 3.5 Workflows (`steps/approval.ts`, `notification.ts`)

| Step | Change |
|------|--------|
| `approverType=manager` | Try employee path via trigger userId → employee → directManager |
| Fallback | `users.lineManagerId` (legacy) |
| Log | `{ resolver: 'canonical' \| 'legacy' }` in shadow mode |

### 3.6 Forms / self-service

No change Phase 1; employee link still required for HR self-service.

---

## 4. Dual-Write Sync Rules (`active` mode)

**On employee PATCH (org, manager, title):**
1. Commit employee row
2. If `employee.userId` set → update user mirrors in same transaction
3. Emit `workforce.canonical.updated` event (for audit, Phase 4)

**On user PATCH (department, lineManager):**
1. If linked employee exists AND `workforceSyncDirection=bidirectional`:
   - Update employee from user via reverse map
2. Else: legacy only + log `SHADOW_MISMATCH` in shadow mode

**Conflict policy:** Employee wins in `active` mode unless explicit admin override flag.

---

## 5. Read Replacement Strategy (Phase 5 prep)

| Legacy read | Replacement read | Deprecation signal |
|-------------|------------------|-------------------|
| `users.departmentId` | `employees.orgUnitId` via join | Header `Deprecation: departmentId` Year 2 |
| `users.lineManagerId` | canonical resolver | Same |
| `departments.*` | `hr_org_units.*` via map | Dashboard notice |

**Phase 1:** No deprecation headers yet.

---

## 6. Rollback Plan

| Scenario | Rollback |
|----------|----------|
| Bad sync corrupts user mirrors | Set workspace to `legacy`; run restore script from `workforce_sync_audit` |
| Migration script partial fail | Re-run idempotent script; fix exceptions table |
| Workflow approver regression | Feature flag per workspace revert to `legacy` |

**Requirement:** `workforce_sync_audit` append-only log of mirror writes (Phase 1.2).

---

## 7. Testing Matrix

| Test | legacy | shadow | active |
|------|--------|--------|--------|
| Create employee + link user | ✓ | ✓ | ✓ mirrors |
| User dept change | ✓ | diff logged | employee updated |
| Leave approval path | ✓ | ✓ | ✓ canonical |
| Workflow manager step | ✓ | ✓ | ✓ canonical |
| Import employees | ✓ | ✓ | ✓ |
| API contract snapshots | unchanged | unchanged | unchanged + optional fields |

---

## 8. Production Safety

- Adapters wrapped in try/catch — mirror sync failure **must not** fail primary employee write (log + alert)
- Shadow mode never writes canonical to legacy except audit log
- All adapter code behind workspace flag check
- No DELETE on legacy tables

---

*End of Legacy Compatibility Plan.*
