# Employee File Runtime — Phase 4 Implementation

**Status:** Implemented (additive, legacy-compatible)

---

## Overview

The Employee File is an **operational runtime aggregate** — not a form. It unifies profile, org placement, documents, contracts, movements, lifecycle, approvals, and timeline into one read model.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/hr/employees/:id/file` | Unified employee file aggregate |

## Aggregate structure

```
EmployeeFileAggregate
├── employee          — canonical employees row
├── summary           — orgPath, manager, job title, lifecycleState, documentCompliance
├── sections          — documents, contracts, notes, movements, timeline, lifecycleEvents, recentActivity, approvals
└── runtime           — governanceMode, activationRequires
```

## Implementation

| Component | Path |
|-----------|------|
| Aggregate service | `artifacts/api-server/src/lib/workforce/operations/employee-file-service.ts` |
| Routes | `artifacts/api-server/src/routes/workforce-operations.ts` |
| UI tab | `artifacts/ops-platform/src/pages/hr-employee-detail.tsx` → **Employee File** |

## Safety

- Schema mismatch → **503** + `WORKFORCE_OPS_SCHEMA_UNAVAILABLE` + migration hint
- Default `workforceGovernanceMode = legacy` — no production behavior change until promoted
- All legacy CRUD endpoints (`/documents`, `/contracts`, `/position-history`, `/activity`) remain unchanged

## Migration

`lib/db/drizzle/0027_workforce_operations_foundation.sql`  
Script: `node scripts/migrate-workforce-operations.cjs`
