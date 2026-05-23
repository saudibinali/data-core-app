# HR Operational Readiness Audit (Phase 4)

**Scope:** How HR processes behave when org structure is missing or incomplete.

---

## 1. Readiness Summary Matrix

| Process | Depends on org? | Works without dept? | Works without manager? | Works without position? | Works without user link? | Readiness |
|---------|-----------------|---------------------|------------------------|-------------------------|--------------------------|-----------|
| **Leave (canonical)** | Manager + employee | ⚠️ Yes | ⚠️ Yes (admin fallback) | ✅ Yes | ❌ Self-service needs link | **Medium–High** |
| **Leave (legacy)** | Employee id | ✅ | ✅ | ✅ | ⚠️ | **Maintenance** |
| **Attendance self-service** | Employee + user | ✅ | ✅ | ✅ | ❌ **404** | **Medium** |
| **Payroll** | Employee id | ✅ | ✅ | ✅ | ⚠️ | **Medium** |
| **Employee transfer** | History table | ✅ | ✅ | ✅ | ✅ | **Low** (audit only) |
| **Promotions** | Position history | ✅ | ✅ | ✅ | ✅ | **Low** (manual) |
| **Disciplinary** | Notes | ✅ | ✅ | ✅ | ✅ | **Low** (notes only) |
| **Resignation** | Status field | ✅ | ✅ | ✅ | ✅ | **Partial** (status) |
| **Onboarding** | `onboardingData` jsonb | ✅ | ✅ | ✅ | ✅ | **Partial** |
| **Offboarding** | Termination status | ✅ | ✅ | ✅ | ⚠️ | **Partial** |
| **Workflow approvals** | User line manager | ✅ | ⚠️ Skips if no lineManagerId | ✅ | N/A (user-based) | **Medium** |

---

## 2. Leave Approvals

### Canonical path (`routes/leave.ts`)

**Requires:**
- Valid `employeeId` for requester
- Requester ideally has `employees.userId` for self-service submit
- Policy/calendar/balance infrastructure (workspace-configured)

**Manager resolution when `directManagerId` is NULL:**
1. Skip to workspace admin approver
2. `resolveApproverWithFallback` may assign requester if no admin exists

**When manager exists but has no `userId`:**
- Step 1 fails → admin fallback (manager invisible to approval UX)

**When org unit missing:**
- Leave still creatable — org not used in approver resolution Phase 1

**Runtime mode:** `hr_workspace_settings.leaveRuntimeMode` — `legacy` | `transition` | `canonical`

**Verdict:** **Operational** with **degraded approval routing** when structure incomplete.

---

## 3. Attendance Hierarchy

**Self-service:** `workforce-attendance.ts`

```typescript
// Requires employees.userId match for authenticated user
"No employee profile linked to this user" → 404
```

**Org fields:** Not used for approval hierarchy in attendance routes audited.

**Manager visibility:** Not required for clock-in/out self-service.

**Verdict:** **Operational for linked employees**; org hierarchy **not a gate**.

---

## 4. Payroll Approvals

**Tables:** `hr_employee_compensations`, payroll runs in `hr.ts`, parallel `payroll-canonical.ts`

**Dependencies:**
- `employeeId` on compensation and payslip records
- **Not observed:** mandatory org unit or manager for payroll run approval

**UI:** `hr-payroll.tsx`, `hr-payroll-ops.tsx`

**Workflow trigger:** Optional seed on `payroll.run.review` — uses workflow engine (user line manager pattern)

**Verdict:** **Medium readiness** — employee record centric; org optional.

---

## 5. Employee Transfer & Promotion

### Position history (`hr_employee_position_history`)

- Records: transfer, promotion, demotion, dept_change, etc.
- **Does not auto-update** employee current org/manager/title fields

### Bulk org reassignment

- `POST /hr/employees/bulk` can set `orgUnitId` on selected employees

### Operational gap

- No governed “transfer workflow” tying history → employee update → notifications
- Admins must manually PATCH employee after logging history (or use bulk)

**Verdict:** **Low operational readiness** — journaling without state machine.

---

## 6. Disciplinary Actions

**Mechanism:** `hr_employee_notes` with `noteType` including `disciplinary`

- Free-text notes with confidential flag
- **No** separate disciplinary case workflow, hearings, or approval chain

**Verdict:** **Notes only — not enterprise disciplinary module.**

---

## 7. Resignation Flows

**Mechanism:**
- Employee `status = resigned` (editable in detail UI)
- Foundation status lookup includes `resigned` as final state
- **No** dedicated offboarding checklist workflow observed in routes grep

**Verdict:** **Status flag only.**

---

## 8. Onboarding / Offboarding

| Feature | Storage | Operational? |
|---------|---------|--------------|
| Onboarding data | `employees.onboardingData` jsonb | PATCH allowed — structure undefined in audit |
| Account link | `employee-account-service` | Link user after hire |
| Provision | `POST /hr/employees/provision` | Minimal create |
| Offboarding | Status → terminated/resigned | Manual |

**No** automated provisioning of org placement, manager assignment, or equipment workflows tied to onboarding state.

---

## 9. Scenario Analysis — Missing Structure

### Employee with NO department (`orgUnitId` NULL)

| Process | Behavior |
|---------|----------|
| HR roster | Shows empty org unit |
| Reports | Org dimension missing |
| Leave | Still works |
| Workflows | Unaffected (user-based) |
| Entitlement “organization_structure” | Product flag may be true while data empty |

### Employee with NO manager

| Process | Behavior |
|---------|----------|
| Leave | Admin (or requester) becomes approver — **governance risk** |
| Workflow approval step | Skips if no lineManagerId on **user** |
| Notifications | No manager-targeted routing |

### Employee with NO position/title

| Process | Behavior |
|---------|----------|
| Display | Falls back to free-text or blank |
| Approvals | Unaffected |
| Payroll | Unaffected if compensation exists |

### Employee with NO user link

| Process | Behavior |
|---------|----------|
| Self-service leave/attendance | **Blocked or admin-only** |
| Workflow as requester | User account separate — employee-only record invisible to self-service |
| Leave via admin on behalf | Possible |

---

## 10. Dual-Model Failure Modes

| Misconfiguration | Symptom |
|------------------|---------|
| User has lineManagerId; employee directManagerId empty | Leave → admin; workflow → user manager |
| Employee manager set; user lineManagerId empty | Leave → manager; workflow → skip/fallback |
| User in `departments`; employee in different `hr_org_units` | Reports disagree; no single org truth |
| Employee linked to user but names/emails differ | Directory confusion |

---

## 11. Domain Module Index

| Module | Primary routes / UI |
|--------|---------------------|
| Employees | `hr.ts`, `hr-employees.tsx`, `hr-employee-detail.tsx` |
| Leave | `leave.ts`, `hr-me-leave.tsx`, employee leaves tab |
| Attendance | `workforce-attendance.ts`, `hr-attendance.tsx` |
| Payroll | `hr.ts`, `payroll-canonical.ts`, `hr-payroll*.tsx` |
| Workforce ops | `hr-workforce-ops.tsx`, integration schemas |

---

## 12. Phase 4 Verdict

| Question | Answer |
|----------|--------|
| HR modules runnable without full org? | **Yes — most degrade gracefully** |
| Safe without manager? | **No — approval fallbacks are unsafe** |
| Enterprise process coverage? | **Leave/payroll medium; transfer/disciplinary/onboarding low** |
| Structure enforced before operations? | **No** |

---

*End of Phase 4 — HR Operational Readiness Audit.*
