# Reporting Hierarchy Runtime

**Phase:** 2 — Reporting lines & chain resolution

---

## 1. Hierarchy Sources (priority order)

| Priority | Source | Use |
|----------|--------|-----|
| 1 | `employees.directManagerId` | Primary reporting line (person) |
| 2 | `hr_positions.reportsToPositionId` → incumbent | Position-based line if person manager null |
| 3 | `hr_org_units.managerEmployeeId` | Org head (dotted-line / escalation) |
| 4 | `workforce_delegations` | Active delegate replaces approver |
| 5 | Executive override table | Ceiling / HR escalation |

**No hardcoded user IDs.**

---

## 2. Chain Resolution API

```typescript
interface ReportingNode {
  employeeId: number;
  userId: number | null;
  fullName: string;
  orgUnitId: number | null;
  positionId: number | null;
  depth: number; // 0 = requester
  source: 'direct' | 'position' | 'org_head';
}

getReportingChain(employeeId, maxDepth = 10): ReportingNode[]
getApproverChain(employeeId, policy): ReportingNode[]  // Phase 3
```

**Cycle detection:** throw `MANAGER_CYCLE` if revisiting employeeId in chain.

---

## 3. Org Head vs Direct Manager

| Scenario | Approver (default) |
|----------|-------------------|
| Standard IC | Direct manager |
| Manager with no directManagerId | Org unit head |
| Org head | Parent org unit head or executive override |
| Matrix (future) | Primary + secondary from assignments |

---

## 4. Integration Points

| Consumer | Phase 2 change |
|----------|----------------|
| Leave | Multi-step chain from `getApproverChain` (optional Phase 2.3) |
| Workflows | Phase 3 org routing |
| Reports | `report-data.ts` uses chain for "skip level" analytics |
| UI | Employee detail → "Reporting chain" tab |

---

## 5. Position Hierarchy

When `reportsToPositionId` set:

```
Position A (Team Lead seat)
    reportsTo → Position B (Department Manager seat)
        incumbent → Employee X
```

Employee in Position A without directManagerId inherits approver from Position B's incumbent.

---

## 6. Data Migration

1. Infer `directManagerId` from existing data (already partial)
2. For managers with title "Director"/"Head": suggest org unit head assignment
3. Do not auto-set position hierarchy without HR sign-off

---

## 7. Validation

- Max depth configurable per workspace (default 10)
- Warn if chain length = 1 and requester is only admin
- Shadow compare: old leave resolver vs chain resolver

---

*End of Reporting Hierarchy Runtime.*
