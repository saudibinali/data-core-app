# Permissions & Governance Audit

**Audit date:** 2026-05-20

---

## 1. RBAC model

| Mechanism | Implementation | Maturity |
|-----------|----------------|----------|
| Workspace roles | `workspace_custom_roles` + `workspace_role_permissions` | **Runtime** |
| Permission catalog | `GET /permissions` in `workspace-roles.ts` | **Runtime** |
| Built-in roles | admin, manager, member, super_admin | **Runtime** |
| Dynamic HR service keys | `hr.services.{id}.request/manage` | **Runtime** |
| Dynamic department keys | `departments.{id}.*` (legacy) | **Runtime** |
| Route guards | `requirePermission`, `requireRoles` | **Runtime** |
| Module guards (UI) | `ProtectedRoute` + `moduleKey` | **Runtime** |

**Permission families (representative):**
- Core: dashboard, tickets, messages, calendar, users, roles, workflow
- HR: hr.view, hr.manage, hr.services.*, hr.payroll.export
- Finance: finance.view, finance.report.export, finance.reconcile, finance.governance.approve, finance.admin
- Procurement: procurement.view, vendor/PR/RFQ/PO manage, export, break_glass, confidential docs
- Inventory: inventory.view, warehouse/item/receipt/issue/transfer/adjustment/count, export, confidential, break_glass
- Tenant: tenant.billing.*, tenant.subscription.read
- Platform: platform.* codes (P23-A)

---

## 2. Workspace isolation

| Control | Status |
|---------|--------|
| JWT `workspaceId` | **Enforced** on tenant routes |
| Query filters `eq(table.workspaceId, …)` | **Standard** in services |
| `workspaceAccessWriteGuard` | **Runtime** — read-only mode blocks writes |
| Cross-workspace APIs | **Blocked** except platform scope |

**Gaps:** Platform operators (`workspace_id IS NULL`) have elevated paths — by design. Full cross-tenant regression suite not evidenced.

---

## 3. Platform governance (P23-A)

| Capability | Status |
|------------|--------|
| Module enable/disable + dependencies | **GO** |
| Lifecycle (activate/suspend/archive) | **GO** (non-destructive) |
| Support sessions (TTL, audit) | **PARTIAL** |
| Platform governance audit logs | **GO** |
| Platform ops overview API + UI | **PARTIAL** |
| Platform report exports (5 keys) | **GO** |
| MFA / full impersonation UX | **NOT IMPLEMENTED** (per P23 report) |

---

## 4. Module governance

```text
payroll → requires hr
finance → requires hr
procurement → requires hr
inventory → requires procurement + hr
```

**Service:** `ModuleGovernanceService.assertToggleAllowed`  
**UI:** Module toggles via workspace settings / platform APIs  
**Gap:** `finance` not in sidebar module catalog — dependency still applies if enabled via API

---

## 5. Workflow governance

- Workflow definitions workspace-scoped
- Governance intelligence layer (signals, trends, evidence, remediation) — **super-admin / experimental**
- Scheduler fairness policies in schema
- Approval steps integrated with `workflow_tasks`

**Maturity:** **PARTIAL** — powerful for admins; not simplified tenant policy UI.

---

## 6. Document governance

| Feature | Status |
|---------|--------|
| Document registry | **Runtime** |
| Folders, access grants | **Runtime** |
| Confidential classification | procurement + inventory permissions |
| Download tokens | **Runtime** |
| Lifecycle/legal hold | **PARTIAL** (schema varies; not full enterprise DMS) |

---

## 7. Audit systems

| System | Table / path |
|--------|----------------|
| Activity logs | `activity_logs` via event listeners |
| Workspace events | `workspace_event_logs` |
| Finance audit | `finance_audit_logs` |
| Platform governance audit | `platform_governance_audit_logs` |
| Inventory/procurement | `logInventoryActivity` / procurement audit helpers |

**HMAC on audit rows:** optional platform governance feature (P23).

---

## 8. Security gaps (strict)

1. **Transfer approve permission** — UI may use `inventory.transfer.create` for approve path (segregation of duties gap).
2. **Finance access** often bundled with `hr.manage` in export authorization fallbacks.
3. **Break-glass** permissions exist; operational procedure not productized.
4. **Leave legacy API** may bypass canonical approval audit if still callable.
5. **No field-level RBAC** on employee confidential attributes (workspace-level only).
6. **Impersonation / view-as** — audit-first, not full enterprise SSO (P23 deferred to P23-B).

---

## 9. Over-permissioned areas

- `hr.manage` — broad; gates finance report fallback
- `super_admin` / platform routes — wide commercial + tenant control
- Workflow admin — can define powerful cross-domain automations

---

## 10. Governance inconsistencies

| Area | Inconsistency |
|------|-------------|
| Org model | departments vs hr_org_units permissions |
| Approvals | Standalone approvals module vs workflow vs procurement-approval-service |
| Events | Dual bus — audit completeness varies |
| Module vs route | Finance routes without finance module |
| Inventory | `defaultEnabled: false` but permissions pre-seeded |

---

## 11. Maturity scores

| Dimension | % |
|-----------|---|
| RBAC foundation | 70 |
| Workspace isolation | 75 |
| Platform governance | 50 |
| Document security | 55 |
| Audit trail coverage | 60 |
| SoD / enterprise IAM | 35 |

**Overall governance: PARTIAL (~58%)**
