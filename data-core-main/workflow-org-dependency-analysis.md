# Workflow & Org Dependency Analysis (Phase 5)

**Scope:** How automation modules depend on HR Foundation / org structure — and what's missing for enterprise routing.

---

## 1. Dependency Map

```
                    ┌─────────────────────┐
                    │  HR Foundation      │
                    │  org units, titles, │
                    │  leave policies, …  │
                    └──────────┬──────────┘
                               │
     ┌─────────────┬───────────┼───────────┬─────────────┐
     ▼             ▼           ▼           ▼             ▼
  Leave        Workflows   Self-serv   Attendance    Payroll
  (employee    (users      (forms +    (employee     (employee
   manager)      lineMgr)    employee)   userId)       id)
```

---

## 2. Module-by-Module Analysis

### 2.1 Workflow engine

| Foundation data | Used? | How |
|---------------|-------|-----|
| Org units | ❌ | — |
| Position / job title | ❌ | — |
| Job grade | ❌ | — |
| `department_head` | ❌ Type only | Not in resolver |
| Manager | ⚠️ | `users.lineManagerId` only |
| Role | ✅ | `approverType=role` → users.role |
| Leave policies | ❌ | Separate domain |

**Gap:** Workflow **does not read HCM foundation** except indirectly if trigger payload includes employee fields.

**Why technical not operational:** Admin configures HR org in Foundation; workflows ignore it and use user table manager field.

### 2.2 Approvals (multi-channel)

| Channel | Org dependency |
|---------|----------------|
| Workflow approvals | User lineManagerId |
| Legacy ticket approvals | Ticket assignee / approver user |
| Canonical leave | Employee directManagerId + userId |
| Leave policy | `requiresApproval` flag only |

**No unified approver derived from org unit head or position seat.**

### 2.3 Self-service

| Flow | Foundation dependency |
|------|----------------------|
| Form submit | Form permissions JSON — not org-based |
| Leave self-service | Employee link + leave policy list |
| Attendance | Employee userId link |
| Pending approvals tab | Legacy tickets — not org |

**Org structure does not gate** which forms/services appear (except generic permission roles).

### 2.4 Attendance

- Requires `employees.userId` for self-service
- Geofence / work location from workforce modules — **partial** link to `hr_work_locations`
- **No** manager approval chain for attendance corrections in foundation dependency

### 2.5 Payroll

- Runs on `employeeId`, compensation records
- **No** requirement for org unit or position seat
- Salary components in foundation — separate payroll config layer

### 2.6 Leave (strongest foundation coupling)

| Foundation field | Runtime use |
|------------------|-------------|
| `hr_leave_policies.id` | Request `leavePolicyId` |
| `requiresApproval` | Skip or create approval step |
| `paid`, leaveType | Context / listing |
| `annualDays`, `accrualType`, `carryOver` | **Not auto-accrual engine** in leave.ts |
| `hr_leave_balances` | Deduct/restore days when policy linked |
| Employee manager | Approver user resolution |

**Org unit:** Not used in approver selection.

### 2.7 HR operations (contracts, documents, movements)

| Entity | Foundation lookup used? |
|--------|-------------------------|
| Contracts | `contractType` text — **not** FK to `hr_contract_types` |
| Documents | `documentType` text — **not** FK to `hr_document_types` |
| Position history | Records org/manager change — **does not update** employee |
| Probation | Manual dates — **not** linked to probation policies |

---

## 3. What Is Missing for Enterprise-Grade Approvals

1. **Single approver resolution service** reading employee graph + org unit heads
2. **Foundation FK binding** so status/employment/contract types drive validation
3. **Position incumbent model** tying seats to people and vacancy rules
4. **Multi-level approval** auto-generated from org depth or grade
5. **Delegation / acting manager** with date bounds
6. **Matrix org** support for dual routing
7. **Policy inheritance** from org unit (leave rules by department)
8. **Workflow integration** with `directManagerId` not `lineManagerId`
9. **Accrual engine** consuming leave policy `annualDays` / `accrualType`
10. **Mandatory org placement** before operational modules activate

---

## 4. Why Current Workflow Feels Technical vs Operational

| Symptom | Cause |
|---------|-------|
| Admin sets org in Foundation | Workflows don't consume it |
| "Manager approval" step | Reads wrong table for HCM tenants |
| department_head in designer | Resolver missing — config fiction |
| Leave uses employee manager | Workflows use user manager — ops confusion |
| Optional org on hire | Automations fall back to admin |
| Rich leave policy UI | Accrual fields decorative at runtime |
| Position seats with headcount | Never drive hiring constraints |

**Result:** Operators configure **enterprise-looking foundation** but runtime paths use **simpler user-centric or fallback logic**.

---

## 5. Foundation Data → Runtime Truth Table

| Foundation entity | Workflow | Leave | Payroll | Attendance | Self-service |
|-------------------|----------|-------|---------|------------|--------------|
| Org units | ❌ | ❌ | ⚠️ reports | ⚠️ | ❌ |
| Job titles | ❌ | ❌ | ❌ | ❌ | ❌ |
| Job grades | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| Positions | ❌ | ❌ | ❌ | ❌ | ❌ |
| Leave policies | ❌ | ✅ | ❌ | ❌ | ✅ list |
| Work locations | ❌ | ❌ | ❌ | ⚠️ | ❌ |
| Employment types | ❌ | ❌ | ⚠️ | ❌ | ❌ |
| Employee statuses | ❌ | ⚠️ status checks | ⚠️ | ⚠️ | ⚠️ |

---

## 6. Phase 5 Verdict

Enterprise routing requires **foundation → runtime binding + graph traversal**. Current state: **leave policies + employee manager partially connected**; org/position/job foundation **largely decoupled** from automation.

---

*End of Phase 5 — Workflow & Org Dependency Analysis.*
