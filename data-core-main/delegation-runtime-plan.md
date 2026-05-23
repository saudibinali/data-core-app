# Delegation Runtime Plan

**Phase:** 3 — Out-of-office & substitute approvers

---

## 1. Scope

| Type | Description |
|------|-------------|
| **Full delegation** | All approvals route to delegate |
| **Scoped delegation** | Leave only / specific process codes |
| **Acting position** | Phase 2 acting assignment (separate) |
| **Ad-hoc reassign** | Admin moves one pending step |

---

## 2. Schema (`workforce_delegations`)

| Column | Type | Notes |
|--------|------|-------|
| id | serial | |
| workspace_id | FK | |
| delegator_employee_id | FK employees | |
| delegate_employee_id | FK employees | Must have userId for notifications |
| start_date | date | Inclusive |
| end_date | date | Inclusive |
| scope | text | `all` \| `leave` \| `process:code` |
| reason | text | Optional |
| created_by | user | |
| is_active | bool | |

**Unique partial index:** one active `all` scope per delegator per date range overlap → reject overlap in app.

---

## 3. Resolution Order

When resolving approver for employee E at time T:

1. Check pending step explicit assignee
2. Check active delegation on intended approver → use delegate
3. Check acting assignment on position
4. Standard reporting chain

---

## 4. API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/hr/me/delegations` | My delegations |
| POST | `/hr/delegations` | Create (manager or HR) |
| DELETE | `/hr/delegations/:id` | Revoke early |
| POST | `/hr/approval-steps/:id/reassign` | Admin one-off |

---

## 5. UI

- Self-service: "I'm out of office" → pick delegate + dates
- Manager: delegate approvals for direct reports (optional policy)
- HR admin: org-wide delegation view

---

## 6. Audit

Log: `delegation.created`, `approval.delegated`, `approval.decided_by_delegate`

Store `decided_by_delegate=true` on approval_steps row.

---

## 7. Migration Safety

- No impact until Phase 3 approval runtime live
- Table created in Phase 2; unused until Phase 3
- Feature flag: `delegationEnabled`

---

## 8. Edge Cases

| Case | Behavior |
|------|----------|
| Delegate also on leave | Chain to delegate's delegate or escalate |
| Circular delegation | Reject at create |
| Delegate without user | Block create with clear error |
| End date passed | Cron deactivates; next approval uses original approver |

---

*End of Delegation Runtime Plan.*
