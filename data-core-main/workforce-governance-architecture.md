# Workforce Governance Architecture

**Phase:** 4 — Rules, enforcement, compliance

---

## 1. Governance Layers

| Layer | Enforces |
|-------|----------|
| **Schema** | FKs, NOT NULL (where safe additive) |
| **Application** | Mandatory gate, cycle detection, workspace scope |
| **Process** | Approvals for sensitive changes |
| **Audit** | Immutable log |
| **Policy** | Workspace settings JSON |

---

## 2. Sensitive Actions Requiring Approval

| Action | Process code |
|--------|--------------|
| Transfer to another org unit | `transfer.org` |
| Promotion (grade change) | `movement.promotion` |
| Termination | `lifecycle.termination` |
| Manager change (skip-level) | `org.manager_change` |
| Salary change (if comp module) | `comp.salary_change` |

**Direct PATCH blocked** when policy requires process — return 409 with `processRequired: true`.

---

## 3. Role-Based Governance

| Role | Capabilities |
|------|--------------|
| Employee | View own file; submit requests |
| Manager | View subtree; approve team requests |
| HR admin | Full file edit; override with audit |
| Workspace admin | Foundation + policies |

Align permissions: `hr.view`, `hr.manage`, `hr.approve.*`, `hr.govern.override`.

---

## 4. Document Compliance

From `hr_document_types.isRequired`:

```
complianceScore(employee) =
  required types with valid non-expired upload / total required
```

Block activation if score &lt; 100% (configurable).

---

## 5. Data Retention

- Terminated employees: read-only file; no delete (soft archive)
- Audit logs: append-only; no DELETE
- GDPR export: `GET /hr/employees/:id/export` (future)

---

## 6. Segregation of Duties

- User who submits transfer cannot approve final step (configurable)
- HR second approver for termination

---

## 7. Workspace Policy Storage

Extend `hr_workspace_settings`:

```typescript
governance: {
  requireApprovalFor: string[],
  mandatoryEmployeeFields: string[],
  allowSelfServiceLeave: boolean,
  documentComplianceOnActivate: boolean,
}
```

---

*End of Workforce Governance Architecture.*
