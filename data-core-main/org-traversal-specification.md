# Org Traversal Specification

**Phase:** 2 — Graph algorithms & queries

---

## 1. Graph Model

**Nodes:** `hr_org_units`  
**Edges:** `parentId` (directed, parent → child)  
**Employee attachment:** `employees.orgUnitId` → single primary node  
**Optional future:** multi-node via `employee_org_assignments`

---

## 2. Core Operations

| Operation | Function | Complexity |
|-----------|----------|------------|
| `getAncestors(unitId)` | Root → parent → … → unit | O(depth) |
| `getDescendants(unitId)` | BFS/CTE subtree | O(n) |
| `getSiblings(unitId)` | Same parent, exclude self | O(children) |
| `getPath(unitId)` | Breadcrumb names | O(depth) |
| `getSubtreeEmployeeIds(unitId)` | All employees in subtree | O(n + m) |
| `findLowestCommonAncestor(a, b)` | For matrix routing | O(depth) |

**Implementation:** PostgreSQL recursive CTEs in repository layer; cache per workspace with 5min TTL (optional).

---

## 3. SQL Pattern (ancestors)

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id, name, 0 AS depth
  FROM hr_org_units WHERE id = $1 AND workspace_id = $2
  UNION ALL
  SELECT u.id, u.parent_id, u.name, a.depth + 1
  FROM hr_org_units u
  JOIN ancestors a ON u.id = a.parent_id
  WHERE u.workspace_id = $2
)
SELECT * FROM ancestors ORDER BY depth DESC;
```

---

## 4. Org Head Resolution

```
getOrgUnitHeadEmployeeId(orgUnitId):
  1. if unit.managerEmployeeId active → return
  2. walk ancestors until managerEmployeeId found
  3. return null
```

---

## 5. Permission Inheritance (future)

**Not Phase 2 runtime** — document hook only:

```
canViewEmployee(viewer, target):
  if viewer.subtree contains target.orgUnitId → allow
```

Store policy in `hr_workspace_settings` for Phase 4 governance.

---

## 6. Matrix Structure (Phase 2.5 / Phase 3)

**Table:** `employee_org_assignments`

| Column | Purpose |
|--------|---------|
| employee_id | |
| org_unit_id | Secondary unit |
| assignment_type | `matrix` \| `project` |
| percent_allocation | optional |

Traversal: primary org for roster; all assignments for routing rules.

---

## 7. Index Requirements

- Existing: `idx_hr_org_units_parent`, `idx_hr_org_units_workspace`
- Add if missing: composite `(workspace_id, parent_id)`
- employees: `(workspace_id, org_unit_id)`

---

## 8. API Surface

| Endpoint | Returns |
|----------|---------|
| `GET /hr/org-units/:id/ancestors` | Ordered list |
| `GET /hr/org-units/:id/descendants` | Flat or nested |
| `GET /hr/org-units/:id/employees?includeSubtree=true` | Roster |

---

## 9. Performance Targets

| Workspace size | Target |
|----------------|--------|
| &lt;500 units, &lt;5k employees | &lt;100ms p95 |
| 5k–50k employees | Materialized path column (Phase 2.5) |

**Materialized path option:** `org_path` text `/1/4/9/` for fast subtree queries — migration additive.

---

*End of Org Traversal Specification.*
