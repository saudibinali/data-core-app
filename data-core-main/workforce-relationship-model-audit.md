# Workforce Relationship Model Audit (Phase 4)

**Scope:** How the system models managers, chains, alternates, and delegation.

---

## 1. Relationship Fields Inventory

| Relationship | Storage | Entity type | FK enforced? |
|--------------|---------|-------------|--------------|
| Direct manager (HCM) | `employees.directManagerId` | employee → employee | ❌ |
| Line manager (platform) | `users.lineManagerId` | user → user | ❌ |
| Dept manager (legacy) | `departments.managerId` | dept → user | ❌ |
| Org unit parent | `hr_org_units.parentId` | unit → unit | ❌ |
| Position seat | `hr_positions` | config only | partial FKs |

**No tables for:** acting manager, delegate, alternate approver, skip-level manager, executive chain.

---

## 2. Resolution: Who Is "The Manager"?

### Direct manager (operational for leave)

**Algorithm** (`leave.ts` `findApproverForEmployee`):

1. Load requester's `directManagerId`
2. Load manager employee → require `userId` + `status=active`
3. Approver = manager's **user** id

**If step 1–2 fails:** first workspace `admin` / `super_admin` user.

**Extended fallback** (`resolveApproverWithFallback`): may assign **requester** as approver.

### Line manager (operational for workflows)

**Algorithm** (`steps/approval.ts`, `steps/notification.ts`):

- Read `users.lineManagerId` for trigger user id
- No employee graph traversal

### Department manager

- Stored on legacy `departments` — **not used** in canonical leave or workflow steps audited

### Division / branch head / CEO

- **Not modeled.** Would require org tree walk + role-on-node — **not implemented**.

---

## 3. Extended Roles

| Role | Exists? | How resolved |
|------|---------|--------------|
| Direct manager | ✅ | `directManagerId` |
| Department manager | ⚠️ | Legacy dept only |
| HR manager | ❌ | Ad hoc admin role fallback |
| Executive (CEO) | ❌ | — |
| Acting manager | ❌ | — |
| Alternate approver | ❌ | — |
| Delegate (OOO) | ❌ | `core-approvals` future note only |

---

## 4. Administrative Chain

**Potential chain:** employee A → manager B → manager C via repeated `directManagerId`.

**Runtime use:** Leave Phase 1 uses **single step** only — does not walk chain.

**leave_approval_steps** table supports multi-step **if populated** — not auto-built from org graph.

**No cycle detection** on manager assignments.

---

## 5. Runtime-Aware vs Hardcoded

| Mechanism | Runtime-aware? | Depends on org graph? |
|-----------|----------------|----------------------|
| Leave approver | ✅ DB lookup | ❌ manager field only |
| Workflow manager step | ✅ DB lookup | ❌ user lineManagerId |
| Admin fallback | Hardcoded roles | ❌ |
| Department head | ❌ | ❌ |
| Grade-based approver | ❌ | ❌ |
| Policy-based routing | ⚠️ leave policy `requiresApproval` only | ❌ |

**Dominant pattern:** **Hardcoded user/employee links**, not organizational graph intelligence.

---

## 6. Delegation Structures

**Not implemented:**

- No delegation rules table
- No out-of-office window
- No substitute approver on leave request
- No workflow reassignment tied to org

---

## 7. Dual-Model Sync Gap

| Scenario | Leave sees | Workflow sees |
|----------|------------|---------------|
| Employee manager set, user lineManager empty | Manager (if userId) | Skip / no approver |
| User lineManager set, employee manager empty | Admin fallback | User's line manager |
| Both set, different people | Employee chain | User chain |

**Foundation org data does not participate** in resolving either chain.

---

## 8. Phase 4 Verdict

| Question | Answer |
|----------|--------|
| Relationships runtime-aware? | **Point lookups only — not graph-aware** |
| Organizational graph used? | **No** |
| Delegation? | **No** |
| Enterprise reporting model? | **Incomplete** |

---

*End of Phase 4 — Workforce Relationship Model Audit.*
